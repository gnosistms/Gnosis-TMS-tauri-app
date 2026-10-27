use super::font_fallback::FontChoice;
use super::*;
use tauri_plugin_store::StoreExt;

// OS-user/app scope: deliberately no team, login, project or chapter key.
const STORE_FILE: &str = "pdf-font-preferences.json";
const APPROVED_FONTS_KEY: &str = "approvedFontFaces";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SavedFontChoice {
    id: String,
    family: String,
}

pub(super) fn summaries(approved: &[FontChoice]) -> Vec<SavedFontChoice> {
    approved
        .iter()
        .map(|choice| SavedFontChoice {
            id: choice.id(),
            family: choice.family().to_string(),
        })
        .collect()
}

fn preference_lock() -> &'static Mutex<()> {
    static LOCK: Mutex<()> = Mutex::new(());
    &LOCK
}

pub(super) fn load(app: &AppHandle) -> Result<Vec<FontChoice>, String> {
    let _guard = preference_lock()
        .lock()
        .map_err(|_| "The saved PDF font preferences are unavailable.".to_string())?;
    let store = app
        .store_builder(STORE_FILE)
        .disable_auto_save()
        .build()
        .map_err(|_| "Could not load the saved PDF font preferences.".to_string())?;
    Ok(decode(store.get(APPROVED_FONTS_KEY)))
}

fn decode(value: Option<serde_json::Value>) -> Vec<FontChoice> {
    // Missing or malformed approvals never grant implicit consent.
    value
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

fn merge(mut existing: Vec<FontChoice>, choices: &[FontChoice]) -> Vec<FontChoice> {
    for choice in choices {
        if !existing.contains(choice) {
            existing.push(choice.clone());
        }
    }
    existing
}

pub(super) fn save(app: &AppHandle, choices: &[FontChoice]) -> Result<(), String> {
    update(app, |existing| merge(existing, choices))
}

pub(super) fn forget(app: &AppHandle, font_id: &str) -> Result<bool, String> {
    let mut forgotten = false;
    update(app, |mut existing| {
        let before = existing.len();
        existing.retain(|choice| choice.id() != font_id);
        forgotten = existing.len() != before;
        existing
    })?;
    Ok(forgotten)
}

fn update(
    app: &AppHandle,
    change: impl FnOnce(Vec<FontChoice>) -> Vec<FontChoice>,
) -> Result<(), String> {
    let _guard = preference_lock()
        .lock()
        .map_err(|_| "The saved PDF font preferences are unavailable.".to_string())?;
    let store = app
        .store_builder(STORE_FILE)
        .disable_auto_save()
        .build()
        .map_err(|_| "Could not load the saved PDF font preferences.".to_string())?;
    let previous = store.get(APPROVED_FONTS_KEY);
    let existing = decode(previous.clone());
    let approved = change(existing.clone());
    if approved == existing {
        return Ok(());
    }
    store.set(
        APPROVED_FONTS_KEY,
        serde_json::to_value(approved)
            .map_err(|_| "Could not prepare the PDF font preferences.".to_string())?,
    );
    if store.save().is_err() {
        // A failed disk write must not act like a durable approval in memory.
        if let Some(value) = previous {
            store.set(APPROVED_FONTS_KEY, value);
        } else {
            store.delete(APPROVED_FONTS_KEY);
        }
        return Err("Could not save your PDF font choices. Check that the app can save local preferences, then try again.".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn choice(family: &str) -> FontChoice {
        serde_json::from_value(serde_json::json!({ "family": family, "style": "normal", "weight": 400, "stretchPercent": 100.0 })).unwrap()
    }

    #[test]
    fn app_approvals_survive_disk_round_trip_and_merge_without_document_scope() {
        let first = choice("Noto Sans EgyptHiero");
        let second = choice("Another script");
        let stored = merge(Vec::new(), std::slice::from_ref(&first));
        let workspace = pdf_workspace().unwrap();
        let _cleanup = WorkspaceCleanup(workspace.clone());
        let path = workspace.join(STORE_FILE);
        fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({ APPROVED_FONTS_KEY: stored })).unwrap(),
        )
        .unwrap();
        let reloaded: serde_json::Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        let approved = merge(
            decode(reloaded.get(APPROVED_FONTS_KEY).cloned()),
            &[first.clone(), second.clone()],
        );
        assert_eq!(approved, vec![first, second]);
        let serialized = serde_json::to_string(&approved).unwrap();
        assert!(!serialized.contains("chapter"));
        assert!(!serialized.contains("path"));
        assert!(!serialized.contains("glyph"));
    }

    #[test]
    fn malformed_or_missing_preferences_never_approve_a_font() {
        assert!(decode(None).is_empty());
        assert!(decode(Some(serde_json::json!("invalid"))).is_empty());
        assert!(decode(Some(serde_json::json!([{"family": "Incomplete"}]))).is_empty());
    }
}
