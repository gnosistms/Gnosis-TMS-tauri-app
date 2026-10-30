//! Adapted from the preserved GnosisTMS-research DLE reader.
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
//! Past a check, a page the reader cannot read shows an orange Close button at
//! its top, which ends the lookup and keeps the page's title and opening text.
//! A hidden page that is plainly a DLE page ends the lookup within seconds.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const RESULT_HOST: &str = "gnosis-research.invalid";
const AUTOMATIC_WAIT: Duration = Duration::from_secs(25);
const PERSON_WAIT: Duration = Duration::from_secs(120);
const TICK: Duration = Duration::from_millis(500);

/// Runs inside the DLE page. Reports when the page shows an entry, a "not in
/// the dictionary" message, or a check that needs a person. Any other page
/// shows a Close button that reports it as closed, and a finished one that
/// stays unreadable for five seconds is reported once as unrecognized.
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
    // Missing-entry pages also contain articles with suggested word links.
    // Only a dictionary article with its own headword is evidence of an entry.
    }).filter(function (a) { return a.headword && (a.senses.length || a.complexForms.length); });
    return found.length ? { kind: "articles", articles: found } : null;
  }
  function report(payload) {
    var json = JSON.stringify(payload);
    location.href = "https://RESULT_HOST/?data=" + encodeURIComponent(json);
  }
  // A browser check (e.g. Cloudflare's "Verify you are human") is reported as
  // soon as it shows, so the window can be shown to the person at once.
  function showsCheck(text) {
    return /Just a moment|Verify you are human|Checking your browser|Performing security verification|Verifica que eres|Un momento/i.test(document.title + " " + text)
      || !!document.querySelector('iframe[src*="challenges.cloudflare.com"], #challenge-form, .cf-turnstile, #cf-challenge-running');
  }
  function unreadPage(status) {
    var text = document.body ? document.body.innerText : "";
    return { status: status, url: location.href, title: clean(document.title), text: clean(text).slice(0, 800),
             dle: /Diccionario de la lengua/i.test(document.title) };
  }
  // The Close button sits in a closed shadow root on <html>, so the page's
  // styles do not reach it and it is not part of the page's text. Its colours
  // are the app's primary button.
  var closeBar = null;
  function showClose(show) {
    if (!closeBar && show) {
      closeBar = document.createElement("div");
      var root = closeBar.attachShadow({ mode: "closed" });
      root.innerHTML = "<style>"
        + ":host { all: initial; }"
        + ".bar { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647;"
        + " display: flex; align-items: center; gap: 14px; box-sizing: border-box; max-width: calc(100vw - 32px);"
        + " padding: 8px 8px 8px 16px; border: 1px solid rgba(164, 112, 41, 0.16); border-radius: 12px;"
        + " background: #fffaf4; box-shadow: 0 9px 20px rgba(131, 82, 22, 0.18); color: #4a2d13;"
        + " font: 600 14px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }"
        + "button { min-height: 38px; padding: 0 16px; border: 0; border-radius: 12px; cursor: pointer; font: inherit;"
        + " font-size: 15px; color: #fff8ed; background: linear-gradient(180deg, #f39c18 0%, #ec8609 100%);"
        + " box-shadow: 0 8px 16px rgba(214, 128, 12, 0.24); }"
        + "button:hover { background: linear-gradient(180deg, #f5a11d 0%, #ed8c13 100%); }"
        + "</style><div class=\"bar\"><span>Gnosis TMS can’t read this page.</span><button type=\"button\">Close</button></div>";
      root.querySelector("button").addEventListener("click", function () {
        clearInterval(timer); report(unreadPage("closed"));
      });
      document.documentElement.appendChild(closeBar);
    }
    if (closeBar) closeBar.style.display = show ? "" : "none";
  }
  var askedPerson = false, settledAt = null, reportedUnreadable = false;
  function look() {
    var text = document.body ? document.body.innerText : "";
    var entry = entryFromPage();
    if (entry) { clearInterval(timer); report({ status: "found", url: location.href, entry: entry }); return; }
    if (/no est[áa] (registrada )?en el Diccionario/i.test(text)) {
      clearInterval(timer); report({ status: "not_found", url: location.href, message: text.slice(0, 300) }); return;
    }
    if (showsCheck(text)) {
      settledAt = null;
      showClose(false);
      if (!askedPerson) { askedPerson = true; report({ status: "needs_person", url: location.href }); }
      return;
    }
    if (document.readyState === "loading") return;
    showClose(true);
    // Keep looking afterwards: a page that fills in late can still be read.
    if (reportedUnreadable || document.readyState !== "complete") return;
    settledAt = settledAt || Date.now();
    if (Date.now() - settledAt < 5000) return;
    reportedUnreadable = true;
    report(unreadPage("unrecognized"));
  }
  var timer = setInterval(look, 500);
  document.addEventListener("DOMContentLoaded", look);
})();
"#;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DleLookup {
    /// "found" | "not_found" | "unreachable"
    pub status: String,
    pub url: String,
    pub entry: Option<Value>,
    pub message: Option<String>,
    pub needed_person: bool,
    /// Title and opening text of a page the reader could not read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache: Option<Value>,
}

#[derive(Debug, PartialEq)]
enum Outcome {
    AskPerson,
    KeepWaiting,
    Finish,
}

/// What one report from the page means for the lookup.
fn outcome(report: &Value, needed_person: bool) -> Outcome {
    match report["status"].as_str() {
        Some("needs_person") if !needed_person => Outcome::AskPerson,
        Some("needs_person") => Outcome::KeepWaiting,
        // A hidden unreadable page ends the lookup when it is plainly a DLE
        // page; any other may be a check that does not say so, and is shown to
        // the person as before. Once shown, the person ends it with Close.
        Some("unrecognized") if needed_person || report["dle"] != true => Outcome::KeepWaiting,
        _ => Outcome::Finish,
    }
}

fn lookup(report: Option<Value>, url: &str, needed_person: bool) -> DleLookup {
    let Some(report) = report else {
        return DleLookup {
            status: "unreachable".to_string(),
            url: url.to_string(),
            entry: None,
            message: Some(if needed_person {
                "The DLE page was shown to you but did not show an entry in time.".to_string()
            } else {
                "The DLE page did not show an entry in time.".to_string()
            }),
            needed_person,
            page: None,
            cache: None,
        };
    };
    let url = report["url"].as_str().unwrap_or(url).to_string();
    let unread = match report["status"].as_str() {
        Some("unrecognized") => Some("The DLE showed a page the reader could not read."),
        Some("closed") => Some("You closed a DLE page the reader could not read."),
        _ => None,
    };
    if let Some(message) = unread {
        return DleLookup {
            status: "unreachable".to_string(),
            url,
            entry: None,
            message: Some(message.to_string()),
            needed_person,
            page: Some(serde_json::json!({ "title": report["title"], "text": report["text"] })),
            cache: None,
        };
    }
    DleLookup {
        status: report["status"]
            .as_str()
            .unwrap_or("unreachable")
            .to_string(),
        url,
        entry: report.get("entry").cloned(),
        message: report["message"].as_str().map(str::to_string),
        needed_person,
        page: None,
        cache: None,
    }
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
pub(crate) async fn glossary_studio_fetch_dle(
    app: AppHandle,
    path: String,
) -> Result<DleLookup, String> {
    // `path` is a word ("fatal") or a DLE link ("/?id=Q1vMnRp#2iTe0wR").
    let url = if path.starts_with("/?") || path.starts_with('?') {
        format!("https://dle.rae.es/{}", path.trim_start_matches('/'))
    } else {
        format!(
            "https://dle.rae.es/{}",
            urlencoding_path(&path.to_lowercase())
        )
    };
    let parsed: tauri::Url = url
        .parse()
        .map_err(|error| format!("Invalid DLE address: {error}"))?;
    let cache_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve dictionary evidence storage: {error}"))?
        .join("research-dictionaries")
        .join("dle");
    let read_root = cache_root.clone();
    let read_url = url.clone();
    if let Some(value) =
        tauri::async_runtime::spawn_blocking(move || super::dle_cache::load(&read_root, &read_url))
            .await
            .map_err(|error| format!("Dictionary cache worker failed: {error}"))??
    {
        return serde_json::from_value(value)
            .map_err(|error| format!("Saved dictionary result is invalid: {error}"));
    }
    let (sender, receiver) = mpsc::channel::<Value>();
    let label = format!("dle-{}", uuid::Uuid::now_v7().simple());
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title("Gnosis TMS: the dictionary (DLE) asks you to confirm you are a person")
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

    // The person closing the window ends the wait.
    let closed = Arc::new(AtomicBool::new(false));
    let closed_flag = closed.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
        ) {
            closed_flag.store(true, Ordering::SeqCst);
        }
    });

    let result = tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let mut needed_person = false;
        let mut deadline = AUTOMATIC_WAIT;
        let show = |window: &tauri::WebviewWindow| {
            let _ = window.show();
            let _ = window.set_focus();
        };
        loop {
            if closed.load(Ordering::SeqCst) {
                return (None, needed_person);
            }
            match receiver.recv_timeout(TICK) {
                Ok(value) => match outcome(&value, needed_person) {
                    Outcome::AskPerson => {
                        needed_person = true;
                        deadline = started.elapsed() + PERSON_WAIT;
                        show(&window);
                    }
                    Outcome::KeepWaiting => {}
                    Outcome::Finish => {
                        let _ = window.close();
                        return (Some(value), needed_person);
                    }
                },
                Err(mpsc::RecvTimeoutError::Timeout) if started.elapsed() < deadline => {}
                Err(mpsc::RecvTimeoutError::Timeout) if !needed_person => {
                    // A hidden page that has not answered (macOS slows the timers of
                    // hidden windows, and some checks never say what they are) is
                    // shown to the person rather than given up on.
                    needed_person = true;
                    deadline = started.elapsed() + PERSON_WAIT;
                    show(&window);
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
    let lookup = lookup(value, &url, needed_person);
    let cache_value = serde_json::to_value(&lookup).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        super::dle_cache::save(&cache_root, &url, &cache_value)
    })
    .await
    .map_err(|error| format!("Dictionary cache worker failed: {error}"))??;
    Ok(lookup)
}

fn urlencoding_path(word: &str) -> String {
    word.trim()
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_the_result_address_carries_data() {
        let good: tauri::Url =
            "https://gnosis-research.invalid/?data=%7B%22status%22%3A%22found%22%7D"
                .parse()
                .unwrap();
        assert_eq!(decode_result(&good).unwrap()["status"], "found");
        let other: tauri::Url = "https://dle.rae.es/?data=%7B%7D".parse().unwrap();
        assert!(decode_result(&other).is_none());
    }

    #[test]
    fn words_are_percent_encoded() {
        assert_eq!(urlencoding_path("término"), "t%C3%A9rmino");
    }

    #[test]
    fn a_shown_unreadable_page_waits_for_the_person_to_close_it() {
        let check = json!({"status": "needs_person"});
        assert_eq!(outcome(&check, false), Outcome::AskPerson);
        assert_eq!(outcome(&check, true), Outcome::KeepWaiting);
        let unknown = json!({"status": "unrecognized", "dle": false});
        assert_eq!(outcome(&unknown, false), Outcome::KeepWaiting);
        assert_eq!(outcome(&unknown, true), Outcome::KeepWaiting);
        let dle_page = json!({"status": "unrecognized", "dle": true});
        assert_eq!(outcome(&dle_page, false), Outcome::Finish);
        assert_eq!(outcome(&dle_page, true), Outcome::KeepWaiting);
        assert_eq!(outcome(&json!({"status": "closed"}), true), Outcome::Finish);
        assert_eq!(outcome(&json!({"status": "found"}), false), Outcome::Finish);
    }

    #[test]
    fn an_unreadable_page_is_unreachable_and_keeps_what_it_showed() {
        let report = json!({"status": "unrecognized", "url": "https://dle.rae.es/ilustrados",
            "title": "ilustrados | Diccionario", "text": "Quizás quiso decir: ilustrado", "dle": true});
        let result = lookup(Some(report), "https://dle.rae.es/ilustrados", true);
        assert_eq!(result.status, "unreachable");
        assert!(result.entry.is_none() && result.needed_person);
        let saved = serde_json::to_value(&result).unwrap();
        assert_eq!(saved["page"]["text"], "Quizás quiso decir: ilustrado");
        // Never cached: an unreadable page is not dictionary evidence.
        assert!(!super::super::dle_cache::usable(&saved));
        let closed = json!({"status": "closed", "url": "https://dle.rae.es/ilustrados",
            "title": "ilustrados | Diccionario", "text": "Quizás quiso decir: ilustrado"});
        let result = lookup(Some(closed), "https://dle.rae.es/ilustrados", true);
        assert_eq!(result.status, "unreachable");
        assert!(result.message.unwrap().starts_with("You closed"));
        assert_eq!(result.page.unwrap()["title"], "ilustrados | Diccionario");
        let timed_out = serde_json::to_value(lookup(None, "https://dle.rae.es/x", false)).unwrap();
        assert!(timed_out.get("page").is_none());
    }
}
