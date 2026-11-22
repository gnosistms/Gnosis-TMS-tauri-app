use serde_json::{json, Value};
use uuid::Uuid;

fn address(value: &Value) -> Option<u64> {
    u64::from_str_radix(value.as_str()?.strip_prefix("0x")?, 16).ok()
}

fn filename(value: &Value) -> Option<&str> {
    let name = value.as_str()?.rsplit(['\\', '/']).next()?;
    (!name.is_empty() && name.len() <= 255 && !name.chars().any(char::is_control)).then_some(name)
}

// Rebuild the event at the transport boundary. The SDK can add register values,
// full PDB paths, thread names and device details after its in-process callbacks.
pub(super) fn scrub(raw: &Value) -> Option<Value> {
    let id = Uuid::parse_str(raw["event_id"].as_str()?).ok()?;
    let exception = raw.pointer("/exception/values/0")?;
    let code = u32::try_from(
        exception
            .pointer("/mechanism/meta/signal/number")?
            .as_u64()?,
    )
    .ok()?;
    let kind = exception["type"]
        .as_str()
        .filter(|s| {
            s.len() <= 64
                && s.bytes()
                    .all(|b| b.is_ascii_uppercase() || b == b'_' || b.is_ascii_digit())
        })
        .unwrap_or("WINDOWS_EXCEPTION");
    let addresses: Vec<_> = exception
        .pointer("/stacktrace/frames")?
        .as_array()?
        .iter()
        .filter_map(|f| address(&f["instruction_addr"]))
        .take(256)
        .collect();
    let images: Vec<_> = raw.pointer("/debug_meta/images").and_then(Value::as_array)
        .into_iter().flatten().filter_map(|image| {
            let base = address(&image["image_addr"])?;
            let size = image["image_size"].as_u64()?;
            if !addresses.iter().any(|a| (base..base.saturating_add(size)).contains(a)) { return None; }
            let mut clean = json!({"type":"pe", "code_file":filename(&image["code_file"])?,
                "image_addr":format!("0x{base:x}"), "image_size":size, "arch":std::env::consts::ARCH});
            for key in ["debug_id", "code_id"] {
                if let Some(id) = image[key].as_str().filter(|s| s.len() <= 64 && s.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')) {
                    clean[key] = json!(id);
                }
            }
            if let Some(name) = filename(&image["debug_file"]) { clean["debug_file"] = json!(name); }
            Some(clean)
        }).collect();
    let frames: Vec<_> = addresses
        .iter()
        .map(|a| json!({"instruction_addr":format!("0x{a:x}")}))
        .collect();
    let release = raw["release"]
        .as_str()
        .and_then(|s| s.strip_prefix("gnosis-tms@"))
        .and_then(|s| semver::Version::parse(s).ok())
        .map(|v| format!("gnosis-tms@{v}"))
        .unwrap_or_else(|| concat!("gnosis-tms@", env!("CARGO_PKG_VERSION")).to_owned());
    let mut event = json!({
        "event_id":id.simple().to_string(), "level":"fatal", "platform":"native",
        "environment":"production", "release":release, "contexts":{"os":{"name":"Windows"}},
        "exception":{"values":[{"type":kind, "value":format!("Windows exception 0x{code:08X}"),
            "mechanism":{"type":"seh","handled":false,"meta":{"signal":{"number":code}}},
            "stacktrace":{"frames":frames}}]}, "debug_meta":{"images":images}
    });
    if let Some(t) = raw["timestamp"]
        .as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
    {
        event["timestamp"] = json!(t);
    }
    Some(event)
}

pub(super) fn read_sdk_envelope(bytes: &[u8]) -> Option<Value> {
    // Event-only SDK output. Refuse an envelope with extra items, including attachments.
    let mut lines = bytes.split(|&b| b == b'\n').filter(|l| !l.is_empty());
    let _header = lines.next()?;
    let item: Value = serde_json::from_slice(lines.next()?).ok()?;
    let payload = lines.next()?;
    if item["type"] != "event" || lines.next().is_some() {
        return None;
    }
    scrub(&serde_json::from_slice(payload).ok()?)
}
