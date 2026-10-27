//! Deliberately limited static SVG import profile. Never return the original XML:
//! only supported elements, attributes, and decoded values reach the serializer.
use quick_xml::{
    events::{BytesEnd, BytesStart, BytesText, Event},
    name::ResolveResult,
    NsReader, Writer,
};
use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet},
};

const SVG_NS: &[u8] = b"http://www.w3.org/2000/svg";
const MAX_BYTES: usize = 2 * 1024 * 1024;
const MAX_ELEMENTS: usize = 20_000;
const MAX_DEPTH: usize = 64;
const INVALID: &str = "Choose a self-contained static SVG without scripts, external resources, or embedded HTML. Export unsupported artwork as plain SVG with shapes converted to paths, or choose PNG.";

fn invalid() -> String {
    INVALID.into()
}

fn element_allowed(name: &str) -> bool {
    matches!(
        name,
        "svg"
            | "g"
            | "defs"
            | "path"
            | "rect"
            | "circle"
            | "ellipse"
            | "line"
            | "polyline"
            | "polygon"
            | "linearGradient"
            | "radialGradient"
            | "stop"
            | "clipPath"
            | "title"
            | "desc"
            | "text"
            | "tspan"
    )
}

fn resource(name: &str) -> bool {
    matches!(name, "linearGradient" | "radialGradient" | "clipPath")
}

fn property_allowed(name: &str) -> bool {
    matches!(
        name,
        "fill"
            | "fill-rule"
            | "fill-opacity"
            | "stroke"
            | "stroke-width"
            | "stroke-linecap"
            | "stroke-linejoin"
            | "stroke-miterlimit"
            | "stroke-dasharray"
            | "stroke-dashoffset"
            | "stroke-opacity"
            | "opacity"
            | "color"
            | "clip-path"
            | "clip-rule"
            | "stop-color"
            | "stop-opacity"
            | "display"
            | "visibility"
            | "font-family"
            | "font-size"
            | "font-style"
            | "font-weight"
            | "font-variant"
            | "font-stretch"
            | "text-anchor"
            | "text-decoration"
            | "letter-spacing"
            | "word-spacing"
            | "dominant-baseline"
            | "alignment-baseline"
            | "baseline-shift"
            | "vector-effect"
            | "paint-order"
            | "shape-rendering"
            | "text-rendering"
            | "color-interpolation"
    )
}

fn attribute_allowed(name: &str) -> bool {
    property_allowed(name)
        || matches!(
            name,
            "id" | "version"
                | "width"
                | "height"
                | "viewBox"
                | "preserveAspectRatio"
                | "x"
                | "y"
                | "x1"
                | "y1"
                | "x2"
                | "y2"
                | "cx"
                | "cy"
                | "r"
                | "rx"
                | "ry"
                | "fx"
                | "fy"
                | "fr"
                | "d"
                | "points"
                | "transform"
                | "gradientTransform"
                | "gradientUnits"
                | "spreadMethod"
                | "offset"
                | "clipPathUnits"
                | "dx"
                | "dy"
                | "rotate"
                | "textLength"
                | "lengthAdjust"
        )
}

fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
}

/// References are a complete url(#id) value, never a substring search. No CSS
/// escapes, comments, at-rules, variables, external paths, or fallback URLs.
fn value_allowed(name: &str, value: &str) -> Result<Option<(String, bool)>, String> {
    let value = value.trim();
    if let Some(reference) = value.strip_prefix("url(").and_then(|s| s.strip_suffix(')')) {
        let reference = reference.trim();
        let reference = if reference.len() >= 2
            && ((reference.starts_with('\'') && reference.ends_with('\''))
                || (reference.starts_with('"') && reference.ends_with('"')))
        {
            &reference[1..reference.len().saturating_sub(1)]
        } else {
            reference
        };
        let id = reference
            .strip_prefix('#')
            .filter(|id| identifier(id))
            .ok_or_else(invalid)?;
        if !matches!(name, "fill" | "stroke" | "clip-path") {
            return Err(invalid());
        }
        return Ok(Some((id.into(), name == "clip-path")));
    }
    if value.is_empty()
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b" \t\n\r.,%+-#()".contains(&c))
        || value.to_ascii_lowercase().contains("url")
        || !functions_allowed(name, value)
    {
        return Err(invalid());
    }
    Ok(None)
}

fn functions_allowed(name: &str, value: &str) -> bool {
    let mut remaining = value;
    while let Some(open) = remaining.find('(') {
        let function = remaining[..open].trim();
        let allowed = match name {
            "transform" | "gradientTransform" => matches!(
                function,
                "matrix" | "translate" | "scale" | "rotate" | "skewX" | "skewY"
            ),
            "fill" | "stroke" | "color" | "stop-color" => {
                matches!(function, "rgb" | "rgba" | "hsl" | "hsla")
            }
            _ => false,
        };
        let Some(close) = remaining[open + 1..].find(')').map(|i| i + open + 1) else {
            return false;
        };
        if !allowed
            || !remaining[open + 1..close]
                .bytes()
                .all(|c| c.is_ascii_digit() || b" \t\n\r.,%+-eE".contains(&c))
        {
            return false;
        }
        remaining =
            remaining[close + 1..].trim_start_matches(|c: char| c.is_whitespace() || c == ',');
    }
    !remaining.contains(')')
}

fn xml_text_allowed(text: &str) -> bool {
    text.chars().all(|c| matches!(c, '\t' | '\n' | '\r' | '\u{20}'..='\u{d7ff}' | '\u{e000}'..='\u{fffd}' | '\u{10000}'..='\u{10ffff}'))
}

fn viewport_allowed(attributes: &BTreeMap<String, String>) -> bool {
    let viewbox = attributes.get("viewBox").map(|value| {
        value
            .split(|c: char| c.is_whitespace() || c == ',')
            .filter(|s| !s.is_empty())
            .map(str::parse::<f64>)
            .collect::<Result<Vec<_>, _>>()
    });
    let default = match viewbox {
        Some(Ok(values))
            if values.len() == 4
                && values.iter().all(|n| n.is_finite())
                && values[2] > 0.0
                && values[3] > 0.0 =>
        {
            (values[2], values[3])
        }
        Some(_) => return false,
        None => (600.0, 600.0),
    };
    let dimension = |key: &str, fallback: f64| -> Option<f64> {
        let Some(value) = attributes.get(key) else {
            return Some(fallback);
        };
        for (unit, factor) in [
            ("%", fallback / 100.0),
            ("px", 1.0),
            ("pt", 96.0 / 72.0),
            ("pc", 16.0),
            ("mm", 96.0 / 25.4),
            ("cm", 96.0 / 2.54),
            ("in", 96.0),
            ("", 1.0),
        ] {
            if let Some(number) = value
                .trim()
                .strip_suffix(unit)
                .and_then(|n| n.trim().parse::<f64>().ok())
            {
                return Some(number * factor);
            }
        }
        None
    };
    matches!((dimension("width", default.0), dimension("height", default.1)),
        (Some(w), Some(h)) if w.is_finite() && h.is_finite() && w > 0.0 && h > 0.0 && w <= 32_768.0 && h <= 32_768.0 && w * h <= 100_000_000.0)
}

pub(super) fn sanitize(bytes: &[u8]) -> Result<Cow<'_, [u8]>, String> {
    if bytes.len() > MAX_BYTES {
        return Err("Choose an SVG smaller than 2 MiB, or use a PNG image.".into());
    }
    let source = std::str::from_utf8(bytes).map_err(|_| invalid())?;
    // quick-xml handles XML tokens, not every document-level invariant. Enforce
    // one complete root, UTF-8 XML 1.0, bounded depth/count, and valid text here.
    if !xml_text_allowed(source) {
        return Err(invalid());
    }
    let mut reader = NsReader::from_str(source);
    let mut writer = Writer::new(Vec::new());
    let mut stack = Vec::<String>::new();
    let mut roots = 0;
    let mut elements = 0;
    let mut declaration_seen = false;
    let mut doctype_seen = false;
    let mut ids = BTreeMap::<String, String>::new();
    let mut references = Vec::new();
    loop {
        let event = reader.read_event().map_err(|_| invalid())?;
        match event {
            Event::Start(ref element) | Event::Empty(ref element) => {
                elements += 1;
                if elements > MAX_ELEMENTS || stack.len() >= MAX_DEPTH {
                    return Err("This SVG is too complex. Simplify it or choose PNG.".into());
                }
                let (namespace, local) = reader.resolve_element(element.name());
                if !matches!(namespace, ResolveResult::Bound(ns) if ns.as_ref() == SVG_NS) {
                    return Err(invalid());
                }
                let name = std::str::from_utf8(local.as_ref()).map_err(|_| invalid())?;
                if !element_allowed(name) || (name == "svg" && !stack.is_empty()) {
                    return Err(invalid());
                }
                if stack.is_empty() {
                    roots += 1;
                    if roots != 1 || name != "svg" {
                        return Err(invalid());
                    }
                }
                let in_resource = resource(name) || stack.iter().any(|name| resource(name));
                let mut clean = BytesStart::new(name);
                if stack.is_empty() {
                    clean.push_attribute(("xmlns", "http://www.w3.org/2000/svg"));
                }
                let mut attribute_count = 0;
                let mut attribute_keys = BTreeSet::new();
                let mut viewport = BTreeMap::new();
                for attribute in element.attributes() {
                    let attribute = attribute.map_err(|_| invalid())?;
                    attribute_count += 1;
                    if attribute_count > 128 {
                        return Err(invalid());
                    }
                    let value = attribute
                        .decode_and_unescape_value(&reader)
                        .map_err(|_| invalid())?;
                    if attribute.key.as_ref() == b"xmlns"
                        || attribute.key.as_ref().starts_with(b"xmlns:")
                    {
                        // Namespace declarations are inert, not resource URLs.
                        // Serialize only the canonical SVG namespace.
                        continue;
                    }
                    let (namespace, local) = reader.resolve_attribute(attribute.key);
                    let local = std::str::from_utf8(local.as_ref()).map_err(|_| invalid())?;
                    let key = match namespace {
                        ResolveResult::Unbound => local,
                        ResolveResult::Bound(ns)
                            if ns.as_ref() == b"http://www.w3.org/XML/1998/namespace"
                                && local == "space" =>
                        {
                            "xml:space"
                        }
                        _ => return Err(invalid()),
                    };
                    if stack.is_empty() && matches!(key, "width" | "height" | "viewBox") {
                        viewport.insert(key.to_string(), value.to_string());
                    }
                    if !attribute_keys.insert(key.to_string()) {
                        return Err(invalid());
                    }
                    let mut check_value = |property: &str, value: &str| -> Result<(), String> {
                        if in_resource
                            && matches!(property, "fill" | "stroke" | "clip-path")
                            && matches!(
                                value.trim(),
                                "inherit" | "unset" | "revert" | "revert-layer"
                            )
                        {
                            return Err(invalid());
                        }
                        if let Some(reference) = value_allowed(property, value)? {
                            // Definitions cannot reference other definitions, which
                            // rules out recursive paint/clip resource graphs.
                            if in_resource {
                                return Err(invalid());
                            }
                            references.push(reference);
                        }
                        Ok(())
                    };
                    match key {
                        "style" => {
                            for declaration in value.split(';').filter(|s| !s.trim().is_empty()) {
                                let (property, value) =
                                    declaration.split_once(':').ok_or_else(invalid)?;
                                let property = property.trim();
                                if !property_allowed(property) {
                                    return Err(invalid());
                                }
                                check_value(property, value)?;
                            }
                        }
                        "id" => {
                            if !identifier(&value)
                                || ids.insert(value.to_string(), name.to_string()).is_some()
                            {
                                return Err(invalid());
                            }
                        }
                        "xml:space" if matches!(value.as_ref(), "preserve" | "default") => {}
                        _ if attribute_allowed(key) => check_value(key, &value)?,
                        _ => return Err(invalid()),
                    }
                    // push_attribute takes decoded text and escapes it for XML.
                    clean.push_attribute((key, value.as_ref()));
                }
                if stack.is_empty() && !viewport_allowed(&viewport) {
                    return Err("Choose an SVG with positive dimensions, at most 32,768 pixels per side and 100 million pixels in total, or use PNG.".into());
                }
                if matches!(event, Event::Start(_)) {
                    writer
                        .write_event(Event::Start(clean))
                        .map_err(|_| invalid())?;
                    stack.push(name.to_string());
                } else {
                    writer
                        .write_event(Event::Empty(clean))
                        .map_err(|_| invalid())?;
                }
            }
            Event::End(element) => {
                let name = stack.pop().ok_or_else(invalid)?;
                if element.local_name().as_ref() != name.as_bytes() {
                    return Err(invalid());
                }
                writer
                    .write_event(Event::End(BytesEnd::new(name)))
                    .map_err(|_| invalid())?;
            }
            Event::Text(text) => {
                let text = text.unescape().map_err(|_| invalid())?;
                if !xml_text_allowed(&text) || (stack.is_empty() && !text.trim().is_empty()) {
                    return Err(invalid());
                }
                writer
                    .write_event(Event::Text(BytesText::new(&text)))
                    .map_err(|_| invalid())?;
            }
            Event::CData(text) => {
                if stack.is_empty() {
                    return Err(invalid());
                }
                let text = std::str::from_utf8(text.as_ref()).map_err(|_| invalid())?;
                writer
                    .write_event(Event::Text(BytesText::new(text)))
                    .map_err(|_| invalid())?;
            }
            Event::Decl(declaration) => {
                if declaration_seen
                    || doctype_seen
                    || roots != 0
                    || declaration.version().map_err(|_| invalid())?.as_ref() != b"1.0"
                {
                    return Err(invalid());
                }
                if let Some(encoding) = declaration.encoding() {
                    if !encoding
                        .map_err(|_| invalid())?
                        .eq_ignore_ascii_case(b"UTF-8")
                    {
                        return Err(invalid());
                    }
                }
                declaration_seen = true;
            }
            Event::DocType(doctype) => {
                let declaration = std::str::from_utf8(doctype.as_ref())
                    .map_err(|_| invalid())?
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .replace('\'', "\"");
                if roots != 0
                    || doctype_seen
                    || !matches!(
                        declaration.as_str(),
                        r#"svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd""#
                            | r#"svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "https://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd""#
                    )
                {
                    return Err(invalid());
                }
                doctype_seen = true;
            }
            Event::Comment(_) => {}
            Event::PI(_) => return Err(invalid()),
            Event::Eof => break,
        }
    }
    if roots != 1 || !stack.is_empty() {
        return Err(invalid());
    }
    for (id, clip) in references {
        if !matches!(ids.get(&id), Some(name) if (clip && name == "clipPath") || (!clip && matches!(name.as_str(), "linearGradient" | "radialGradient")))
        {
            return Err(invalid());
        }
    }
    Ok(Cow::Owned(writer.into_inner()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn svg(content: &str) -> String {
        format!(r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">{content}</svg>"#)
    }

    #[test]
    fn accepts_static_artwork_styles_and_local_resources() {
        let source = svg(
            r##"<defs><linearGradient id="paint"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="rgb(0,0,0)"/></linearGradient><clipPath id="clip"><rect width="100" height="50"/></clipPath></defs><g transform="translate(1,2) scale(2)" style="fill:url('#paint');clip-path:url(#clip);stroke-linejoin:round"><path d="M0 0L10 10"/><circle cx="5" cy="5" r="2"/></g><text xml:space="preserve">Tiếng Việt &amp; 日本語</text>"##,
        );
        let normalized = sanitize(source.as_bytes()).unwrap();
        assert_eq!(sanitize(&normalized).unwrap().as_ref(), normalized.as_ref());
        assert!(std::str::from_utf8(&normalized)
            .unwrap()
            .contains("Tiếng Việt &amp; 日本語"));
    }

    #[test]
    fn resolves_namespaces_and_serializes_only_supported_xml() {
        let source = br#"<?xml version="1.0"?><s:svg xmlns:s="http://www.w3.org/2000/svg" xmlns:editor="https://example.com/editor"><!-- note --><s:title><![CDATA[<script>&example;</script>]]></s:title><s:path d="M0 0L1 1"/></s:svg>"#;
        let normalized = sanitize(source).unwrap();
        let text = std::str::from_utf8(&normalized).unwrap();
        assert!(!text.contains("editor"));
        assert!(!text.contains("<!"));
        assert!(!text.contains("<?"));
        assert!(text.contains("&lt;script&gt;&amp;example;&lt;/script&gt;"));
        assert_eq!(sanitize(&normalized).unwrap().as_ref(), normalized.as_ref());
    }

    #[test]
    fn rejects_active_elements_and_namespace_bypasses() {
        for content in [
            "<script>alert(1)</script>",
            "<foreignObject/>",
            "<style>path{fill:red}</style>",
            "<animateTransform/>",
            "<animateMotion/>",
            "<set/>",
            "<a href='#x'/>",
            "<image href='data:image/svg+xml;base64,AAAA'/>",
            "<use href='#x'/>",
            "<svg width='1e300' height='1e300'/>",
            "<s:script xmlns:s='http://www.w3.org/2000/svg'/>",
            "<path xmlns='http://www.w3.org/1999/xhtml'/>",
            "<x:path/>",
            "<path onload='alert(1)'/>",
            "<path xmlns:x='urn:x' x:onload='alert(1)'/>",
            "<path xmlns:xlink='http://www.w3.org/1999/xlink' xlink:href='https://example.com'/>",
            "<path xml:base='https://example.com'/>",
            "<text xmlns:x='http://www.w3.org/XML/1998/namespace' xml:space='preserve' x:space='default'/>",
        ] {
            assert!(sanitize(svg(content).as_bytes()).is_err(), "{content}");
        }
        assert!(sanitize(b"<svg xmlns='http://www.w3.org/1999/xhtml'/>").is_err());
        assert!(sanitize(b"<svg/>").is_err());
    }

    #[test]
    fn rejects_css_url_bypasses_and_nonlocal_or_recursive_references() {
        for value in [
            "url(#paint) url(https://example.com/x)",
            "URL(https://example.com/x)",
            "url(//example.com/x)",
            "url(file:///secret)",
            "url(relative.svg#x)",
            "url(data:image/svg+xml;base64,AAAA)",
            "u\\72l(https://example.com/x)",
            "url/**/(https://example.com/x)",
            "url(&#x68;ttps://example.com/x)",
            "url(&quot;#paint&quot;) url(&quot;/external&quot;)",
            "url(')",
            "url(\")",
            "expression(alert(1))",
            "var(--external)",
        ] {
            for attribute in [
                format!("fill=\"{value}\""),
                format!("style=\"fill:{value}\""),
            ] {
                assert!(
                    sanitize(svg(&format!("<path {attribute}/>")).as_bytes()).is_err(),
                    "{attribute}"
                );
            }
        }
        for content in [
            "<path style='behavior:url(#paint)'/>", "<path style='@import:https://example.com'/>",
            "<path fill='url(#missing)'/>", "<path id='shape' fill='url(#shape)'/>",
            "<defs><linearGradient id='x' fill='url(#x)'/></defs><path fill='url(#x)'/>",
            "<defs><clipPath id='x'><path clip-path='url(#x)'/></clipPath></defs><path clip-path='url(#x)'/>",
            "<defs><linearGradient id='x'/></defs><path clip-path='url(#x)'/>",
            "<defs><clipPath id='x' clip-path='inherit'><path/></clipPath></defs><path clip-path='url(#x)'/>",
        ] {
            assert!(sanitize(svg(content).as_bytes()).is_err(), "{content}");
        }
    }

    #[test]
    fn rejects_malformed_documents_entities_encodings_and_processing_instructions() {
        for source in [
            String::new(),
            svg("<path>"),
            svg("</path>"),
            format!("{}{}", svg(""), svg("")),
            format!("prefix{}", svg("")),
            format!("{}suffix", svg("")),
            svg("<path id='x' id='y'/>"),
            svg("<path id='x'/><circle id='x'/>"),
            svg("<title>&custom;</title>"),
            svg("<title>&#x0;</title>"),
            format!(
                "<?xml-stylesheet href='https://example.com/style.css'?>{}",
                svg("")
            ),
            svg("<?xml-stylesheet href='local.css'?>"),
            format!("<?xml version='1.0' encoding='UTF-16'?>{}", svg("")),
            format!("<?xml version='1.1'?>{}", svg("")),
            format!(
                "<!DOCTYPE svg [<!ENTITY x SYSTEM 'file:///secret'>]>{}",
                svg("<title>&x;</title>")
            ),
            format!(
                "<!DOCTYPE svg SYSTEM 'https://example.com/svg.dtd'>{}",
                svg("")
            ),
        ] {
            assert!(sanitize(source.as_bytes()).is_err(), "{source}");
        }
        assert!(sanitize(b"\xff\xfe<svg/>").is_err());
    }

    #[test]
    fn bounds_input_depth_count_attributes_and_viewport() {
        assert!(sanitize(&vec![b' '; MAX_BYTES + 1]).is_err());
        assert!(sanitize(
            svg(&format!(
                "{}{}",
                "<g>".repeat(MAX_DEPTH),
                "</g>".repeat(MAX_DEPTH)
            ))
            .as_bytes()
        )
        .is_err());
        assert!(sanitize(svg(&"<path/>".repeat(MAX_ELEMENTS)).as_bytes()).is_err());
        let attributes = (0..129)
            .map(|i| format!(" xmlns:x{i}='urn:x{i}'"))
            .collect::<String>();
        assert!(sanitize(svg(&format!("<path{attributes}/>")).as_bytes()).is_err());
        for attributes in [
            "width='1e300' height='100'",
            "width='-1'",
            "height='0'",
            "width='20000' height='20000'",
            "viewBox='0 0 NaN 100'",
            "viewBox='0 0 1e300 100'",
        ] {
            assert!(
                sanitize(
                    format!("<svg xmlns='http://www.w3.org/2000/svg' {attributes}/>").as_bytes()
                )
                .is_err(),
                "{attributes}"
            );
        }
    }
}
