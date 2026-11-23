use super::*;
use crate::project_import::chapter_editor::{book_export::BookPart, chapter_export::AudioExport};

fn evaluate(workspace: &Path, expression: &str) -> Vec<u8> {
    let path = workspace.join("chapter.typ");
    run_typst_for_test(
        &[
            "eval".as_ref(),
            expression.as_ref(),
            "--in".as_ref(),
            path.as_os_str(),
        ],
        workspace,
    )
    .unwrap()
}

fn fit_and_check(workspace: &Path) -> serde_json::Value {
    tauri::async_runtime::block_on(qr_packing::fit(workspace, |expr| {
        std::future::ready(Ok(evaluate(workspace, expr)))
    }))
    .unwrap();
    let rows: serde_json::Value =
        serde_json::from_slice(&fs::read(workspace.join("qr-rows.json")).unwrap()).unwrap();
    // Inspect actual drawing positions and both ends of the native links.
    let positions: Vec<(u64, u64, f64, f64, u64)> = serde_json::from_slice(&evaluate(
        workspace,
        "query(<gnosis-qr-cell>).map(c => { let p = c.location().position(); (c.value, p.page, p.x / 1pt, p.y / 1pt, query(footnote).at(c.value - 1).location().page()) })"
    )).unwrap();
    assert_eq!(positions.len(), rows.as_object().unwrap().len());
    for cell in &positions {
        assert_eq!(cell.1, cell.4);
        let row = rows[cell.0.to_string()]["row"].as_u64().unwrap();
        let leader = positions.iter().find(|c| c.0 == row).unwrap();
        assert_eq!(leader.1, cell.1);
        assert!((leader.3 - cell.3).abs() < 0.05);
        if row != cell.0 {
            assert!(cell.2 > leader.2);
        }
    }
    rows
}

#[test]
fn adaptive_qr_rows_fit_every_paper_size_and_split_at_chapter_boundaries() {
    if std::env::var_os("GNOSIS_TYPST_BIN").is_none()
        || std::env::var_os("GNOSIS_TYPST_SMOKE_FONT_DIR").is_none()
    {
        return;
    }
    let workspace = pdf_workspace().unwrap();
    let _cleanup = WorkspaceCleanup(workspace.clone());
    let session = begin_pdf_image_cache(&test_image_cache_scope("adaptive-qr"));
    let cancelled = AtomicBool::new(false);
    let make_chapter = |title: &str, paragraphs: &[(&str, Vec<String>)]| {
        let mut blocks = Vec::new();
        let mut number = 0;
        for (words, notes) in paragraphs {
            let anchor_block = blocks.len();
            blocks.push(text_block("paragraph", words));
            for (i, text) in notes.iter().enumerate() {
                number += 1;
                blocks.push(ExportBlock::Footnote {
                    number,
                    marker: i + 1,
                    anchor_block: Some(anchor_block),
                    text: text.clone(),
                });
            }
        }
        ExportDocument {
            title: title.into(),
            language_code: "en".into(),
            blocks,
            book_parts: vec![],
        }
    };
    let source = |slug: &str, title: &str| {
        format!(r#"<a href="https://example.org/archive/{slug}">{title}</a>"#)
    };
    let recording = AudioExport::QrFootnote.note_text(
        &ExportImage::Url("https://example.org/archive/audio.mp3".into()),
        "Recording",
    );
    let first = make_chapter("Reading the archive", &[
        ("Compare the two accounts[1] and the editor’s introduction.[2]", vec![
            format!("Read the {}.", source("interview", "interview")),
            format!("The editor discusses the {}.", source("notes", "notes")),
        ]),
        ("The catalogue provides additional context.[1]", vec![
            format!("The editor identifies each speaker and gives the date and location of the original oral history. Consult the {} for details.", source("catalogue", "catalogue")),
        ]),
        ("The map,[1] manuscript,[2] recording,[3] and letter[4] are available separately.", vec![
            source("map", "Map"), source("manuscript", "Manuscript"), recording, source("letter", "Letter"),
        ]),
        ("See the editor,[1] facsimile,[2] index,[3] and timeline.[4]", vec![
            "Translated from the original manuscript.".into(),
            format!("See the {}.", source("facsimile", "facsimile")),
            source("index", "Index"), source("timeline", "Timeline"),
        ]),
        ("The last record has an inventory.[1] Its map survives.[2]", vec![
            source(&"record-123/".repeat(50), "Complete inventory of the archive"), source("second-map", "Map")
        ]),
    ]);
    let second = make_chapter(
        "The second volume",
        &[(
            "The photograph[1] and ledger[2] are reproduced here.",
            vec![
                source("photograph", "Photograph"),
                source("ledger", "Ledger"),
            ],
        )],
    );
    let book = ExportDocument {
        book_parts: [&first, &second]
            .iter()
            .enumerate()
            .map(|(index, doc)| BookPart {
                item: BookItemInput {
                    kind: "chapter".into(),
                    id: format!("c{index}"),
                    title: doc.title.clone(),
                    ..Default::default()
                },
                document: (*doc).clone(),
            })
            .collect(),
        ..first.clone()
    };
    for (paper, capacity) in [
        ("a5", 4),
        ("iso-b5", 5),
        ("us-executive", 5),
        ("a4", 6),
        ("us-letter", 6),
        ("us-legal", 6),
        ("us-tabloid", 9),
        ("a3", 9),
    ] {
        let options = PdfWorkspacePreparationOptions {
            footnote_links: PdfFootnoteLinks::Qr,
            paper_size: paper,
            image_cache_session: &session,
            layout: TypstLayout::Export,
        };
        prepare_typst_workspace(None, "", &workspace, &book, &options, &cancelled).unwrap();
        let path = workspace.join("chapter.typ");
        let measures: Vec<serde_json::Value> = serde_json::from_slice(&evaluate(
            &workspace,
            "query(<gnosis-qr-measure>).map(m => m.value)",
        ))
        .unwrap();
        assert!(measures.len() >= 12 && measures.iter().all(|m| m["capacity"] == capacity));
        assert!(measures.iter().all(|m| m["id"] != 3 && m["id"] != 8));
        let rows = fit_and_check(&workspace);
        assert_eq!(rows["1"]["span"], 2);
        assert_eq!(rows["2"]["column"], 2);
        assert_eq!(rows["7"]["column"], 3);
        assert_eq!(rows["9"]["span"], 2);
        assert_eq!(rows["10"]["column"], 2);
        assert_eq!(rows["11"]["column"], 3);
        assert_eq!(rows["12"]["span"], 2);
        assert_eq!(rows["14"]["row"], 14, "{paper}: {rows}");
        assert_eq!(rows["15"]["row"], 14);
        if paper == "a5" {
            if let Some(dest) = std::env::var_os("GNOSIS_QR_ADAPTIVE_OUTPUT") {
                run_typst_for_test(
                    &["compile".as_ref(), path.as_os_str(), dest.as_os_str()],
                    &workspace,
                )
                .unwrap();
            }
        }
    }

    // Continuous chapter text exercises natural page breaks independently of
    // forced chapter openers. The cells and their callouts must travel together.
    let paragraphs: Vec<_> = (1..=48).map(|i| (
        "Several versions of the account survive. A transcript from the archive identifies the speaker and the circumstances of the original interview.[1]",
        vec![source(&format!("transcript-{i}"), "Transcript")],
    )).collect();
    let chapter = make_chapter("The archive transcripts", &paragraphs);
    let options = PdfWorkspacePreparationOptions {
        footnote_links: PdfFootnoteLinks::Qr,
        paper_size: "a5",
        image_cache_session: &session,
        layout: TypstLayout::Export,
    };
    prepare_typst_workspace(None, "", &workspace, &chapter, &options, &cancelled).unwrap();
    let rows = fit_and_check(&workspace);
    assert!(rows.as_object().unwrap().len() >= 32);
    let pages: Vec<usize> = serde_json::from_slice(&evaluate(
        &workspace,
        "query(footnote).map(n => n.location().page())",
    ))
    .unwrap();
    assert_eq!(pages.len(), paragraphs.len());
    assert!(pages.last().unwrap() - pages.first().unwrap() >= 3);
}
