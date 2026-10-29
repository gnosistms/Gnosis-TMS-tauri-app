use super::super::book_export::{BookItemInput, BookPart};
use super::*;
use quick_xml::{events::Event, Reader};
use zip::ZipArchive;

fn paragraph(style: &str, text: &str) -> ExportBlock {
    ExportBlock::Text {
        text_style: style.into(),
        text: text.into(),
    }
}

fn document(title: &str, blocks: Vec<ExportBlock>) -> ExportDocument {
    ExportDocument {
        title: title.into(),
        language_code: "vi".into(),
        blocks,
        book_parts: Vec::new(),
    }
}

fn unpack(document: &ExportDocument) -> std::collections::BTreeMap<String, Vec<u8>> {
    let bytes = render_epub_document(document, &mut |_, _| {}).unwrap();
    // Optional artifacts for running the same regression cases through EPUBCheck.
    if let Ok(directory) = std::env::var("GNOSIS_EPUB_FIXTURE_DIR") {
        fs::create_dir_all(&directory).unwrap();
        let name = document
            .title
            .chars()
            .map(|ch| if ch.is_alphanumeric() { ch } else { '-' })
            .collect::<String>();
        fs::write(
            std::path::Path::new(&directory).join(format!("{name}.epub")),
            &bytes,
        )
        .unwrap();
    }
    // The local header for mimetype must have neither compression nor extra data.
    assert_eq!(&bytes[..4], b"PK\x03\x04");
    assert_eq!(&bytes[8..10], &[0, 0]);
    assert_eq!(&bytes[28..30], &[0, 0]);
    let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
    let first = archive.by_index(0).unwrap();
    assert_eq!(first.name(), "mimetype");
    assert_eq!(first.compression(), CompressionMethod::Stored);
    drop(first);
    let mut files = std::collections::BTreeMap::new();
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).unwrap();
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).unwrap();
        if file.name().ends_with(".xml")
            || file.name().ends_with(".xhtml")
            || file.name().ends_with(".opf")
        {
            assert_xml(std::str::from_utf8(&bytes).unwrap());
        }
        files.insert(file.name().to_string(), bytes);
    }
    assert_eq!(files["mimetype"], b"application/epub+zip");
    files
}

fn assert_xml(source: &str) {
    let mut reader = Reader::from_str(source);
    let mut stack = Vec::new();
    loop {
        match reader.read_event().unwrap() {
            Event::Start(element) => {
                for attr in element.attributes() {
                    attr.unwrap().decode_and_unescape_value(&reader).unwrap();
                }
                stack.push(element.name().as_ref().to_vec());
            }
            Event::Empty(element) => {
                for attr in element.attributes() {
                    attr.unwrap().decode_and_unescape_value(&reader).unwrap();
                }
            }
            Event::End(element) => assert_eq!(stack.pop().unwrap(), element.name().as_ref()),
            Event::Text(text) => {
                text.unescape().unwrap();
            }
            Event::Eof => break,
            _ => {}
        }
    }
    assert!(stack.is_empty());
}

fn file(files: &std::collections::BTreeMap<String, Vec<u8>>, name: &str) -> String {
    String::from_utf8(files[name].clone()).unwrap()
}

#[test]
fn epub_packages_valid_xml_metadata_and_escaped_multilingual_content() {
    let doc = document("Việt & 日本語 <test>", vec![
        paragraph("heading1", "Tựa đề"),
        paragraph("paragraph", "Tiếng Việt & <b>bold<i>crossed</b> tags</i>\n<ruby>漢<rt>かん</rt></ruby> <u>underline</u> <a href=\"https://example.com/?a=1&amp;b=2\">link</a>"),
        paragraph("paragraph", "<script>unsafe()</script> literal <xml>\u{1}"),
        paragraph("quote", "A quotation"),
        ExportBlock::Attribution { text: "<i>Author</i>".into() },
        ExportBlock::Separator,
    ]);
    let files = unpack(&doc);
    let package = file(&files, "EPUB/package.opf");
    assert!(package.contains("version=\"3.0\""));
    assert!(package.contains("<dc:title>Việt &amp; 日本語 &lt;test&gt;</dc:title>"));
    assert!(package.contains("<dc:language>vi</dc:language>"));
    assert!(package.contains("property=\"dcterms:modified\""));
    assert!(package.contains("properties=\"nav\""));
    assert!(package.contains("<itemref idref=\"section-1\"/>"));
    assert!(file(&files, "META-INF/container.xml").contains("full-path=\"EPUB/package.opf\""));
    let content = file(&files, "EPUB/section-1.xhtml");
    assert!(content.contains("lang=\"vi\""));
    assert!(content.contains("<ruby>漢<rt>かん</rt></ruby>"));
    assert!(content.contains("<strong>bold<em>crossed</em></strong>"));
    assert!(content.contains("<br/>"));
    assert!(content.contains("<u>underline</u>"));
    assert!(content.contains("href=\"https://example.com/?a=1&amp;b=2\""));
    assert!(content.contains("&lt;script&gt;unsafe()&lt;/script&gt;"));
    assert!(!content.contains('\u{1}'));
    assert!(
        content.contains("<cite class=\"quote-attribution\"><em>Author</em></cite></blockquote>")
    );
    assert!(content.contains("<hr/>"));
}

#[test]
fn epub_links_footnotes_per_row_and_keeps_literal_and_unanchored_notes() {
    let doc = document(
        "Notes",
        vec![
            paragraph("paragraph", "First[1], again [1], literal \\[2]"),
            ExportBlock::Footnote {
                number: 1,
                marker: 1,
                anchor_block: Some(0),
                text: "First note".into(),
            },
            paragraph(
                "paragraph",
                "Second <a href=\"https://example.com\">link[1]</a>",
            ),
            ExportBlock::Footnote {
                number: 2,
                marker: 1,
                anchor_block: Some(2),
                text: "Second note".into(),
            },
            ExportBlock::Footnote {
                number: 3,
                marker: 9,
                anchor_block: None,
                text: "Unanchored note".into(),
            },
        ],
    );
    let files = unpack(&doc);
    let content = file(&files, "EPUB/section-1.xhtml");
    assert_eq!(content.matches("id=\"ref-1\"").count(), 1);
    assert_eq!(content.matches("href=\"#note-1\"").count(), 2);
    assert!(content.contains("literal [2]"));
    assert!(!content.contains("literal <a"));
    assert!(content.contains("link[1]</a><a id=\"ref-3\""));
    for index in [1, 3, 4] {
        assert!(content.contains(&format!("id=\"note-{index}\"")));
        assert!(content.contains(&format!("href=\"#note-{index}\"")));
        assert!(content.contains(&format!("id=\"ref-{index}\"")));
        assert!(content.contains(&format!("href=\"#ref-{index}\"")));
    }
    assert!(content.contains("role=\"doc-footnote\""));
}

#[test]
fn epub_footnote_paragraphs_keep_indentation_and_cross_paragraph_markup() {
    let doc = document(
        "Paragraph notes",
        vec![
            paragraph("paragraph", "Body [1]"),
            ExportBlock::Footnote {
                number: 1,
                marker: 1,
                anchor_block: Some(0),
                text: "<i>First\nSecond</i>\n\nLast".into(),
            },
        ],
    );
    let content = file(&unpack(&doc), "EPUB/section-1.xhtml");
    assert!(content.contains("text-indent:0\"><em>First</em></p>"));
    assert!(content.contains("text-indent:1.5em\"><em>Second</em></p>"));
    assert!(content.contains("text-indent:1.5em\"><br/></p>"));
    assert_eq!(content.matches("id=\"note-1\"").count(), 1);
}

fn part(kind: &str, title: &str, blocks: Vec<ExportBlock>) -> BookPart {
    let item = BookItemInput {
        kind: kind.into(),
        title: title.into(),
        ..Default::default()
    };
    let document = document(title, blocks);
    let document = if kind == "chapter" {
        super::super::chapter_export::apply_book_chapter_title(document, &item)
    } else {
        document
    };
    BookPart { item, document }
}

#[test]
fn epub_book_preserves_order_numbering_metadata_and_live_contents() {
    let mut doc = document("The Book", vec![]);
    let mut title = part("title", "The Book", vec![paragraph("heading1", "The Book")]);
    title.item.author = "Writer & Co".into();
    title.item.translator = "Translator".into();
    let mut contents = part(
        "contents",
        "Contents",
        vec![
            paragraph("heading1", "Contents"),
            paragraph("paragraph", "stale entry"),
        ],
    );
    contents.item.include_h1_headings = true;
    let mut unnumbered = part("chapter", "Afterword", vec![paragraph("paragraph", "End")]);
    unnumbered.item.numbered = Some(false);
    doc.book_parts = vec![
        title,
        contents,
        part(
            "chapter",
            "Chapter One",
            vec![
                paragraph("heading1", "Chapter One"),
                paragraph("heading1", "Subsection"),
            ],
        ),
        unnumbered,
    ];
    let files = unpack(&doc);
    let package = file(&files, "EPUB/package.opf");
    assert!(package.contains("<dc:creator>Writer &amp; Co</dc:creator>"));
    assert!(package.contains("<dc:contributor id=\"translator\">Translator</dc:contributor>"));
    assert!(package.contains("<spine page-progression-direction=\"ltr\"><itemref idref=\"section-1\"/><itemref idref=\"section-2\"/><itemref idref=\"section-3\"/><itemref idref=\"section-4\"/>"));
    let contents = file(&files, "EPUB/section-2.xhtml");
    assert!(contents.contains("href=\"section-3.xhtml#start\">1. Chapter One</a>"));
    assert!(contents.contains("href=\"section-3.xhtml#block-1\">Subsection</a>"));
    assert!(contents.contains("href=\"section-4.xhtml#start\">Afterword</a>"));
    assert!(!contents.contains("stale entry"));
    assert!(file(&files, "EPUB/section-3.xhtml").contains(">1. Chapter One</h1>"));
    assert!(!file(&files, "EPUB/section-4.xhtml").contains("2. Afterword"));
    assert!(file(&files, "EPUB/section-4.xhtml").contains(">Afterword</h1>"));
    assert!(file(&files, "EPUB/nav.xhtml").contains("epub:type=\"toc\""));
}

#[test]
fn epub_titles_outside_the_title_page_are_single_line() {
    let mut doc = document("Project name", vec![]);
    doc.book_parts = vec![
        part(
            "title",
            "The Long\nRoad Home",
            vec![paragraph("heading1", "The Long\nRoad Home")],
        ),
        part(
            "chapter",
            "Chapter One",
            vec![paragraph("paragraph", "Body")],
        ),
    ];
    let files = unpack(&doc);
    assert!(file(&files, "EPUB/package.opf").contains("<dc:title>The Long Road Home</dc:title>"));
    assert!(file(&files, "EPUB/nav.xhtml").contains(">The Long Road Home</a>"));
    let title_page = file(&files, "EPUB/section-1.xhtml");
    assert!(title_page.contains("<title>The Long Road Home</title>"));
    assert!(title_page.contains("The Long<br/>Road Home"));
    // Without a title-page title, the ebook keeps the project's name.
    doc.book_parts[0].item.title.clear();
    assert!(file(&unpack(&doc), "EPUB/package.opf").contains("<dc:title>Project name</dc:title>"));
}

#[test]
fn epub_embeds_uploaded_images_once_and_converts_webp() {
    let path = std::env::temp_dir().join(format!("gnosis-epub-{}.webp", uuid::Uuid::now_v7()));
    let image = image::DynamicImage::new_rgba8(2, 2);
    image
        .save_with_format(&path, image::ImageFormat::WebP)
        .unwrap();
    let block = ExportBlock::Image {
        image: ExportImage::Upload {
            repo_relative_path: "images/test.webp".into(),
            raw_url: None,
            absolute_path: path.clone(),
        },
        caption: "<i>Caption</i> & text".into(),
    };
    let files = unpack(&document("Images", vec![block.clone(), block]));
    fs::remove_file(path).unwrap();
    assert!(image::load_from_memory(&files["EPUB/images/image-1.png"]).is_ok());
    assert!(!files.contains_key("EPUB/images/image-2.png"));
    assert!(file(&files, "EPUB/package.opf")
        .contains("href=\"images/image-1.png\" media-type=\"image/png\""));
    let content = file(&files, "EPUB/section-1.xhtml");
    assert!(content.contains("src=\"images/image-1.png\""));
    assert!(content.contains("alt=\"Caption &amp; text\""));
    assert!(content.contains("<figcaption><em>Caption</em> &amp; text</figcaption>"));
}

fn encoded(image: image::DynamicImage, format: image::ImageFormat) -> Vec<u8> {
    let mut bytes = Cursor::new(Vec::new());
    image.write_to(&mut bytes, format).unwrap();
    bytes.into_inner()
}

#[test]
fn epub_reencodes_opaque_webp_as_jpeg_and_downscales_oversized_images() {
    let photo = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
        40,
        30,
        image::Rgb([200, 120, 40]),
    ));
    let (extension, media_type, bytes) =
        prepare_image(encoded(photo, image::ImageFormat::WebP)).unwrap();
    assert_eq!((extension, media_type), ("jpg", "image/jpeg"));
    assert_eq!(
        image::guess_format(&bytes).unwrap(),
        image::ImageFormat::Jpeg
    );

    // Web photos were embedded at full size, producing 300 MB chapters.
    let wide = image::DynamicImage::ImageRgb8(image::RgbImage::new(4000, 1100));
    let (extension, _, bytes) = prepare_image(encoded(wide, image::ImageFormat::Png)).unwrap();
    assert_eq!(extension, "png");
    let resized = image::load_from_memory(&bytes).unwrap();
    assert!(u64::from(resized.width()) * u64::from(resized.height()) <= MAX_IMAGE_PIXELS);
    assert_eq!(resized.width() / 100, 38);
    assert_eq!(resized.height() / 100, 10);

    // Images within the budget keep their exact bytes.
    let small = encoded(
        image::DynamicImage::ImageRgb8(image::RgbImage::new(8, 8)),
        image::ImageFormat::Jpeg,
    );
    assert_eq!(prepare_image(small.clone()).unwrap().2, small);
}

#[test]
fn epub_loads_images_in_parallel_but_numbers_them_in_document_order_with_progress() {
    let directory = std::env::temp_dir().join(format!("gnosis-epub-{}", uuid::Uuid::now_v7()));
    fs::create_dir_all(&directory).unwrap();
    let blocks: Vec<_> = [9, 3, 9, 5, 7, 2, 4, 6]
        .into_iter()
        .map(|width| {
            let path = directory.join(format!("{width}.png"));
            fs::write(
                &path,
                encoded(
                    image::DynamicImage::ImageRgb8(image::RgbImage::new(width, 1)),
                    image::ImageFormat::Png,
                ),
            )
            .unwrap();
            ExportBlock::Image {
                image: ExportImage::Upload {
                    repo_relative_path: format!("{width}.png"),
                    raw_url: None,
                    absolute_path: path,
                },
                caption: String::new(),
            }
        })
        .collect();
    let mut reports = Vec::new();
    let bytes = render_epub_document(&document("Gallery", blocks), &mut |done, total| {
        reports.push((done, total))
    })
    .unwrap();
    fs::remove_dir_all(directory).unwrap();
    // The repeated image is loaded once: seven distinct images.
    assert_eq!(reports, (0..=7).map(|done| (done, 7)).collect::<Vec<_>>());
    let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
    let widths: Vec<_> = (1..=7)
        .map(|number| {
            let mut data = Vec::new();
            let mut file = archive
                .by_name(&format!("EPUB/images/image-{number}.png"))
                .unwrap();
            assert_eq!(file.compression(), CompressionMethod::Stored);
            file.read_to_end(&mut data).unwrap();
            image::load_from_memory(&data).unwrap().width()
        })
        .collect();
    assert_eq!(widths, [9, 3, 5, 7, 2, 4, 6]);
}

#[test]
fn epub_shows_a_notice_for_remote_images_that_cannot_be_included() {
    // Public-download validation rejects both sources before doing network I/O.
    let image = |url: &str, caption: &str| ExportBlock::Image {
        image: ExportImage::Url(url.into()),
        caption: caption.into(),
    };
    let files = unpack(&document(
        "Remote",
        vec![
            image("http://127.0.0.1/photo.png?a=1&b=2", "Lost <em>photo</em>"),
            image("file:///etc/passwd", ""),
            paragraph("paragraph", "After the images"),
        ],
    ));
    let content = file(&files, "EPUB/section-1.xhtml");
    assert!(content.contains("<p class=\"missing-image\">An image from <a href=\"http://127.0.0.1/photo.png?a=1&amp;b=2\">127.0.0.1</a> could not be included: the image hostname does not resolve exclusively to public addresses.</p><figcaption>Lost <em>photo</em></figcaption>"));
    assert!(content.contains("<p class=\"missing-image\">An image could not be included: only HTTP and HTTPS image URLs are supported.</p></figure>"));
    assert!(content.contains("After the images"));
    assert!(!files.keys().any(|name| name.starts_with("EPUB/images/")));
}

#[test]
fn epub_includes_static_svg_and_rejects_missing_or_unsupported_images() {
    let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>"#;
    assert_eq!(prepare_image(svg.to_vec()).unwrap().1, "image/svg+xml");
    assert!(prepare_image(b"not an image".to_vec()).is_err());
    let block = ExportBlock::Image {
        image: ExportImage::Upload {
            repo_relative_path: "missing.png".into(),
            raw_url: None,
            absolute_path: std::env::temp_dir()
                .join(format!("missing-{}.png", uuid::Uuid::now_v7())),
        },
        caption: String::new(),
    };
    let error =
        render_epub_document(&document("Missing", vec![block]), &mut |_, _| {}).unwrap_err();
    assert!(error.contains("Upload it again"));
}

#[test]
fn epub_custom_html_uses_the_existing_omission_policy_and_rtl_language() {
    let mut doc = document(
        "العربية",
        vec![
            paragraph("custom_html", "<div>Custom &amp; text</div>"),
            paragraph("paragraph", "مرحبا"),
        ],
    );
    doc.language_code = "ar".into();
    let omit = super::super::chapter_export::apply_print_custom_html_policy(&doc, true);
    let files = unpack(&omit);
    assert!(!file(&files, "EPUB/section-1.xhtml").contains("Custom"));
    assert!(file(&files, "EPUB/section-1.xhtml").contains("dir=\"rtl\""));
    assert!(file(&files, "EPUB/package.opf").contains("page-progression-direction=\"rtl\""));
    let flattened = super::super::chapter_export::apply_print_custom_html_policy(&doc, false);
    let files = unpack(&flattened);
    assert!(file(&files, "EPUB/section-1.xhtml").contains("Custom &amp; text"));
    assert!(!file(&files, "EPUB/section-1.xhtml").contains("<div>"));
}

#[test]
fn epub_list_rows_nest_lists_and_keep_their_note_references() {
    let doc = document(
        "Lists",
        vec![
            paragraph("list_number", "One [1]\n\t<b>Two\n\t\tThree</b> & more"),
            ExportBlock::Footnote {
                number: 1,
                marker: 1,
                anchor_block: Some(0),
                text: "First note".into(),
            },
            ExportBlock::Footnote {
                number: 2,
                marker: 2,
                anchor_block: Some(0),
                text: "Unmarked note".into(),
            },
            paragraph("list_bullet", "Dot"),
        ],
    );
    let content = file(&unpack(&doc), "EPUB/section-1.xhtml");
    assert!(content
        .contains("<ol id=\"block-0\" style=\"list-style-type:decimal\"><li>One <a id=\"ref-1\""));
    assert!(content.contains("<ol style=\"list-style-type:lower-alpha\"><li><strong>Two</strong><ol style=\"list-style-type:lower-roman\"><li><strong>Three</strong> &amp; more<a id=\"ref-2\""));
    // The note without a marker follows the last item, inside the list.
    assert!(content.contains("href=\"#note-2\">[2]</a></li></ol></li></ol></li></ol>"));
    assert!(content.contains("<ul id=\"block-3\" style=\"list-style-type:disc\"><li>Dot</li></ul>"));
    assert_eq!(content.matches("id=\"ref-").count(), 2);
}
