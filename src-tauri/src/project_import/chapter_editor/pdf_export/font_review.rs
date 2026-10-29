use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::collections::BTreeMap;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FontReview {
    pub review_id: String,
    pub font_families: Vec<String>,
    pub excerpts: Vec<ReviewExcerpt>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReviewExcerpt {
    pub label: String,
    pub image_data_url: String,
}

pub(super) struct PreparedFontReview {
    pub families: Vec<String>,
    pub labels: Vec<String>,
}

/// Excerpts retain the full document's text width, style, drop-cap eligibility,
/// and source numbering. Each affected block gets an auto-height page: no images,
/// unrelated paragraphs, or unrelated footnotes are sent to the review UI.
pub(super) fn prepare(
    workspace: &Path,
    document: &ExportDocument,
    options: &PdfWorkspacePreparationOptions<'_>,
    plan: &font_fallback::FontFallbackPlan,
    review_plan: &font_fallback::FontFallbackPlan,
) -> Result<PreparedFontReview, String> {
    let title = leading_heading_title(document).unwrap_or_else(|| document.title.clone());
    let promoted = leading_heading_title(document).is_some();
    let order: Vec<_> = (0..document.blocks.len()).collect();
    let dropcap = latin_body(&document.language_code)
        .then(|| dropcap_block_index(&document.blocks, &order, promoted))
        .flatten();
    let mut excerpts = Vec::new();
    if review_plan.affected(&title.to_uppercase(), false) {
        excerpts.push((
            "Chapter title".to_string(),
            format!(
                "#align(center)[#text(font: ({}), size: 16pt, tracking: 0.1em)[#upper({})]]\n",
                heading_font_families(document)
                    .iter()
                    .map(|s| typst_string(s))
                    .collect::<Vec<_>>()
                    .join(", "),
                typst_string(&title.nfc().collect::<String>())
            ),
        ));
    }
    let mut paragraph_number = 0;
    let mut heading_number = 0;
    let mut image_number = 0;
    for (index, block) in document.blocks.iter().enumerate() {
        match block {
            ExportBlock::Text { text_style, text } => {
                let heading = matches!(
                    normalize_editor_text_style_value(Some(text_style)).as_str(),
                    "heading1" | "heading2"
                );
                if heading {
                    heading_number += 1;
                } else {
                    paragraph_number += 1;
                }
                if promoted && index == 0 {
                    continue;
                }
                if !review_plan.affected(text, false) {
                    continue;
                }
                let label = if heading {
                    format!("Heading {heading_number}")
                } else {
                    format!("Paragraph {paragraph_number}")
                };
                let body = match list_kind(text_style) {
                    Some(kind) => {
                        let items = list_items(text);
                        let texts = items
                            .iter()
                            .map(|item| item.text.as_str())
                            .collect::<Vec<_>>();
                        let items_inline = paragraph_inline_parts(document, index, &texts);
                        let list = render_typst_list(kind, &items, &items_inline);
                        render_typst_text_block(text_style, &list, false, false)
                    }
                    None => {
                        let inline = paragraph_inline(document, index, text);
                        render_typst_text_block(text_style, &inline, dropcap == Some(index), false)
                    }
                };
                excerpts.push((label, body));
            }
            ExportBlock::Image { caption, .. } => {
                image_number += 1;
                if review_plan.affected(caption, false) {
                    excerpts.push((
                        format!("Image {image_number} caption"),
                        format!("#align(center)[{}]\n", render_typst_image_caption(caption)),
                    ));
                }
            }
            ExportBlock::Footnote { number, text, .. } => {
                if review_plan.affected(text, options.footnote_links_as_plain_text) {
                    // Same size, number gutter, and text alignment as native PDF
                    // footnote entries; no invented anchor paragraph is required.
                    excerpts.push((format!("Footnote {number}"), format!(
                        "#text(size: 0.85em)[#grid(columns: (12pt, 1fr), column-gutter: 3pt, align: (end + top, start + top), [#text({})], [{}])]\n",
                        typst_string(&format!("{number}.")), render_inline_typst(text, options.footnote_links_as_plain_text)
                    )));
                }
            }
            ExportBlock::Attribution { text } => {
                if review_plan.affected(text, false) {
                    excerpts.push((
                        "Quote attribution".into(),
                        format!(
                            "#align(right)[#text(size: 0.9em)[{}]]\n\n",
                            render_inline_typst(text, false)
                        ),
                    ));
                }
            }
            ExportBlock::Separator => {}
        }
    }
    if excerpts.is_empty() {
        return Err("Could not locate the passages that need PDF fallback fonts.".to_string());
    }
    let mut source = plan.review_rules(review_plan);
    source.push_str(&typst_preamble(document, options.paper_size));
    source.push_str("#set page(height: auto, margin: (x: 0.85in, y: 12pt), numbering: none)\n");
    // Width and horizontal margins match the final PDF. Compact vertical margins
    // crop each sample without changing the paragraph's available line width.
    for (index, (_, body)) in excerpts.iter().enumerate() {
        if index > 0 {
            source.push_str("#pagebreak()\n");
        }
        source.push_str(body);
    }
    fs::write(workspace.join("font-review.typ"), source)
        .map_err(|_| "Could not prepare the PDF font review.".to_string())?;
    Ok(PreparedFontReview {
        families: review_plan
            .fonts
            .iter()
            .map(|font| font.family.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect(),
        labels: excerpts.into_iter().map(|(label, _)| label).collect(),
    })
}

// References in affected paragraphs retain their original global numbers, while
// the footnote bodies are included separately only when those bodies need fonts.
fn paragraph_inline(document: &ExportDocument, block_index: usize, text: &str) -> String {
    paragraph_inline_parts(document, block_index, &[text])
        .pop()
        .unwrap_or_default()
}

/// The parts of one block (a paragraph, or the items of a list) share its notes:
/// each reference is set at its marker in the first part that has it, and the rest
/// follow the last part.
fn paragraph_inline_parts(
    document: &ExportDocument,
    block_index: usize,
    texts: &[&str],
) -> Vec<String> {
    let notes: HashMap<_, _> = document
        .blocks
        .iter()
        .filter_map(|block| {
            if let ExportBlock::Footnote {
                number,
                marker,
                anchor_block: Some(anchor),
                ..
            } = block
            {
                (*anchor == block_index).then_some((*marker, *number))
            } else {
                None
            }
        })
        .collect();
    let markers: HashMap<_, _> = notes.keys().map(|marker| (*marker, "")).collect();
    let mut used = HashSet::new();
    let mut parts = Vec::new();
    for text in texts {
        let mut rendered = String::new();
        for segment in inline_segments(&text.nfc().collect::<String>()) {
            let mut cursor = 0;
            while let Some((start, end, marker)) =
                next_unescaped_footnote_marker(&segment.text, cursor, &markers, &used)
            {
                rendered.push_str(&render_styled_typst_text(
                    &segment.text[cursor..start],
                    &segment.style,
                    false,
                ));
                rendered.push_str(&format!(
                    "#super[#text({})]",
                    typst_string(&notes[&marker].to_string())
                ));
                used.insert(marker);
                cursor = end;
            }
            rendered.push_str(&render_styled_typst_text(
                &segment.text[cursor..],
                &segment.style,
                false,
            ));
        }
        parts.push(rendered);
    }
    if let Some(rendered) = parts.last_mut() {
        for (marker, number) in notes.iter().collect::<BTreeMap<_, _>>() {
            if !used.contains(marker) {
                rendered.push_str(&format!(
                    "#super[#text({})]",
                    typst_string(&number.to_string())
                ));
            }
        }
    }
    parts
}

pub(super) fn read_review(
    workspace: &Path,
    prepared: PreparedFontReview,
) -> Result<FontReview, String> {
    let mut excerpts = Vec::new();
    let mut total_bytes = 0usize;
    for (index, label) in prepared.labels.into_iter().enumerate() {
        let bytes = fs::read(workspace.join(format!("font-review-{}.svg", index + 1)))
            .map_err(|_| "Could not read a PDF font review excerpt.".to_string())?;
        total_bytes += bytes.len();
        if total_bytes > 32 * 1024 * 1024 {
            return Err(
                "The PDF font review is too large. Try exporting a smaller chapter.".to_string(),
            );
        }
        excerpts.push(ReviewExcerpt {
            label,
            image_data_url: format!("data:image/svg+xml;base64,{}", STANDARD.encode(bytes)),
        });
    }
    Ok(FontReview {
        review_id: Uuid::now_v7().to_string(),
        font_families: prepared.families,
        excerpts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn review_keeps_global_note_numbers_without_unrelated_note_bodies() {
        let document = ExportDocument {
            book_parts: Vec::new(),
            title: "Title".into(),
            language_code: "vi".into(),
            blocks: vec![
                ExportBlock::Text {
                    text_style: "paragraph".into(),
                    text: "Text [2]".into(),
                },
                ExportBlock::Footnote {
                    number: 17,
                    marker: 2,
                    anchor_block: Some(0),
                    text: "Not part of this excerpt".into(),
                },
            ],
        };
        let rendered = paragraph_inline(&document, 0, "Text [2]");
        assert!(rendered.contains("#super[#text(\"17\")]"));
        assert!(!rendered.contains("Not part"));
    }

    #[test]
    fn review_list_items_share_their_block_notes() {
        let note = |number, marker| ExportBlock::Footnote {
            number,
            marker,
            anchor_block: Some(0),
            text: "A note".into(),
        };
        let document = ExportDocument {
            book_parts: Vec::new(),
            title: "Title".into(),
            language_code: "vi".into(),
            blocks: vec![
                ExportBlock::Text {
                    text_style: "list_bullet".into(),
                    text: "One [2]\n\tTwo".into(),
                },
                note(17, 2),
                note(18, 3),
            ],
        };
        assert_eq!(
            paragraph_inline_parts(&document, 0, &["One [2]", "Two"]),
            vec![
                "#text(\"One \")#super[#text(\"17\")]".to_string(),
                "#text(\"Two\")#super[#text(\"18\")]".to_string(),
            ]
        );
    }

    fn review_document() -> ExportDocument {
        let mut document = ExportDocument {
            book_parts: Vec::new(),
            title: "A title \u{13153}".into(),
            language_code: "vi".into(),
            blocks: vec![
                ExportBlock::Text {
                    text_style: "paragraph".into(),
                    text: "UNRELATED_NEVER_IN_REVIEW".into(),
                },
                ExportBlock::Text {
                    text_style: "paragraph".into(),
                    text: "A paragraph with <b>\u{1318E}</b> and a note [2].".into(),
                },
                ExportBlock::Text {
                    text_style: "heading2".into(),
                    text: "A heading \u{13296}".into(),
                },
                ExportBlock::Image {
                    image: ExportImage::Url("https://example.invalid/not-requested.png".into()),
                    caption: "A caption \u{133CF}".into(),
                },
                ExportBlock::Footnote {
                    number: 17,
                    marker: 2,
                    anchor_block: Some(1),
                    text: "A note \u{13153}".into(),
                },
                ExportBlock::Footnote {
                    number: 18,
                    marker: 3,
                    anchor_block: None,
                    text: "UNRELATED_NOTE_NEVER_IN_REVIEW".into(),
                },
            ],
        };
        // Keep global numbering realistic: the seventeenth note follows sixteen
        // notes anchored to an unaffected paragraph, which the review must omit.
        for number in 1..17 {
            document.blocks.push(ExportBlock::Footnote {
                number,
                marker: number,
                anchor_block: Some(0),
                text: format!("Earlier note {number}"),
            });
        }
        document
    }

    #[test]
    fn review_selects_affected_blocks_and_preserves_context() {
        let workspace = pdf_workspace().unwrap();
        let _cleanup = WorkspaceCleanup(workspace.clone());
        let document = review_document();
        let plan = font_fallback::FontFallbackPlan {
            missing: BTreeSet::from(['\u{13153}', '\u{1318E}', '\u{13296}', '\u{133CF}']),
            ..Default::default()
        };
        let scope = tests_scope();
        let options = PdfWorkspacePreparationOptions {
            paper_size: "a4",
            footnote_links_as_plain_text: true,
            image_cache_session: &scope,
            layout: TypstLayout::Export,
        };
        let prepared = prepare(&workspace, &document, &options, &plan, &plan).unwrap();
        assert_eq!(
            prepared.labels,
            [
                "Chapter title",
                "Paragraph 2",
                "Heading 1",
                "Image 1 caption",
                "Footnote 17"
            ]
        );
        let source = fs::read_to_string(workspace.join("font-review.typ")).unwrap();
        assert!(!source.contains("UNRELATED_"));
        assert!(!source.contains("example.invalid"));
        assert!(source.contains("size: 16pt"));
        assert!(source.contains("== #text(\"A heading"));
        assert!(source.contains("#text(size: 0.75em)["));
        assert!(source.contains("#super[#text(\"17\")]"));
        assert!(source.contains("#text(\"17.\")"));
        assert!(source.contains("margin: (x: 0.85in, y: 12pt)"));
    }

    fn tests_scope() -> PdfImageCacheSession {
        begin_pdf_image_cache(&PdfImageCacheScope {
            installation_id: 1,
            repo_name: "test".into(),
            project_id: None,
            project_full_name: None,
            target: PdfImageCacheTarget::Chapter("test".into()),
        })
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn split_combining_marks_render_with_explicit_fonts_in_each_context() {
        let (Some(binary), Some(fonts)) = (
            std::env::var_os("GNOSIS_TYPST_BIN"),
            std::env::var_os("GNOSIS_TYPST_SMOKE_FONT_DIR"),
        ) else {
            return;
        };
        let workspace = pdf_workspace().unwrap();
        let _cleanup = WorkspaceCleanup(workspace.clone());
        fs::write(workspace.join("image.svg"), "<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30'><rect width='30' height='30' fill='gray'/></svg>").unwrap();
        let document = ExportDocument {
            book_parts: Vec::new(),
            title: "Quoted scripts".into(),
            language_code: "vi".into(),
            blocks: vec![
                ExportBlock::Text {
                    text_style: "paragraph".into(),
                    text: "An ordinary opening paragraph.".into(),
                },
                ExportBlock::Text {
                    text_style: "paragraph".into(),
                    text: "Armenian \u{0531} and Myanmar \u{1000}.".into(),
                },
                ExportBlock::Text {
                    text_style: "paragraph".into(),
                    text: "A<b>\u{033F}</b>".into(),
                },
                ExportBlock::Text {
                    text_style: "paragraph".into(),
                    text: "A<i>\u{033F}</i>".into(),
                },
                ExportBlock::Text {
                    text_style: "paragraph".into(),
                    text: "A<a href=\"https://example.test\">\u{033F}</a>".into(),
                },
                ExportBlock::Text {
                    text_style: "heading2".into(),
                    text: "A<b>\u{033F}</b>".into(),
                },
                ExportBlock::Image {
                    image: ExportImage::Upload {
                        repo_relative_path: "image.svg".into(),
                        raw_url: None,
                        absolute_path: workspace.join("image.svg"),
                    },
                    caption: "A<i>\u{033F}</i>".into(),
                },
                ExportBlock::Footnote {
                    number: 1,
                    marker: 1,
                    anchor_block: Some(1),
                    text: "A<b>\u{033F}</b>".into(),
                },
            ],
        };
        let cancelled = AtomicBool::new(false);
        let plan =
            font_fallback::resolve(&document, Path::new(&fonts), false, &[], &cancelled).unwrap();
        plan.validate().unwrap();
        assert!(plan
            .fonts
            .iter()
            .any(|font| font.clusters.contains("\u{033F}")));
        let scope = tests_scope();
        let options = PdfWorkspacePreparationOptions {
            paper_size: "a4",
            footnote_links_as_plain_text: false,
            image_cache_session: &scope,
            layout: TypstLayout::Export,
        };
        prepare_typst_workspace(None, "test", &workspace, &document, &options, &cancelled).unwrap();
        let full = fs::read_to_string(workspace.join("chapter.typ")).unwrap();
        fs::write(
            workspace.join("chapter.typ"),
            format!("{}{full}", plan.rules(false)),
        )
        .unwrap();
        let prepared = prepare(&workspace, &document, &options, &plan, &plan).unwrap();
        assert_eq!(
            prepared.labels,
            [
                "Paragraph 2",
                "Paragraph 3",
                "Paragraph 4",
                "Paragraph 5",
                "Heading 1",
                "Image 1 caption",
                "Footnote 1"
            ]
        );
        // Disable Typst's automatic fallback in the fixture: a missing explicit
        // font rule must fail the glyph comparison rather than being rescued.
        for source in ["chapter.typ", "font-review.typ"] {
            let path = workspace.join(source);
            let text = fs::read_to_string(&path).unwrap();
            fs::write(path, format!("#set text(fallback: false)\n{text}")).unwrap();
        }
        for (source, output) in [
            ("font-review.typ", "font-review-{p}.svg"),
            ("chapter.typ", "chapter.pdf"),
        ] {
            let mut command = std::process::Command::new(&binary);
            command
                .args(["compile", "--ignore-system-fonts", "--font-path"])
                .arg(&fonts)
                .arg("--root")
                .arg(&workspace)
                .arg("--package-path")
                .arg(workspace.join("packages"));
            let directories: BTreeSet<_> = plan
                .fonts
                .iter()
                .filter_map(|font| font.path.parent())
                .collect();
            for directory in directories {
                command.arg("--font-path").arg(directory);
            }
            let result = command
                .arg(workspace.join(source))
                .arg(workspace.join(output))
                .output()
                .unwrap();
            let diagnostic = String::from_utf8_lossy(&result.stderr);
            assert!(result.status.success(), "{diagnostic}");
            assert!(!diagnostic.contains("unknown font family:"), "{diagnostic}");
        }
        let mark_font = plan
            .fonts
            .iter()
            .find(|font| font.clusters.contains("\u{033F}"))
            .unwrap();
        let choice = serde_json::to_value(mark_font.choice()).unwrap();
        let mark = format!("#text(font: {}, style: {}, weight: {}, stretch: {}%, fallback: false, \"\\u{{033F}}\")",
            typst_string(&mark_font.family), choice["style"], choice["weight"], choice["stretchPercent"]);
        let symbol = regex::Regex::new(r#"<symbol[^>]*>(.*?)</symbol>"#).unwrap();
        let mut expected_glyphs = Vec::new();
        for body in [
            mark.clone(),
            format!("#text(size: 12pt)[{mark}]"),
            format!("#text(size: 0.75em)[{mark}]"),
            format!("#text(size: 0.85em)[{mark}]"),
        ] {
            // No fallback regex in the reference: compare with a direct render
            // of the approved face at each context's actual text size.
            fs::write(
                workspace.join("expected.typ"),
                format!("#set page(width: 100pt, height: auto)\n#set text(size: 11.5pt)\n{body}"),
            )
            .unwrap();
            let result = std::process::Command::new(&binary)
                .args(["compile", "--ignore-system-fonts", "--font-path"])
                .arg(mark_font.path.parent().unwrap())
                .arg(workspace.join("expected.typ"))
                .arg(workspace.join("expected.svg"))
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
            let expected = fs::read_to_string(workspace.join("expected.svg")).unwrap();
            expected_glyphs.push(
                symbol
                    .captures(&expected)
                    .unwrap()
                    .get(1)
                    .unwrap()
                    .as_str()
                    .to_string(),
            );
        }
        let highlight = regex::Regex::new(r##"<path fill="#fff0a6"[^>]* d="([^"]*)""##).unwrap();
        let horizontal = regex::Regex::new(r"h\s+([0-9.]+)").unwrap();
        for index in 1..=prepared.labels.len() {
            let svg =
                fs::read_to_string(workspace.join(format!("font-review-{index}.svg"))).unwrap();
            assert!(
                svg.contains("#fff0a6"),
                "excerpt {index} must highlight its fallback characters"
            );
            if index > 1 {
                // Compare the actual glyph outlines with a direct render of the
                // approved face. A highlight alone could still surround tofu.
                assert!(
                    svg.contains(
                        &expected_glyphs[match index {
                            5 => 1,
                            6 => 2,
                            7 => 3,
                            _ => 0,
                        }]
                    ),
                    "excerpt {index} must use the selected mark glyph"
                );
                assert!(
                    highlight.captures_iter(&svg).any(|c| horizontal
                        .captures_iter(&c[1])
                        .any(|width| width[1].parse::<f64>().unwrap() > 0.0)),
                    "excerpt {index} needs a visible-width highlight"
                );
            }
        }
        assert!(fs::read(workspace.join("chapter.pdf"))
            .unwrap()
            .starts_with(b"%PDF"));
        assert!(!fs::read_to_string(workspace.join("chapter.typ"))
            .unwrap()
            .contains("fff0a6"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn highlighted_excerpts_and_complete_pdf_compile_with_installed_egyptian_font() {
        let (Some(binary), Some(fonts)) = (
            std::env::var_os("GNOSIS_TYPST_BIN"),
            std::env::var_os("GNOSIS_TYPST_SMOKE_FONT_DIR"),
        ) else {
            return;
        };
        let workspace = pdf_workspace().unwrap();
        let _cleanup = WorkspaceCleanup(workspace.clone());
        let document = review_document();
        let plan = font_fallback::resolve(
            &document,
            Path::new(&fonts),
            true,
            &[],
            &AtomicBool::new(false),
        )
        .unwrap();
        plan.validate().unwrap();
        assert_eq!(plan.fonts.len(), 1);
        assert_eq!(plan.fonts[0].family, "Noto Sans EgyptHiero");
        write_droplet_package(&workspace).unwrap();
        let scope = tests_scope();
        let options = PdfWorkspacePreparationOptions {
            paper_size: "a4",
            footnote_links_as_plain_text: true,
            image_cache_session: &scope,
            layout: TypstLayout::Export,
        };
        let prepared = prepare(&workspace, &document, &options, &plan, &plan).unwrap();
        // A local figure in the final document avoids any network during the test.
        let mut full_document = document.clone();
        fs::write(workspace.join("image.svg"), "<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30'><rect width='30' height='30' fill='gray'/></svg>").unwrap();
        if let ExportBlock::Image { image, .. } = &mut full_document.blocks[3] {
            *image = ExportImage::Upload {
                repo_relative_path: "image.svg".into(),
                raw_url: None,
                absolute_path: workspace.join("image.svg"),
            };
        }
        prepare_typst_workspace(
            None,
            "test",
            &workspace,
            &full_document,
            &options,
            &AtomicBool::new(false),
        )
        .unwrap();
        let full = fs::read_to_string(workspace.join("chapter.typ")).unwrap();
        fs::write(
            workspace.join("chapter.typ"),
            format!("{}{full}", plan.rules(false)),
        )
        .unwrap();
        for (source, output) in [
            ("font-review.typ", "font-review-{p}.svg"),
            ("chapter.typ", "chapter.pdf"),
        ] {
            let result = std::process::Command::new(&binary)
                .args(["compile", "--ignore-system-fonts", "--font-path"])
                .arg(&fonts)
                .arg("--font-path")
                .arg(plan.fonts[0].path.parent().unwrap())
                .arg("--root")
                .arg(&workspace)
                .arg("--package-path")
                .arg(workspace.join("packages"))
                .arg(workspace.join(source))
                .arg(workspace.join(output))
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
        }
        let review = read_review(&workspace, prepared).unwrap();
        assert_eq!(review.excerpts.len(), 5);
        for index in 1..=5 {
            let svg =
                fs::read_to_string(workspace.join(format!("font-review-{index}.svg"))).unwrap();
            assert!(
                svg.to_ascii_lowercase().contains("#fff0a6"),
                "excerpt {index} must highlight fallback glyphs"
            );
        }
        assert!(!fs::read_to_string(workspace.join("chapter.typ"))
            .unwrap()
            .contains("fff0a6"));
        assert!(fs::read(workspace.join("chapter.pdf"))
            .unwrap()
            .starts_with(b"%PDF"));
        // Optional local fixture output for visual inspection, never used by the app.
        if let Some(output) = std::env::var_os("GNOSIS_PDF_REVIEW_TEST_OUTPUT") {
            let output = PathBuf::from(output);
            fs::create_dir_all(&output).unwrap();
            for name in [
                "font-review-1.svg",
                "font-review-2.svg",
                "font-review-3.svg",
                "font-review-4.svg",
                "font-review-5.svg",
                "chapter.pdf",
            ] {
                fs::copy(workspace.join(name), output.join(name)).unwrap();
            }
        }
    }
}
