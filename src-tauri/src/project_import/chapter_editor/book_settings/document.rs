use serde_json::{json, Map, Value};

pub(super) const SETTINGS_PATH: &str = ".gtms/export-settings.json";
pub(super) const IMAGE_ROOT: &str = ".gtms/export-images";
pub(super) const MAX_SETTINGS_BYTES: usize = 2 * 1024 * 1024;

fn pick(value: &Value, keys: &[&str]) -> Map<String, Value> {
    keys.iter()
        .filter_map(|key| value.get(*key).map(|value| ((*key).into(), value.clone())))
        .collect()
}

pub(super) fn normalize(value: Value) -> Result<Value, String> {
    if value["version"] != 1 || !value["layouts"].is_object() {
        return Err("The saved export settings use an unsupported format.".into());
    }
    if serde_json::to_vec(&value).map_err(|e| e.to_string())?.len() > MAX_SETTINGS_BYTES {
        return Err("The saved export settings are too large.".into());
    }
    let mut layouts = Map::new();
    for (code, layout) in value["layouts"].as_object().unwrap() {
        if code.is_empty()
            || code.len() > 64
            || !code
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
        {
            return Err("The saved export settings contain an invalid language.".into());
        }
        let items = layout["items"]
            .as_array()
            .ok_or("The saved export layout is invalid.")?;
        let mut normalized = Vec::new();
        let mut ids = std::collections::BTreeSet::new();
        for item in items {
            let id = item["id"]
                .as_str()
                .filter(|id| !id.is_empty())
                .ok_or("An export item has no identifier.")?;
            let kind = item["kind"].as_str().ok_or("An export item has no type.")?;
            if !ids.insert(id)
                || !matches!(
                    kind,
                    "chapter" | "title" | "copyright" | "dedication" | "contents" | "image"
                )
            {
                return Err("The saved export layout contains an invalid item.".into());
            }
            let mut output = pick(
                item,
                &[
                    "id",
                    "kind",
                    "chapterId",
                    "title",
                    "subtitle",
                    "author",
                    "translator",
                    "text",
                    "caption",
                ],
            );
            if output.values().any(|value| !value.is_string()) {
                return Err("An export item contains invalid text.".into());
            }
            for flag in ["excluded", "numbered", "includeH1Headings"] {
                if let Some(value) = item.get(flag) {
                    if !value.is_boolean() {
                        return Err("An export item contains an invalid option.".into());
                    }
                    output.insert(flag.into(), value.clone());
                }
            }
            output.entry("excluded").or_insert(false.into());
            if kind == "chapter" {
                output.entry("numbered").or_insert(true.into());
            }
            if kind == "contents" {
                output.entry("includeH1Headings").or_insert(false.into());
            }
            if let Some(image) = item.get("image").filter(|value| !value.is_null()) {
                let asset = image["assetId"]
                    .as_str()
                    .ok_or("A saved export image is invalid.")?;
                validate_asset_id(asset)?;
                if let Some(prepared) = image.get("vellumAssetId") {
                    let id = prepared
                        .as_str()
                        .ok_or("A saved export image is invalid.")?;
                    validate_asset_id(id)?;
                    if !id.ends_with(".png") {
                        return Err("A prepared export image is invalid.".into());
                    }
                }
                let mut image = pick(image, &["assetId", "fileName", "vellumAssetId"]);
                if image.values().any(|value| !value.is_string()) {
                    return Err("A saved export image is invalid.".into());
                }
                image.insert("assetId".into(), asset.into());
                output.insert("image".into(), image.into());
            }
            normalized.push(Value::Object(output));
        }
        let options = pick(&layout["options"], &["pdfPaperSize"]);
        if options.values().any(|value| !value.is_string()) {
            return Err("The saved paper size is invalid.".into());
        }
        layouts.insert(
            code.clone(),
            json!({ "options": options, "items": normalized }),
        );
    }
    Ok(json!({ "version": 1, "layouts": layouts }))
}

pub(super) fn validate_asset_id(id: &str) -> Result<(), String> {
    let (hash, extension) = id
        .split_once('.')
        .ok_or("A saved export image is invalid.")?;
    if hash.len() != 64
        || !hash.bytes().all(|b| b.is_ascii_hexdigit())
        || !matches!(extension, "png" | "jpg" | "webp" | "svg")
    {
        return Err("A saved export image is invalid.".into());
    }
    Ok(())
}

pub(super) fn assets(value: &Value) -> Vec<String> {
    value["layouts"]
        .as_object()
        .into_iter()
        .flat_map(|layouts| layouts.values())
        .flat_map(|layout| layout["items"].as_array().into_iter().flatten())
        .flat_map(|item| {
            ["assetId", "vellumAssetId"]
                .into_iter()
                .filter_map(move |key| item["image"][key].as_str().map(String::from))
        })
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect()
}

/// Languages are independent. Concurrent changes to the same language take the
/// remote value; unrelated local language edits can still be saved.
pub(super) fn merge(base: Option<&Value>, local: &Value, remote: Option<&Value>) -> Value {
    let mut layouts = Map::new();
    let empty = Map::new();
    let base = base
        .and_then(|value| value["layouts"].as_object())
        .unwrap_or(&empty);
    let local = local["layouts"].as_object().unwrap_or(&empty);
    let remote = remote
        .and_then(|value| value["layouts"].as_object())
        .unwrap_or(&empty);
    for code in base.keys().chain(local.keys()).chain(remote.keys()) {
        let value = if remote.get(code) != base.get(code) {
            remote.get(code)
        } else {
            local.get(code)
        };
        if let Some(value) = value {
            layouts.insert(code.clone(), value.clone());
        }
    }
    json!({ "version": 1, "layouts": layouts })
}

pub(crate) fn resolve_conflict(
    base: Option<&str>,
    local: Option<&str>,
    remote: Option<&str>,
) -> Result<Option<String>, String> {
    let parse = |text: &str| {
        normalize(serde_json::from_str(text).map_err(|_| "The export settings JSON is invalid.")?)
    };
    let Some(remote) = remote else {
        return Ok(None);
    };
    let remote = parse(remote)?;
    let base = base.map(parse).transpose()?;
    let Some(local) = local else {
        return serde_json::to_string(&remote)
            .map(Some)
            .map_err(|e| e.to_string());
    };
    let merged = merge(base.as_ref(), &parse(local)?, Some(&remote));
    serde_json::to_string(&merged)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn conflicts_take_remote_per_language_and_keep_nonconflicting_local_edits() {
        let base = json!({"layouts":{"en":{"title":"A"},"vi":{"title":"A"}}});
        let local = json!({"layouts":{"en":{"title":"Local"},"vi":{"title":"Local"}}});
        let remote = json!({"layouts":{"en":{"title":"Remote"},"vi":{"title":"A"}}});
        let merged = merge(Some(&base), &local, Some(&remote));
        assert_eq!(merged["layouts"]["en"]["title"], "Remote");
        assert_eq!(merged["layouts"]["vi"]["title"], "Local");
        assert!(resolve_conflict(None, None, None).unwrap().is_none());
    }
    #[test]
    fn portable_settings_drop_secrets_paths_and_screen_state() {
        let id = format!("{}.svg", "a".repeat(64));
        let value = normalize(json!({"version":1,"languageCode":"vi","layouts":{"en":{
            "selectedItemId":"title","items":[{"id":"title","kind":"title","image":{"assetId":id,"filePath":"/private/path","dataUrl":"unsafe"}}],
            "options":{"password":"secret","wordpress":{"password":"secret","connection":{"siteId":"1","token":"secret"}}}
        }}})).unwrap();
        let serialized = value.to_string();
        for absent in [
            "secret",
            "/private/path",
            "dataUrl",
            "selectedItemId",
            "languageCode",
        ] {
            assert!(!serialized.contains(absent));
        }
        assert!(normalize(json!({"version":99,"layouts":{}})).is_err());
        assert!(validate_asset_id("../../outside.svg").is_err());
    }

    #[test]
    fn schema_normalizes_defaults_and_preserves_only_page_one_options() {
        let original = format!("{}.svg", "a".repeat(64));
        let prepared = format!("{}.png", "b".repeat(64));
        let value = normalize(json!({"version":1,"layouts":{"vi":{
            "options":{"pdfPaperSize":"a5","selectedOptionId":"link:wordpress","wordpress":{"password":"secret"}},
            "items":[{"id":"chapter","kind":"chapter"},{"id":"contents","kind":"contents"},
                {"id":"title","kind":"title","image":{"assetId":original,"vellumAssetId":prepared}}]
        }}})).unwrap();
        assert_eq!(
            value["layouts"]["vi"]["options"],
            json!({"pdfPaperSize":"a5"})
        );
        assert_eq!(value["layouts"]["vi"]["items"][0]["numbered"], true);
        assert_eq!(value["layouts"]["vi"]["items"][0]["excluded"], false);
        assert_eq!(
            value["layouts"]["vi"]["items"][1]["includeH1Headings"],
            false
        );
        assert_eq!(assets(&value), vec![original, prepared]);
        assert!(normalize(
            json!({"version":1,"layouts":{"en":{"items":[],"options":{"pdfPaperSize":{}}}}})
        )
        .is_err());
    }
}
