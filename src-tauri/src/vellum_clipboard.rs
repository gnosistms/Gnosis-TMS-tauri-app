use std::io::Cursor;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use plist::{Dictionary, Uid, Value};
use serde::{Deserialize, Serialize};

pub(crate) const VELLUM_TEXT_EDITOR_CONTENT_TYPE: &str = "co.180g.Vellum.TextEditorContent";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VellumClipboardInput {
    decoded_property_list_xml: Option<String>,
    binary_property_list_base64: Option<String>,
    plain_text: Option<String>,
    html: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VellumImagePreparationInput {
    images: Vec<VellumImageResourceRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VellumImageResourceRequest {
    index: usize,
    source: String,
    file_name: Option<String>,
    uti: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreparedVellumImageResource {
    index: usize,
    file_name: String,
    image_key: String,
    preserved_url: String,
    last_absolute_path: String,
    uti: String,
    tooltip: String,
    pixel_width: Option<u32>,
    pixel_height: Option<u32>,
    color_space: String,
    color_space_model: String,
    has_alpha: bool,
    can_upsize: bool,
}

#[tauri::command]
pub(crate) fn copy_vellum_text_editor_content_to_clipboard(
    input: VellumClipboardInput,
) -> Result<(), String> {
    let payload = vellum_payload_bytes(&input)?;
    write_vellum_pasteboard(&payload, input.plain_text.as_deref(), input.html.as_deref())
}

#[tauri::command]
pub(crate) async fn prepare_vellum_image_resources(
    input: VellumImagePreparationInput,
) -> Result<Vec<PreparedVellumImageResource>, String> {
    tauri::async_runtime::spawn_blocking(move || prepare_vellum_image_resources_impl(input))
        .await
        .map_err(|error| format!("Could not prepare Vellum image resources: {error}"))?
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

#[cfg(target_os = "macos")]
fn prepare_vellum_image_resources_impl(
    input: VellumImagePreparationInput,
) -> Result<Vec<PreparedVellumImageResource>, String> {
    use std::collections::HashMap;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    use reqwest::blocking::Client;
    use reqwest::header::CONTENT_TYPE;
    use url::Url;
    use uuid::Uuid;

    let token = Uuid::now_v7().simple().to_string();
    let base_dir = std::env::temp_dir().join("co.180g.Vellum");
    clear_vellum_temp_dir(&base_dir)?;
    let preserved_dir = base_dir.join(format!("preserved-images.{}", &token[..6]));
    let process_dir = base_dir.join(format!("vellum-process-attachment.{}", &token[6..12]));
    fs::create_dir_all(&preserved_dir)
        .map_err(|error| format!("Could not create Vellum preserved image directory: {error}"))?;
    fs::create_dir_all(&process_dir)
        .map_err(|error| format!("Could not create Vellum image metadata directory: {error}"))?;

    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Could not create the image download client: {error}"))?;
    let mut used_names = HashMap::new();
    let mut prepared = Vec::new();

    for request in input.images {
        let source = request.source.trim();
        if source.is_empty() {
            return Err(format!("Image {} is missing a source.", request.index));
        }

        let image_bytes = load_vellum_image_source(source, &client)?;
        let file_name = unique_file_name(
            &sanitize_file_name(
                &request
                    .file_name
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| infer_file_name_from_source(source, request.index)),
            ),
            &mut used_names,
        );
        let uti = request
            .uti
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| infer_uti_from_file_name(&file_name));
        let dimensions = detect_image_dimensions(&image_bytes.bytes);

        let preserved_path = preserved_dir.join(&file_name);
        let process_path = process_dir.join(&file_name);
        fs::write(&preserved_path, &image_bytes.bytes).map_err(|error| {
            format!("Could not write Vellum preserved image '{file_name}': {error}")
        })?;
        fs::write(&process_path, &image_bytes.bytes).map_err(|error| {
            format!("Could not write Vellum image metadata file '{file_name}': {error}")
        })?;

        let preserved_url = Url::from_file_path(&preserved_path)
            .map_err(|()| {
                format!(
                    "Could not convert '{}' to a file URL.",
                    preserved_path.display()
                )
            })?
            .to_string();
        let last_absolute_path = process_path.to_string_lossy().into_owned();
        let tooltip = match (dimensions.width, dimensions.height) {
            (Some(width), Some(height)) => format!("{file_name}\n{width} × {height} px"),
            _ => file_name.clone(),
        };

        prepared.push(PreparedVellumImageResource {
            index: request.index,
            file_name: file_name.clone(),
            image_key: image_key_from_file_name(&file_name),
            preserved_url,
            last_absolute_path,
            uti,
            tooltip,
            pixel_width: dimensions.width,
            pixel_height: dimensions.height,
            color_space: "sRGB".to_string(),
            color_space_model: "RGB".to_string(),
            has_alpha: dimensions.has_alpha.unwrap_or(false),
            can_upsize: false,
        });
    }

    struct LoadedImageBytes {
        bytes: Vec<u8>,
    }

    fn load_vellum_image_source(source: &str, client: &Client) -> Result<LoadedImageBytes, String> {
        if let Ok(url) = Url::parse(source) {
            match url.scheme() {
                "http" | "https" => {
                    let response = client.get(url).send().map_err(|error| {
                        format!("Could not download Vellum image '{source}': {error}")
                    })?;
                    let status = response.status();
                    if !status.is_success() {
                        return Err(format!(
                            "Could not download Vellum image '{source}': HTTP {status}."
                        ));
                    }
                    let _content_type = response
                        .headers()
                        .get(CONTENT_TYPE)
                        .and_then(|value| value.to_str().ok())
                        .unwrap_or("");
                    let bytes = response
                        .bytes()
                        .map_err(|error| {
                            format!("Could not read Vellum image '{source}': {error}")
                        })?
                        .to_vec();
                    return Ok(LoadedImageBytes { bytes });
                }
                "file" => {
                    let path = url.to_file_path().map_err(|()| {
                        format!("Could not read Vellum image file URL '{source}'.")
                    })?;
                    return read_local_image_source(&path);
                }
                _ => {}
            }
        }

        let path = PathBuf::from(source);
        if path.is_absolute() {
            return read_local_image_source(&path);
        }

        Err(format!(
            "Vellum image source '{source}' is not a supported image URL or absolute file path."
        ))
    }

    fn read_local_image_source(path: &Path) -> Result<LoadedImageBytes, String> {
        let bytes = fs::read(path).map_err(|error| {
            format!("Could not read Vellum image '{}': {error}", path.display())
        })?;
        Ok(LoadedImageBytes { bytes })
    }

    fn clear_vellum_temp_dir(base_dir: &Path) -> Result<(), String> {
        if !base_dir.exists() {
            return Ok(());
        }

        if base_dir.is_dir() {
            fs::remove_dir_all(base_dir).map_err(|error| {
                format!(
                    "Could not clear stale Vellum image temp directory '{}': {error}",
                    base_dir.display()
                )
            })?;
            return Ok(());
        }

        fs::remove_file(base_dir).map_err(|error| {
            format!(
                "Could not clear stale Vellum image temp file '{}': {error}",
                base_dir.display()
            )
        })
    }

    fn infer_file_name_from_source(source: &str, index: usize) -> String {
        if let Ok(url) = Url::parse(source) {
            if let Some(name) = url
                .path_segments()
                .and_then(|mut segments| segments.next_back())
                .filter(|name| !name.trim().is_empty())
            {
                return name.to_string();
            }
        }
        Path::new(source)
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("image-{index}"))
    }

    fn sanitize_file_name(file_name: &str) -> String {
        let normalized = file_name.replace('\\', "/");
        let leaf = normalized
            .rsplit('/')
            .next()
            .unwrap_or(file_name)
            .trim()
            .trim_matches('.');
        let sanitized = leaf
            .chars()
            .map(|ch| {
                if ch.is_control() || matches!(ch, '/' | '\\' | ':') {
                    '_'
                } else {
                    ch
                }
            })
            .collect::<String>();
        if sanitized.trim().is_empty() {
            "image".to_string()
        } else {
            sanitized
        }
    }

    fn unique_file_name(file_name: &str, used_names: &mut HashMap<String, usize>) -> String {
        let key = file_name.to_ascii_lowercase();
        let count = used_names.entry(key).or_insert(0);
        *count += 1;
        if *count == 1 {
            return file_name.to_string();
        }

        match file_name.rsplit_once('.') {
            Some((stem, extension)) if !stem.is_empty() && !extension.is_empty() => {
                format!("{stem} {count}.{extension}")
            }
            _ => format!("{file_name} {count}"),
        }
    }

    fn infer_uti_from_file_name(file_name: &str) -> String {
        match file_name
            .rsplit_once('.')
            .map(|(_, extension)| extension.to_ascii_lowercase())
            .as_deref()
        {
            Some("jpg") | Some("jpeg") => "public.jpeg".to_string(),
            Some("png") => "public.png".to_string(),
            Some("gif") => "com.compuserve.gif".to_string(),
            Some("webp") => "org.webmproject.webp".to_string(),
            _ => String::new(),
        }
    }

    fn image_key_from_file_name(file_name: &str) -> String {
        let stem = file_name
            .rsplit_once('.')
            .map(|(stem, _)| stem)
            .unwrap_or(file_name);
        let mut key = String::new();
        let mut previous_separator = false;
        for ch in stem.chars().flat_map(char::to_lowercase) {
            if ch.is_ascii_alphanumeric() {
                key.push(ch);
                previous_separator = false;
            } else if !previous_separator {
                key.push('_');
                previous_separator = true;
            }
        }
        let key = key.trim_matches('_').to_string();
        if key.is_empty() {
            "image".to_string()
        } else {
            key
        }
    }

    #[derive(Default)]
    struct ImageDimensions {
        width: Option<u32>,
        height: Option<u32>,
        has_alpha: Option<bool>,
    }

    fn detect_image_dimensions(bytes: &[u8]) -> ImageDimensions {
        detect_png_dimensions(bytes)
            .or_else(|| detect_jpeg_dimensions(bytes))
            .or_else(|| detect_gif_dimensions(bytes))
            .or_else(|| detect_webp_dimensions(bytes))
            .unwrap_or_default()
    }

    fn detect_png_dimensions(bytes: &[u8]) -> Option<ImageDimensions> {
        if bytes.len() < 26 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR" {
            return None;
        }
        Some(ImageDimensions {
            width: Some(u32::from_be_bytes(bytes[16..20].try_into().ok()?)),
            height: Some(u32::from_be_bytes(bytes[20..24].try_into().ok()?)),
            has_alpha: Some(matches!(bytes[25], 4 | 6)),
        })
    }

    fn detect_gif_dimensions(bytes: &[u8]) -> Option<ImageDimensions> {
        if bytes.len() < 10 || !matches!(&bytes[..6], b"GIF87a" | b"GIF89a") {
            return None;
        }
        Some(ImageDimensions {
            width: Some(u16::from_le_bytes(bytes[6..8].try_into().ok()?) as u32),
            height: Some(u16::from_le_bytes(bytes[8..10].try_into().ok()?) as u32),
            has_alpha: Some(false),
        })
    }

    fn detect_jpeg_dimensions(bytes: &[u8]) -> Option<ImageDimensions> {
        if bytes.len() < 4 || bytes[0] != 0xff || bytes[1] != 0xd8 {
            return None;
        }
        let mut cursor = 2;
        while cursor + 4 <= bytes.len() {
            if bytes[cursor] != 0xff {
                cursor += 1;
                continue;
            }
            while cursor < bytes.len() && bytes[cursor] == 0xff {
                cursor += 1;
            }
            if cursor >= bytes.len() {
                break;
            }
            let marker = bytes[cursor];
            cursor += 1;
            if matches!(marker, 0xd8 | 0xd9 | 0x01 | 0xd0..=0xd7) {
                continue;
            }
            if cursor + 2 > bytes.len() {
                break;
            }
            let segment_len =
                u16::from_be_bytes(bytes[cursor..cursor + 2].try_into().ok()?) as usize;
            if segment_len < 2 || cursor + segment_len > bytes.len() {
                break;
            }
            if matches!(
                marker,
                0xc0 | 0xc1
                    | 0xc2
                    | 0xc3
                    | 0xc5
                    | 0xc6
                    | 0xc7
                    | 0xc9
                    | 0xca
                    | 0xcb
                    | 0xcd
                    | 0xce
                    | 0xcf
            ) && segment_len >= 7
            {
                return Some(ImageDimensions {
                    height: Some(
                        u16::from_be_bytes(bytes[cursor + 3..cursor + 5].try_into().ok()?) as u32,
                    ),
                    width: Some(
                        u16::from_be_bytes(bytes[cursor + 5..cursor + 7].try_into().ok()?) as u32,
                    ),
                    has_alpha: Some(false),
                });
            }
            cursor += segment_len;
        }
        None
    }

    fn detect_webp_dimensions(bytes: &[u8]) -> Option<ImageDimensions> {
        if bytes.len() < 20 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
            return None;
        }
        let mut cursor = 12;
        while cursor + 8 <= bytes.len() {
            let chunk = &bytes[cursor..cursor + 4];
            let chunk_size =
                u32::from_le_bytes(bytes[cursor + 4..cursor + 8].try_into().ok()?) as usize;
            let data_start = cursor + 8;
            let data_end = data_start.checked_add(chunk_size)?;
            if data_end > bytes.len() {
                break;
            }

            if chunk == b"VP8X" && chunk_size >= 10 {
                let flags = bytes[data_start];
                return Some(ImageDimensions {
                    width: Some(1 + read_webp_u24(&bytes[data_start + 4..data_start + 7])?),
                    height: Some(1 + read_webp_u24(&bytes[data_start + 7..data_start + 10])?),
                    has_alpha: Some(flags & 0x10 != 0),
                });
            }
            if chunk == b"VP8L" && chunk_size >= 5 && bytes[data_start] == 0x2f {
                let b0 = bytes[data_start + 1] as u32;
                let b1 = bytes[data_start + 2] as u32;
                let b2 = bytes[data_start + 3] as u32;
                let b3 = bytes[data_start + 4] as u32;
                return Some(ImageDimensions {
                    width: Some(1 + (((b1 & 0x3f) << 8) | b0)),
                    height: Some(1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))),
                    has_alpha: Some(false),
                });
            }
            if chunk == b"VP8 "
                && chunk_size >= 10
                && &bytes[data_start + 3..data_start + 6] == b"\x9d\x01\x2a"
            {
                return Some(ImageDimensions {
                    width: Some(
                        (u16::from_le_bytes(bytes[data_start + 6..data_start + 8].try_into().ok()?)
                            & 0x3fff) as u32,
                    ),
                    height: Some(
                        (u16::from_le_bytes(
                            bytes[data_start + 8..data_start + 10].try_into().ok()?,
                        ) & 0x3fff) as u32,
                    ),
                    has_alpha: Some(false),
                });
            }

            cursor = data_end + (chunk_size % 2);
        }
        None
    }

    fn read_webp_u24(bytes: &[u8]) -> Option<u32> {
        if bytes.len() != 3 {
            return None;
        }
        Some(bytes[0] as u32 | ((bytes[1] as u32) << 8) | ((bytes[2] as u32) << 16))
    }

    Ok(prepared)
}

#[cfg(not(target_os = "macos"))]
fn prepare_vellum_image_resources_impl(
    _input: VellumImagePreparationInput,
) -> Result<Vec<PreparedVellumImageResource>, String> {
    Err("Vellum image preparation is only available on macOS.".to_string())
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
    fn prepares_local_image_resources_as_vellum_temp_files() {
        let source_dir = std::env::temp_dir().join(format!(
            "gnosis-vellum-image-test-{}",
            uuid::Uuid::now_v7().simple()
        ));
        std::fs::create_dir_all(&source_dir).expect("create source image dir");
        let source_path = source_dir.join("Source Image.png");
        let bytes = tiny_png_bytes(2, 3, 6);
        std::fs::write(&source_path, &bytes).expect("write source image");
        let stale_dir = std::env::temp_dir()
            .join("co.180g.Vellum")
            .join("preserved-images.stale");
        std::fs::create_dir_all(&stale_dir).expect("create stale Vellum temp dir");
        let stale_file = stale_dir.join("stale.png");
        std::fs::write(&stale_file, b"stale").expect("write stale Vellum temp file");

        let prepared = prepare_vellum_image_resources_impl(VellumImagePreparationInput {
            images: vec![VellumImageResourceRequest {
                index: 1,
                source: source_path.to_string_lossy().into_owned(),
                file_name: Some("Source Image.png".to_string()),
                uti: Some("public.png".to_string()),
            }],
        })
        .expect("prepare image resources");

        assert!(
            !stale_file.exists(),
            "preparing a new Vellum image copy should clear stale temp files"
        );
        assert_eq!(prepared.len(), 1);
        let image = &prepared[0];
        assert_eq!(image.index, 1);
        assert_eq!(image.file_name, "Source Image.png");
        assert_eq!(image.image_key, "source_image");
        assert_eq!(image.uti, "public.png");
        assert_eq!(image.pixel_width, Some(2));
        assert_eq!(image.pixel_height, Some(3));
        assert!(image.has_alpha);
        assert!(!image.can_upsize);
        assert_eq!(image.color_space, "sRGB");
        assert_eq!(image.color_space_model, "RGB");
        assert!(image.preserved_url.starts_with("file:///"));
        assert!(image
            .preserved_url
            .contains("/co.180g.Vellum/preserved-images."));
        assert!(image
            .last_absolute_path
            .contains("/co.180g.Vellum/vellum-process-attachment."));
        assert!(image.tooltip.contains("Source Image.png\n2 × 3 px"));

        let preserved_path = url::Url::parse(&image.preserved_url)
            .expect("parse preserved url")
            .to_file_path()
            .expect("preserved file path");
        assert_eq!(
            std::fs::read(preserved_path).expect("read preserved image"),
            bytes
        );
        assert_eq!(
            std::fs::read(&image.last_absolute_path).expect("read process image"),
            bytes
        );
    }

    #[cfg(target_os = "macos")]
    fn tiny_png_bytes(width: u32, height: u32, color_type: u8) -> Vec<u8> {
        let mut bytes = Vec::from(&b"\x89PNG\r\n\x1a\n"[..]);
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.push(8);
        bytes.push(color_type);
        bytes.extend_from_slice(&[0, 0, 0]);
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn image_resource_preparation_is_macos_only() {
        let error =
            prepare_vellum_image_resources_impl(VellumImagePreparationInput { images: vec![] })
                .expect_err("non-macOS should reject image preparation");

        assert!(error.contains("only available on macOS"));
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
