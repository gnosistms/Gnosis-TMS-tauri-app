//! RAE/ASALE Diccionario de la lengua española (DLE) reader for Glossary
//! Research.
//!
//! dle.rae.es answers scripted HTTP clients with a browser check, so the page
//! is loaded in a hidden app window (a real browser engine). An injected
//! script reads the entry from the page's DOM and hands the result back by
//! navigating to `https://gnosis-research.invalid/…`, a navigation this
//! window intercepts and blocks. The DLE page gets no access to app commands.
//!
//! The app never tries to get past a check. If the page shows one that needs a
//! person, the window is made visible so the user can complete it; otherwise
//! the result is "unreachable", which is never reported as "no entry".

use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

const RESULT_HOST: &str = "gnosis-research.invalid";
const AUTOMATIC_WAIT: Duration = Duration::from_secs(25);
const PERSON_WAIT: Duration = Duration::from_secs(120);

/// Runs inside the DLE page. Reports once, when the page shows an entry, a
/// "not in the dictionary" message, or a check that needs a person.
const EXTRACT_SCRIPT: &str = r#"
(function () {
  if (window.__gnosisResearchStarted) return;
  window.__gnosisResearchStarted = true;
  var fragment = decodeURIComponent((location.hash || "").slice(1));
  function clean(t) { return (t || "").replace(/\s+/g, " ").trim(); }
  function senses(list) {
    return Array.from(list.querySelectorAll(":scope > li")).map(function (li) {
      var body = li.querySelector(".c-definitions__item > div");
      if (!body) return null;
      var number = body.querySelector(".n_acep");
      var labels = Array.from(body.querySelectorAll("abbr")).map(function (a) {
        return { abbr: clean(a.textContent), title: a.getAttribute("title") || "" };
      });
      var examples = Array.from(body.querySelectorAll(".h")).map(function (e) { return clean(e.textContent); });
      var definition = clean(body.textContent);
      if (number) definition = definition.slice(clean(number.textContent).length).trim();
      labels.forEach(function (l) { if (definition.indexOf(l.abbr) === 0) definition = definition.slice(l.abbr.length).trim(); });
      examples.forEach(function (e) { definition = definition.replace(e, "").trim(); });
      function words(prefix) {
        var out = [];
        li.querySelectorAll(".c-word-list").forEach(function (block) {
          var label = block.querySelector("abbr");
          if (label && (label.getAttribute("title") || "").indexOf(prefix) === 0) {
            block.querySelectorAll(".sin").forEach(function (s) { out.push(clean(s.textContent)); });
          }
        });
        return out;
      }
      return { number: number ? clean(number.textContent).replace(/\.$/, "") : null, labels: labels,
               definition: definition, examples: examples, synonyms: words("Sin"), antonyms: words("Ant") };
    }).filter(Boolean);
  }
  function entryFromPage() {
    var articles = Array.from(document.querySelectorAll("article"));
    if (fragment) {
      var heading = document.getElementById(fragment);
      if (heading) {
        var list = heading.nextElementSibling;
        while (list && !(list.tagName === "OL" && list.classList.contains("c-definitions"))) {
          if (list.tagName === "H3") { list = null; break; }
          list = list.nextElementSibling;
        }
        return { kind: "complex", form: clean(heading.textContent), senses: list ? senses(list) : [],
                 html: heading.outerHTML + (list ? list.outerHTML : "") };
      }
    }
    var found = articles.map(function (article) {
      var section = article.querySelector("section.c-section") || article;
      var head = article.querySelector("h1");
      var intro = section.querySelector(".c-text-intro");
      var first = section.querySelector("ol.c-definitions");
      var complexForms = Array.from(section.querySelectorAll("h3")).map(function (h) {
        var link = h.querySelector("a");
        return { form: clean(h.textContent), href: link ? link.getAttribute("href") : null, id: h.id || null };
      });
      return { headword: head ? clean(head.textContent) : null, etymology: intro ? clean(intro.textContent) : null,
               senses: first ? senses(first) : [], complexForms: complexForms,
               html: (head ? head.outerHTML : "") + section.outerHTML };
    }).filter(function (a) { return a.senses.length || a.complexForms.length; });
    return found.length ? { kind: "articles", articles: found } : null;
  }
  function report(payload) {
    var json = JSON.stringify(payload);
    location.href = "https://RESULT_HOST/?data=" + encodeURIComponent(json);
  }
  var attempts = 0;
  var timer = setInterval(function () {
    attempts += 1;
    var text = document.body ? document.body.innerText : "";
    var entry = entryFromPage();
    if (entry) { clearInterval(timer); report({ status: "found", url: location.href, entry: entry }); return; }
    if (/no est[áa] (registrada )?en el Diccionario/i.test(text)) {
      clearInterval(timer); report({ status: "not_found", url: location.href, message: text.slice(0, 300) }); return;
    }
    if (/Just a moment|Verify you are human|Checking your browser|Verifica que eres/i.test(document.title + " " + text) && attempts === 20) {
      report({ status: "needs_person", url: location.href });
    }
  }, 500);
})();
"#;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DleLookup {
    /// "found" | "not_found" | "unreachable"
    pub status: String,
    pub url: String,
    pub entry: Option<Value>,
    pub message: Option<String>,
    pub needed_person: bool,
}

fn decode_result(url: &tauri::Url) -> Option<Value> {
    if url.host_str() != Some(RESULT_HOST) {
        return None;
    }
    url.query_pairs()
        .find(|(key, _)| key == "data")
        .and_then(|(_, value)| serde_json::from_str(&value).ok())
}

#[tauri::command]
pub(crate) async fn glossary_research_fetch_dle(app: AppHandle, path: String) -> Result<DleLookup, String> {
    // `path` is a word ("fatal") or a DLE link ("/?id=Q1vMnRp#2iTe0wR").
    let url = if path.starts_with("/?") || path.starts_with('?') {
        format!("https://dle.rae.es/{}", path.trim_start_matches('/'))
    } else {
        format!("https://dle.rae.es/{}", urlencoding_path(&path))
    };
    let parsed: tauri::Url = url.parse().map_err(|error| format!("Invalid DLE address: {error}"))?;
    let (sender, receiver) = mpsc::channel::<Value>();
    let label = format!("dle-{}", uuid::Uuid::now_v7().simple());
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title("Diccionario de la lengua española — verification")
        .inner_size(900.0, 700.0)
        .visible(false)
        .initialization_script(EXTRACT_SCRIPT.replace("RESULT_HOST", RESULT_HOST))
        .on_navigation(move |target| {
            if let Some(value) = decode_result(target) {
                let _ = sender.send(value);
                return false;
            }
            target.host_str() != Some(RESULT_HOST)
        })
        .build()
        .map_err(|error| format!("Could not open the dictionary page: {error}"))?;

    let result = tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let mut needed_person = false;
        let mut deadline = AUTOMATIC_WAIT;
        loop {
            let remaining = deadline.saturating_sub(started.elapsed());
            match receiver.recv_timeout(remaining.max(Duration::from_millis(1))) {
                Ok(value) if value.get("status").and_then(Value::as_str) == Some("needs_person") => {
                    needed_person = true;
                    deadline = AUTOMATIC_WAIT + PERSON_WAIT;
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                Ok(value) => {
                    let _ = window.close();
                    return (Some(value), needed_person);
                }
                Err(_) => {
                    let _ = window.close();
                    return (None, needed_person);
                }
            }
        }
    })
    .await
    .map_err(|error| format!("The dictionary worker failed: {error}"))?;

    let (value, needed_person) = result;
    Ok(match value {
        Some(value) => DleLookup {
            status: value.get("status").and_then(Value::as_str).unwrap_or("unreachable").to_string(),
            url: value.get("url").and_then(Value::as_str).unwrap_or(&url).to_string(),
            entry: value.get("entry").cloned(),
            message: value.get("message").and_then(Value::as_str).map(str::to_string),
            needed_person,
        },
        None => DleLookup {
            status: "unreachable".to_string(),
            url,
            entry: None,
            message: Some("The DLE page did not show an entry in time.".to_string()),
            needed_person,
        },
    })
}

fn urlencoding_path(word: &str) -> String {
    word.trim()
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (byte as char).to_string(),
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_result_address_carries_data() {
        let good: tauri::Url = "https://gnosis-research.invalid/?data=%7B%22status%22%3A%22found%22%7D".parse().unwrap();
        assert_eq!(decode_result(&good).unwrap()["status"], "found");
        let other: tauri::Url = "https://dle.rae.es/?data=%7B%7D".parse().unwrap();
        assert!(decode_result(&other).is_none());
    }

    #[test]
    fn words_are_percent_encoded() {
        assert_eq!(urlencoding_path("término"), "t%C3%A9rmino");
    }
}
