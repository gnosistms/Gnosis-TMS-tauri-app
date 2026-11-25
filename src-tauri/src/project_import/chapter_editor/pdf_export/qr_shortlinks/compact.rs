use super::super::{qr_footnotes::fits_version_one, shortlink_cache};
use super::{
    client_for, get, same_destination, web_url, Shortlinks, CONTENT_TYPE, LOOKUP_TIMEOUT,
    MAX_API_BYTES, RETRY_AFTER,
};
use percent_encoding::percent_decode_str;
use scraper::{Html, Selector};
use serde::Deserialize;
use std::{
    collections::{BTreeMap, HashSet},
    io::{self, Read},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        LazyLock, Mutex,
    },
    time::{Duration, Instant},
};
use url::Url;

const API: &str = "https://is.gd/create.php";
const MAX_SECTION_HTML: u64 = 4 * 1024 * 1024;
const SERVICE_BACKOFF: Duration = Duration::from_secs(60);
// Serialize requests across simultaneous exports and respect the service's per-IP limits.
static RETRY_AT: Mutex<Option<Instant>> = Mutex::new(None);
static ANCHORS: LazyLock<Option<Selector>> =
    LazyLock::new(|| Selector::parse("[id], a[name]").ok());
static ROBOTS: LazyLock<Option<Selector>> =
    LazyLock::new(|| Selector::parse("meta[name][content]").ok());

fn section_url(original: &str) -> Option<Url> {
    let url = web_url(original)?;
    (url.scheme() == "https"
        && url
            .domain()
            .is_some_and(|host| host.contains('.') && host != "is.gd")
        && url.port().is_none()
        && url.query().is_none()
        && url.fragment().is_some_and(|fragment| !fragment.is_empty()))
    .then_some(url)
}

pub(in super::super) fn section_urls(urls: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    urls.iter()
        .filter(|url| seen.insert(url.as_str()) && section_url(url).is_some())
        .cloned()
        .collect()
}

pub(in super::super) fn extend(
    app_data: Option<&Path>,
    mut sections: Vec<String>,
    links: &mut Shortlinks,
    create: bool,
    cancelled: &AtomicBool,
) -> io::Result<()> {
    sections.retain(|url| !fits_version_one(url, links.get(url).map_or(&[], Vec::as_slice)));
    let discover = |missing| {
        if create {
            discover_sections(missing, cancelled)
        } else {
            Shortlinks::new()
        }
    };
    let (compact, saved) = match app_data {
        Some(dir) => shortlink_cache::compact_sections(dir, sections, discover),
        None => (discover(sections), Ok(())),
    };
    for (original, aliases) in compact {
        links.entry(original).or_default().extend(aliases);
    }
    saved
}

fn no_index(directives: &str) -> bool {
    directives
        .split(|c: char| c.is_ascii_whitespace() || c == ',' || c == ':')
        .any(|tag| tag.eq_ignore_ascii_case("noindex") || tag.eq_ignore_ascii_case("none"))
}

fn published_anchors(html: &[u8]) -> HashSet<String> {
    let doc = Html::parse_document(&String::from_utf8_lossy(html));
    let (Some(anchors), Some(robots)) = (ANCHORS.as_ref(), ROBOTS.as_ref()) else {
        return HashSet::new();
    };
    if doc.select(robots).any(|node| {
        node.attr("name")
            .is_some_and(|name| name.eq_ignore_ascii_case("robots"))
            && node.attr("content").is_some_and(no_index)
    }) {
        return HashSet::new();
    }
    doc.select(anchors)
        .flat_map(|element| {
            let legacy = (element.value().name() == "a")
                .then(|| element.attr("name"))
                .flatten();
            element
                .attr("id")
                .into_iter()
                .chain(legacy)
                .map(str::to_owned)
        })
        .collect()
}

fn section_page(base: &Url, cancelled: &AtomicBool) -> Option<(Url, HashSet<String>)> {
    let (landed, response) = get(base, Instant::now() + LOOKUP_TIMEOUT, cancelled, None)?;
    // Only send anonymous, public HTML destinations, including after redirects.
    if base.origin() != landed.origin() || landed.query().is_some() || landed.fragment().is_some() {
        return None;
    }
    let response = response?;
    let mime = response
        .headers()
        .get(CONTENT_TYPE)?
        .to_str()
        .ok()?
        .split(';')
        .next()?
        .trim();
    if !["text/html", "application/xhtml+xml"]
        .iter()
        .any(|html| mime.eq_ignore_ascii_case(html))
        || response
            .headers()
            .get_all("x-robots-tag")
            .iter()
            .any(|v| v.to_str().is_ok_and(no_index))
    {
        return None;
    }
    let mut html = Vec::new();
    response
        .take(MAX_SECTION_HTML)
        .read_to_end(&mut html)
        .ok()?;
    Some((landed, published_anchors(&html)))
}

fn target_section(page: &Url, authored: &Url, anchors: &HashSet<String>) -> Option<Url> {
    let fragment = authored.fragment()?;
    let id = percent_decode_str(fragment).decode_utf8().ok()?;
    if !anchors.contains(id.as_ref()) {
        return None;
    }
    let mut target = page.clone();
    target.set_fragment(Some(fragment));
    Some(target)
}

fn discover_sections(missing: Vec<String>, cancelled: &AtomicBool) -> Shortlinks {
    // One page fetch can verify several different anchors on the same article.
    let mut pages = BTreeMap::<Url, Vec<(String, Url)>>::new();
    for original in missing {
        if let Some(section) = section_url(&original) {
            let mut base = section.clone();
            base.set_fragment(None);
            pages.entry(base).or_default().push((original, section));
        }
    }
    let mut result = Shortlinks::new();
    for (base, sections) in pages {
        if cancelled.load(Ordering::Acquire) || service_paused() {
            break;
        }
        let Some((page, anchors)) = section_page(&base, cancelled) else {
            continue;
        };
        for (original, section) in sections {
            let Some(target) = target_section(&page, &section, &anchors) else {
                continue;
            };
            if let Some(alias) = verified_alias(&target, cancelled) {
                result.insert(original, vec![alias]);
            }
            if cancelled.load(Ordering::Acquire) || service_paused() {
                return result;
            }
        }
    }
    result
}

fn service_paused() -> bool {
    RETRY_AT.lock().map_or(true, |retry| {
        retry.is_some_and(|until| Instant::now() < until)
    })
}

#[derive(Deserialize)]
struct ApiReply {
    shorturl: Option<String>,
    errorcode: Option<u32>,
}

fn parse_reply(
    status: u16,
    retry_after: Option<u64>,
    bytes: &[u8],
) -> Result<Option<Url>, Duration> {
    let reply = serde_json::from_slice::<ApiReply>(bytes).ok();
    if status == 429
        || status >= 500
        || reply
            .as_ref()
            .is_some_and(|r| matches!(r.errorcode, Some(3 | 4)))
    {
        return Err(SERVICE_BACKOFF.max(Duration::from_secs(retry_after.unwrap_or(0))));
    }
    if !(200..300).contains(&status) {
        return Ok(None);
    }
    let reply = reply.ok_or(SERVICE_BACKOFF)?;
    if reply.errorcode.is_some() {
        return Ok(None);
    }
    let alias = reply.shorturl.as_deref().and_then(web_url).filter(|url| {
        let path = url.path().strip_prefix('/').unwrap_or_default();
        url.scheme() == "https"
            && url.host_str() == Some("is.gd")
            && url.port().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
            && !path.is_empty()
            && path.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
            && fits_version_one(url.as_str(), &[])
    });
    Ok(alias)
}

fn request_alias(target: &Url, deadline: Instant) -> Result<Option<Url>, Duration> {
    let api = Url::parse(API).map_err(|_| SERVICE_BACKOFF)?;
    let response = client_for(&api, deadline)
        .ok_or(SERVICE_BACKOFF)?
        .get(api)
        .query(&[("format", "json"), ("url", target.as_str())])
        .send()
        .map_err(|_| SERVICE_BACKOFF)?;
    let status = response.status().as_u16();
    let retry_after = response
        .headers()
        .get(RETRY_AFTER)
        .and_then(|v| v.to_str().ok()?.parse().ok());
    let mut bytes = Vec::new();
    response
        .take(MAX_API_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|_| SERVICE_BACKOFF)?;
    parse_reply(status, retry_after, &bytes)
}

fn verified_alias(target: &Url, cancelled: &AtomicBool) -> Option<Url> {
    let mut retry = RETRY_AT.lock().ok()?;
    if cancelled.load(Ordering::Acquire) || retry.is_some_and(|until| Instant::now() < until) {
        return None;
    }
    let deadline = Instant::now() + LOOKUP_TIMEOUT;
    match request_alias(target, deadline) {
        Ok(Some(alias)) => {
            let (landed, _) = get(&alias, deadline, cancelled, Some(target))?;
            same_destination(target, &landed).then_some(alias)
        }
        Ok(None) => None,
        Err(backoff) => {
            *retry = Instant::now()
                .checked_add(backoff)
                .or_else(|| Some(Instant::now() + SERVICE_BACKOFF));
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eligible_sections_require_clean_https_and_an_exact_published_anchor() {
        let base = Url::parse("https://example.org/article/").unwrap();
        let html = r#"<h2 id="Cõi+1">One</h2><a name="next"></a><div name="missing"></div>"#;
        let anchors = published_anchors(html.as_bytes());
        for (fragment, exists) in [
            ("C%C3%B5i+1", true),
            ("next", true),
            ("Next", false),
            ("missing", false),
        ] {
            let url = section_url(&format!("{base}#{fragment}")).unwrap();
            assert_eq!(
                target_section(&base, &url, &anchors).is_some(),
                exists,
                "{url}"
            );
        }
        for url in [
            "https://example.org/article/",
            "https://example.org/article/#",
            "http://example.org/article/#public",
            "https://example.org/file?token=signed#section",
            "https://user:password@example.org/article/#section",
            "https://127.0.0.1/article/#section",
            "https://localhost/article/#section",
            "https://is.gd/abc123#section",
        ] {
            assert!(section_url(url).is_none(), "{url}");
        }
        let hidden = format!(r#"<meta name="ROBOTS" content="follow, NOINDEX">{html}"#);
        assert!(published_anchors(hidden.as_bytes()).is_empty());
        assert!(no_index("googlebot: none"));
    }

    #[test]
    fn requires_a_compact_service_address_and_observes_retry_delays() {
        for value in [
            "https://other.org/Abc123",
            "http://is.gd/Abc123",
            "https://is.gd/a/b",
            "https://is.gd/abc#other",
            "https://is.gd/abc?k=1",
            "https://is.gd/abcdefghijklmnopqrstuvwxyz",
        ] {
            let json = serde_json::json!({"shorturl": value}).to_string();
            assert_eq!(parse_reply(200, None, json.as_bytes()), Ok(None), "{value}");
        }
        let json = br#"{"shorturl":"https://is.gd/AbCd12"}"#;
        assert_eq!(
            parse_reply(200, None, json).unwrap().unwrap().as_str(),
            "https://is.gd/AbCd12"
        );
        for code in [3, 4] {
            let json = serde_json::json!({"errorcode":code}).to_string();
            assert_eq!(
                parse_reply(200, None, json.as_bytes()),
                Err(SERVICE_BACKOFF)
            );
        }
        assert_eq!(
            parse_reply(429, Some(120), b""),
            Err(Duration::from_secs(120))
        );
        assert_eq!(parse_reply(503, None, b""), Err(SERVICE_BACKOFF));
        assert_eq!(parse_reply(200, None, br#"{"errorcode":1}"#), Ok(None));
    }

    #[test]
    fn preserves_publisher_choices_and_isolates_compact_cache_by_section_and_mode() {
        let dir = std::env::temp_dir().join(format!("gnosis-compact-{}", uuid::Uuid::now_v7()));
        let first = "https://example.org/article/#one".to_owned();
        let second = "https://example.org/article/#two".to_owned();
        let third = "https://example.org/article/#three".to_owned();
        let short = Url::parse("https://ex.co/1").unwrap();
        let partial = Url::parse("https://example.org/?p=123456#three").unwrap();
        let alias = Url::parse("https://is.gd/aBCd12").unwrap();
        let urls = vec![first.clone(), second.clone(), third.clone()];
        let publisher =
            Shortlinks::from([(first.clone(), vec![short]), (third.clone(), vec![partial])]);
        shortlink_cache::resolve(&dir, urls.clone(), |_, _| false, |_| publisher.clone())
            .1
            .unwrap();
        let cached = Shortlinks::from([
            (first.clone(), vec![alias.clone()]),
            (third.clone(), vec![alias.clone()]),
        ]);
        shortlink_cache::compact_sections(&dir, urls.clone(), |_| cached)
            .1
            .unwrap();
        let mut links = publisher.clone();
        // A preview may read the cache but cannot issue a new alias for the uncached #two.
        extend(
            Some(&dir),
            section_urls(&urls),
            &mut links,
            false,
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(links[&first], publisher[&first]);
        assert!(!links.contains_key(&second));
        assert_eq!(links[&third], [publisher[&third][0].clone(), alias]);
        let (ordinary, _) =
            shortlink_cache::resolve(&dir, urls, |_, _| false, |_| Shortlinks::new());
        assert_eq!(ordinary, publisher);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    #[ignore = "uses the public is.gd API and verifies two published WordPress headings"]
    fn live_wordpress_sections_fit_version_one_and_replay_offline() {
        let dir = std::env::temp_dir().join(format!("gnosis-compact-{}", uuid::Uuid::now_v7()));
        let sections: Vec<_> = ["Go-vu-ra", "Khe-sed"]
            .iter()
            .map(|id| format!("https://gnosisvn.org/2023/05/03/cay-su-song/#{id}"))
            .collect();
        let mut aliases = Shortlinks::new();
        extend(
            Some(&dir),
            sections.clone(),
            &mut aliases,
            true,
            &AtomicBool::new(false),
        )
        .unwrap();
        for url in &sections {
            assert_eq!(aliases.get(url).map(Vec::len), Some(1), "{url}");
            assert!(fits_version_one(url, &aliases[url]));
            let note = super::super::super::qr_footnotes::render(
                &format!(r#"<a href="{url}">Đọc thêm.</a>"#),
                32,
                &aliases,
            )
            .unwrap()
            .unwrap();
            assert!(note.contains("modules: 21") && note.contains(url));
        }
        assert_ne!(aliases[&sections[0]], aliases[&sections[1]]);
        let mut offline = Shortlinks::new();
        extend(
            Some(&dir),
            sections,
            &mut offline,
            true,
            &AtomicBool::new(true),
        )
        .unwrap();
        assert_eq!(offline, aliases);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
