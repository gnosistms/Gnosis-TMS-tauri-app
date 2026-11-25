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
        // Native note numbers occupy one left gutter and read down the page.
        assert!((leader.2 - cell.2).abs() < 8.0);
        if row != cell.0 {
            assert!(cell.3 > leader.3);
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
            format!("Ê-lo-him là thiên thần. {}", source("interview", "Đọc thêm")),
            format!("The editor discusses the {}.", source("notes", "notes")),
        ]),
        ("The catalogue provides additional context.[1]", vec![
            format!("{} Consult the {} for details.", "The editor identifies each speaker and gives the date and location of the original oral history. ".repeat(9), source("catalogue", "catalogue")),
        ]),
        ("The map,[1] manuscript,[2] recording,[3] and letter[4] are available separately.", vec![
            r#"<a href="https://example.org">Map</a>"#.into(),
            source("manuscript", "Manuscript"), recording, source("letter", "Letter"),
        ]),
        ("See the editor,[1] facsimile,[2] index,[3] and timeline.[4]", vec![
            "Translated from the original manuscript.".into(),
            format!("See the {}.", source("facsimile", "facsimile")),
            source("index", "Index"), source("timeline", "Timeline"),
        ]),
        ("The last record has an inventory.[1] Its map survives.[2]", vec![
            source(&"record-123/".repeat(160), "Complete inventory of the archive"), source("second-map", "Map")
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
    for paper in [
        "a5",
        "iso-b5",
        "us-executive",
        "a4",
        "us-letter",
        "us-legal",
        "us-tabloid",
        "a3",
    ] {
        let options = PdfWorkspacePreparationOptions {
            footnote_links: PdfFootnoteLinks::Qr,
            paper_size: paper,
            image_cache_session: &session,
            layout: TypstLayout::Export,
        };
        prepare_typst_workspace(None, "", &workspace, &book, &options, &cancelled).unwrap();
        let path = workspace.join("chapter.typ");
        let candidates: Vec<serde_json::Value> = serde_json::from_slice(&evaluate(
            &workspace,
            "query(<gnosis-qr-measure>).map(m => m.value).flatten()",
        ))
        .unwrap();
        assert!(candidates
            .iter()
            .all(|row| row["saved"].as_u64().unwrap() > 0));
        assert!(candidates.iter().all(|row| row["first"] != 3));
        let rows = fit_and_check(&workspace);
        let cells = rows.as_object().unwrap();
        assert!(!cells.is_empty());
        for (id, cell) in cells {
            if id.parse::<u64>().unwrap() == cell["row"].as_u64().unwrap() {
                assert!(candidates
                    .iter()
                    .any(|c| c["first"] == cell["row"] && c["count"] == cell["count"]));
            }
        }
        assert_eq!(rows["2"]["row"], 1);
        assert_eq!(rows["15"]["row"], 14, "{paper}: {rows}");
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

#[test]
fn codes_stay_with_their_notes_unless_a_shared_row_saves_vertical_space() {
    if std::env::var_os("GNOSIS_TYPST_BIN").is_none()
        || std::env::var_os("GNOSIS_TYPST_SMOKE_FONT_DIR").is_none()
    {
        return;
    }
    let workspace = pdf_workspace().unwrap();
    let _cleanup = WorkspaceCleanup(workspace.clone());
    let session = begin_pdf_image_cache(&test_image_cache_scope("qr-spacing"));
    let options = PdfWorkspacePreparationOptions {
        footnote_links: PdfFootnoteLinks::Qr,
        paper_size: "a5",
        image_cache_session: &session,
        layout: TypstLayout::Export,
    };
    let mut blocks = vec![text_block(
        "paragraph",
        "The accounts[1][2][3], the recordings[4][5][6] and the conclusion[7][8][9].",
    )];
    for (i, caption) in [
        "Read.", "Read.", "Read.", "Listen.", "Listen.", "Listen.", "Read.", "Listen.", "Read.",
    ]
    .iter()
    .enumerate()
    {
        let prose = if *caption == "Read." {
            "First line.\nSecond line.\nThird line."
        } else {
            "A recording."
        };
        blocks.push(ExportBlock::Footnote {
            number: i + 1,
            marker: i + 1,
            anchor_block: Some(0),
            text: format!(r#"{prose} <a href="https://wp.me/p6Zr2M-v">{caption}</a>"#),
        });
    }
    let document = ExportDocument {
        title: "Notes and recordings".into(),
        language_code: "vi".into(),
        blocks,
        book_parts: Vec::new(),
    };
    prepare_typst_workspace(
        None,
        "",
        &workspace,
        &document,
        &options,
        &AtomicBool::new(false),
    )
    .unwrap();
    let rows = fit_and_check(&workspace);
    assert_eq!(rows.as_object().unwrap().len(), 3, "{rows}");
    for id in ["4", "5", "6"] {
        assert_eq!(rows[id], serde_json::json!({"row": 4, "count": 3}));
    }
    let path = workspace.join("chapter.typ");
    let source = fs::read_to_string(&path).unwrap();
    let probe = r#"#show regex("([0-9]+ · )?(Read|Listen)[.]"): it => [#metadata(it.text)<printed-caption>#it]
"#;
    fs::write(
        &path,
        source.replacen("#gnosis-title(", &format!("{probe}#gnosis-title("), 1),
    )
    .unwrap();
    let captions: Vec<String> = serde_json::from_slice(&evaluate(
        &workspace,
        "query(<printed-caption>).map(m => m.value)",
    ))
    .unwrap();
    assert_eq!(
        captions,
        ["Read.", "Read.", "Read.", "Listen.", "Read.", "Listen.", "Read."]
    );
}

#[test]
fn wrapped_qr_uses_the_ink_margin_and_the_native_paragraph_spacing() {
    if std::env::var_os("GNOSIS_TYPST_BIN").is_none()
        || std::env::var_os("GNOSIS_TYPST_SMOKE_FONT_DIR").is_none()
    {
        return;
    }
    let workspace = pdf_workspace().unwrap();
    let _cleanup = WorkspaceCleanup(workspace.clone());
    let session = begin_pdf_image_cache(&test_image_cache_scope("qr-wrap"));
    let words = (0..110)
        .map(|n| format!("w{n:03}"))
        .collect::<Vec<_>>()
        .join(" ");
    let document = ExportDocument {
        title: "Reading the note".into(), language_code: "vi".into(), book_parts: vec![],
        blocks: vec![
            text_block("paragraph", "An annotation in the chapter.[1]"),
            ExportBlock::Footnote { number: 1, marker: 1, anchor_block: Some(0), text: format!(
                "<i>{words}.</i>\n\nFirstItem\nSoftLine\n\nSecondItem. <a href=\"https://example.org/archive\">Đọc thêm tại đây.</a>"
            ) },
        ],
    };
    let book = ExportDocument {
        book_parts: vec![BookPart {
            item: BookItemInput {
                kind: "chapter".into(),
                id: "sample".into(),
                title: document.title.clone(),
                ..Default::default()
            },
            document: document.clone(),
        }],
        ..document.clone()
    };
    for (document, layout) in [
        (&document, TypstLayout::Export),
        (&book, TypstLayout::TextOnly),
    ] {
        let options = PdfWorkspacePreparationOptions {
            footnote_links: PdfFootnoteLinks::Qr,
            paper_size: "a5",
            image_cache_session: &session,
            layout,
        };
        prepare_typst_workspace(
            None,
            "",
            &workspace,
            document,
            &options,
            &AtomicBool::new(false),
        )
        .unwrap();
        let path = workspace.join("chapter.typ");
        let source = fs::read_to_string(&path).unwrap();
        let probes = r#"#show image: it => {
  if it.alt != none and it.alt.starts-with("QR: ") {
    [#metadata(("ink", it.width.length / 1pt))<geometry>#it]
  } else { it }
}
#show regex("w[0-9]{3}|FirstItem|SecondItem|SoftLine|Đọc thêm tại đây\."): it => context {
  box[#metadata((it.text, measure(it).width / 1pt))<geometry>#it]
}
"#;
        fs::write(
            &path,
            source.replacen("#gnosis-title(", &format!("{probes}#gnosis-title("), 1),
        )
        .unwrap();
        type Point = (String, f64, usize, f64, f64);
        let points: Vec<Point> = serde_json::from_slice(&evaluate(&workspace,
            "query(<geometry>).map(m => { let pos = m.location().position(); (..m.value, pos.page, pos.x / 1pt, pos.y / 1pt) })"
        )).unwrap();
        let point = |name: &str| points.iter().find(|p| p.0 == name).unwrap();
        let ink = point("ink");
        let margin = (148.0 - if ink.2 % 2 == 1 { 19.0 } else { 22.0 }) * 72.0 / 25.4;
        assert!((ink.3 + ink.1 - margin).abs() < 0.02);
        let caption = point("Đọc thêm tại đây.");
        assert!(caption.3 + caption.1 > margin + 4.0);
        let words: Vec<_> = points
            .iter()
            .filter(|p| p.0.starts_with('w') && p.0.len() == 4)
            .collect();
        assert_eq!(words.len(), 110);
        assert!(words
            .iter()
            .filter(|p| p.4 < ink.4 + ink.1)
            .all(|p| p.3 + p.1 < ink.3 - 1.0));
        assert!(words
            .iter()
            .filter(|p| p.4 > ink.4 + ink.1)
            .any(|p| (p.3 + p.1 - margin).abs() < 0.5));
        let first = point("FirstItem");
        let soft = point("SoftLine");
        let second = point("SecondItem");
        assert!((first.3 - second.3).abs() < 0.05);
        assert!((first.3 - soft.3 - 1.5 * 0.85 * 11.5).abs() < 0.05);
        // Both kinds of return advance one line.
        let dy1 = soft.4 - first.4;
        let dy2 = second.4 - soft.4;
        assert!(dy1 > 8.0 && (dy1 - dy2).abs() < 0.05);
    }
}

#[test]
fn chapter_and_book_print_verified_shortlinks_and_keep_the_authored_pdf_destinations() {
    let article = "https://gnosisvn.org/2015/11/30/dai-bach-hoi-quan/";
    let recording = "https://gnosisvn.org/wp-content/uploads/2021/10/fa_ra_on.mp3";
    let shortlinks = qr_shortlinks::Shortlinks::from([(
        article.to_string(),
        vec![url::Url::parse("https://wp.me/p6Zr2M-v").unwrap()],
    )]);
    let chapter = ExportDocument {
        title: "Tình yêu".into(),
        language_code: "vi".into(),
        book_parts: vec![],
        blocks: vec![
            text_block("paragraph", "Hai tài liệu.[1]"),
            ExportBlock::Footnote {
                number: 1,
                marker: 1,
                anchor_block: Some(0),
                text: format!(
                    r#"<a href="{article}">Bạch Đại Hội Quán</a> và <a href="{recording}">PHA-RA-ÔN</a>."#
                ),
            },
        ],
    };
    let book = ExportDocument {
        title: "HNHH".into(),
        language_code: "vi".into(),
        blocks: vec![],
        book_parts: vec![BookPart {
            item: BookItemInput {
                kind: "chapter".into(),
                id: "love".into(),
                title: chapter.title.clone(),
                ..Default::default()
            },
            document: chapter.clone(),
        }],
    };
    let session = begin_pdf_image_cache(&test_image_cache_scope("verified-shortlinks"));
    let options = PdfWorkspacePreparationOptions {
        footnote_links: PdfFootnoteLinks::Qr,
        paper_size: "a5",
        image_cache_session: &session,
        layout: TypstLayout::Export,
    };
    let cancelled = AtomicBool::new(false);
    let images = HashMap::new();
    let chapter_source = render_typst_chapter(
        &chapter,
        &images,
        &shortlinks,
        &options,
        &cancelled,
        None,
        false,
    )
    .unwrap();
    let book_source = render_typst_book(&book, &images, &shortlinks, &options, &cancelled).unwrap();
    for source in [chapter_source, book_source] {
        assert_eq!(source.matches("modules: ").count(), 2);
        assert!(source.contains(&format!(
            r#"url: "{article}", words: "Bạch Đại Hội Quán", modules: 21"#
        )));
        assert!(source.contains(&format!(
            r#"url: "{recording}", words: "PHA-RA-ÔN", modules: 29"#
        )));
    }
}
