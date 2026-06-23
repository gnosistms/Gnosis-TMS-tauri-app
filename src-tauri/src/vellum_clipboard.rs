use std::io::Cursor;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use plist::{Dictionary, Uid, Value};
use serde::Deserialize;

pub(crate) const VELLUM_TEXT_EDITOR_CONTENT_TYPE: &str = "co.180g.Vellum.TextEditorContent";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VellumClipboardInput {
    decoded_property_list_xml: Option<String>,
    binary_property_list_base64: Option<String>,
    plain_text: Option<String>,
    html: Option<String>,
}

#[tauri::command]
pub(crate) fn copy_vellum_text_editor_content_to_clipboard(
    input: VellumClipboardInput,
) -> Result<(), String> {
    let payload = vellum_payload_bytes(&input)?;
    write_vellum_pasteboard(&payload, input.plain_text.as_deref(), input.html.as_deref())
}

fn vellum_payload_bytes(input: &VellumClipboardInput) -> Result<Vec<u8>, String> {
    match (
        input.decoded_property_list_xml.as_deref(),
        input.binary_property_list_base64.as_deref(),
    ) {
        (Some(xml), None) => binary_plist_from_decoded_xml(xml),
        (None, Some(base64)) => binary_plist_from_base64(base64),
        (None, None) => Err("Provide Vellum binary plist base64 or decoded plist XML.".to_string()),
        (Some(_), Some(_)) => Err("Provide only one Vellum pasteboard payload format.".to_string()),
    }
}

fn binary_plist_from_decoded_xml(xml: &str) -> Result<Vec<u8>, String> {
    let mut value = Value::from_reader_xml(xml.as_bytes())
        .map_err(|error| format!("Could not parse the decoded Vellum plist XML: {error}"))?;
    normalize_cf_uid_dictionaries(&mut value);
    validate_vellum_archive(&value)?;

    let mut bytes = Vec::new();
    value
        .to_writer_binary(&mut bytes)
        .map_err(|error| format!("Could not encode the Vellum plist as binary data: {error}"))?;
    Ok(bytes)
}

fn binary_plist_from_base64(base64: &str) -> Result<Vec<u8>, String> {
    let normalized = base64.split_whitespace().collect::<String>();
    let bytes = BASE64_STANDARD
        .decode(normalized)
        .map_err(|error| format!("Could not decode the Vellum binary plist base64: {error}"))?;
    if !bytes.starts_with(b"bplist00") {
        return Err("The Vellum payload is not binary plist data.".to_string());
    }

    let value = Value::from_reader(Cursor::new(&bytes))
        .map_err(|error| format!("Could not parse the Vellum binary plist: {error}"))?;
    validate_vellum_archive(&value)?;
    Ok(bytes)
}

fn normalize_cf_uid_dictionaries(value: &mut Value) {
    match value {
        Value::Array(items) => {
            for item in items {
                normalize_cf_uid_dictionaries(item);
            }
        }
        Value::Dictionary(dict) => {
            if let Some(uid) = cf_uid_value(dict) {
                *value = Value::Uid(Uid::new(uid));
                return;
            }
            for item in dict.values_mut() {
                normalize_cf_uid_dictionaries(item);
            }
        }
        _ => {}
    }
}

fn cf_uid_value(dict: &Dictionary) -> Option<u64> {
    if dict.len() != 1 {
        return None;
    }
    let Value::Integer(value) = dict.get("CF$UID")? else {
        return None;
    };
    value.as_unsigned()
}

fn validate_vellum_archive(value: &Value) -> Result<(), String> {
    let Value::Dictionary(dict) = value else {
        return Err("The Vellum payload root is not a property-list dictionary.".to_string());
    };

    match dict.get("$archiver").and_then(Value::as_string) {
        Some("OGImagePreservingArchiver") => {}
        Some(archiver) => {
            return Err(format!(
                "The Vellum payload uses unsupported archiver '{archiver}'."
            ));
        }
        None => return Err("The Vellum payload is missing its keyed archiver name.".to_string()),
    }

    if !matches!(dict.get("$objects"), Some(Value::Array(_))) {
        return Err("The Vellum payload is missing its keyed object table.".to_string());
    }
    if !matches!(dict.get("$top"), Some(Value::Dictionary(_))) {
        return Err("The Vellum payload is missing its keyed archive root.".to_string());
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn write_vellum_pasteboard(
    payload: &[u8],
    plain_text: Option<&str>,
    html: Option<&str>,
) -> Result<(), String> {
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::{NSData, NSString};

    let pasteboard = NSPasteboard::generalPasteboard();
    pasteboard.clearContents();

    let vellum_type = NSString::from_str(VELLUM_TEXT_EDITOR_CONTENT_TYPE);
    let vellum_data = NSData::with_bytes(payload);
    if !pasteboard.setData_forType(Some(&vellum_data), &vellum_type) {
        return Err("Could not write Vellum data to the pasteboard.".to_string());
    }

    if let Some(text) = non_empty_string(plain_text) {
        let text = NSString::from_str(text);
        let text_type = NSString::from_str("public.utf8-plain-text");
        pasteboard.setString_forType(&text, &text_type);
    }

    if let Some(html) = non_empty_string(html) {
        let html = NSString::from_str(html);
        let html_type = NSString::from_str("public.html");
        pasteboard.setString_forType(&html, &html_type);
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn write_vellum_pasteboard(
    _payload: &[u8],
    _plain_text: Option<&str>,
    _html: Option<&str>,
) -> Result<(), String> {
    Err("Vellum pasteboard export is only available on macOS.".to_string())
}

fn non_empty_string(value: Option<&str>) -> Option<&str> {
    value.and_then(|text| {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(text)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decoded_vellum_xml() -> &'static str {
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>$archiver</key>
  <string>OGImagePreservingArchiver</string>
  <key>$objects</key>
  <array>
    <string>$null</string>
    <dict>
      <key>$class</key>
      <dict>
        <key>CF$UID</key>
        <integer>2</integer>
      </dict>
      <key>NSString</key>
      <dict>
        <key>CF$UID</key>
        <integer>3</integer>
      </dict>
    </dict>
    <dict>
      <key>$classes</key>
      <array>
        <string>NSMutableAttributedString</string>
        <string>NSAttributedString</string>
        <string>NSObject</string>
      </array>
      <key>$classname</key>
      <string>NSMutableAttributedString</string>
    </dict>
    <string>Vellum text</string>
  </array>
  <key>$top</key>
  <dict>
    <key>$0</key>
    <dict>
      <key>CF$UID</key>
      <integer>1</integer>
    </dict>
  </dict>
  <key>$version</key>
  <integer>100000</integer>
</dict>
</plist>"#
    }

    #[test]
    fn decoded_xml_payload_is_reencoded_as_binary_plist_with_uids() {
        let bytes = binary_plist_from_decoded_xml(decoded_vellum_xml()).expect("binary plist");
        assert!(bytes.starts_with(b"bplist00"));

        let value = Value::from_reader(Cursor::new(bytes)).expect("parse binary plist");
        let dict = value.as_dictionary().expect("root dictionary");
        let top = dict
            .get("$top")
            .and_then(Value::as_dictionary)
            .expect("top dictionary");
        assert_eq!(
            top.get("$0").and_then(Value::as_uid).map(|uid| uid.get()),
            Some(1)
        );

        let objects = dict
            .get("$objects")
            .and_then(Value::as_array)
            .expect("object table");
        let object = objects[1].as_dictionary().expect("object dictionary");
        assert_eq!(
            object
                .get("$class")
                .and_then(Value::as_uid)
                .map(|uid| uid.get()),
            Some(2)
        );
        assert_eq!(
            object
                .get("NSString")
                .and_then(Value::as_uid)
                .map(|uid| uid.get()),
            Some(3)
        );
    }

    #[test]
    fn binary_base64_payload_is_validated_and_returned() {
        let bytes = binary_plist_from_decoded_xml(decoded_vellum_xml()).expect("binary plist");
        let encoded = BASE64_STANDARD.encode(&bytes);
        let decoded = binary_plist_from_base64(&encoded).expect("base64 payload");
        assert_eq!(decoded, bytes);
    }

    #[test]
    fn payload_input_requires_one_payload_format() {
        let none = VellumClipboardInput {
            decoded_property_list_xml: None,
            binary_property_list_base64: None,
            plain_text: None,
            html: None,
        };
        assert!(vellum_payload_bytes(&none).is_err());

        let both = VellumClipboardInput {
            decoded_property_list_xml: Some(decoded_vellum_xml().to_string()),
            binary_property_list_base64: Some("YmFk".to_string()),
            plain_text: None,
            html: None,
        };
        assert!(vellum_payload_bytes(&both).is_err());
    }

    #[test]
    fn unsupported_archiver_is_rejected() {
        let xml = decoded_vellum_xml().replace("OGImagePreservingArchiver", "NSKeyedArchiver");
        let error = binary_plist_from_decoded_xml(&xml).expect_err("unsupported archiver");
        assert!(error.contains("unsupported archiver"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "writes to the global macOS pasteboard"]
    fn smoke_writes_vellum_payload_to_general_pasteboard() {
        use objc2_app_kit::NSPasteboard;
        use objc2_foundation::NSString;

        let fixture_path = std::env::var("VELLUM_CLIPBOARD_SMOKE_XML")
            .expect("set VELLUM_CLIPBOARD_SMOKE_XML to a decoded Vellum plist XML file");
        let xml = std::fs::read_to_string(&fixture_path).expect("read Vellum smoke fixture");
        let input = VellumClipboardInput {
            decoded_property_list_xml: Some(xml),
            binary_property_list_base64: None,
            plain_text: Some("Gnosis TMS Vellum clipboard smoke test".to_string()),
            html: None,
        };
        let expected_payload = vellum_payload_bytes(&input).expect("expected binary payload");

        copy_vellum_text_editor_content_to_clipboard(input).expect("write Vellum pasteboard");

        let pasteboard = NSPasteboard::generalPasteboard();
        let vellum_type = NSString::from_str(VELLUM_TEXT_EDITOR_CONTENT_TYPE);
        let data = pasteboard
            .dataForType(&vellum_type)
            .expect("read Vellum data back from pasteboard");
        let actual_payload = data.to_vec();

        assert!(actual_payload.starts_with(b"bplist00"));
        assert_eq!(actual_payload, expected_payload);
        eprintln!(
            "wrote {} bytes as {}",
            actual_payload.len(),
            VELLUM_TEXT_EDITOR_CONTENT_TYPE
        );
    }
}
