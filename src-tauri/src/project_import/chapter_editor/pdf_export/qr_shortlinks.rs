pub(super) mod compact;

use super::super::chapter_export::public_http_client_builder_for_url;
use crate::broker::{broker_path_url, broker_post_json_with_session};
use regex::Regex;
use reqwest::{
    blocking::{Client, Response},
    header::{HeaderMap, CONTENT_TYPE, LINK, LOCATION, RETRY_AFTER},
};
use scraper::{Html, Selector};
use serde::Deserialize;
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        LazyLock, Mutex,
    },
    time::{Duration, Instant},
};
use url::Url;

pub(super) use super::super::shortlink_cache::Shortlinks;

const USER_AGENT: &str = concat!(
    "GnosisTMS/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/gnosistms/Gnosis-TMS-tauri-app)"
);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(4);
const LOOKUP_TIMEOUT: Duration = Duration::from_secs(12);
const MAX_REDIRECTS: usize = 5;
const MAX_HTML_BYTES: u64 = 256 * 1024;
const MAX_API_BYTES: u64 = 16 * 1024;
const LOOKUP_WORKERS: usize = 6;
const WIKIMEDIA_API: &str = "https://meta.wikimedia.org/w/api.php";

pub(super) fn resolve(
    urls: Vec<String>,
    cancelled: &AtomicBool,
    broker_session: Option<&str>,
) -> Shortlinks {
    let mut seen = HashSet::new();
    let urls: Vec<_> = urls
        .into_iter()
        .filter_map(|original| {
            let url = web_url(&original)?;
            seen.insert(original.clone()).then_some((original, url))
        })
        .collect();
    let next = AtomicUsize::new(0);
    let resolved = Mutex::new(Shortlinks::new());
    let stopped_apis = Mutex::new(HashMap::new());
    let broker_requests = Mutex::new(true);
    let broker = |page: &Url, deadline: Instant| {
        let session = broker_session?;
        let mut available = broker_requests.lock().ok()?;
        if !*available || cancelled.load(Ordering::Acquire) {
            return None;
        }
        let result = shorten_via_broker(page, deadline, session);
        if result.is_none() && Instant::now() < deadline {
            *available = false;
        }
        result
    };
    std::thread::scope(|scope| {
        for _ in 0..LOOKUP_WORKERS.min(urls.len()) {
            scope.spawn(|| {
                while !cancelled.load(Ordering::Acquire) {
                    let index = next.fetch_add(1, Ordering::Relaxed);
                    let Some((original, url)) = urls.get(index) else {
                        return;
                    };
                    let links = discover(
                        url,
                        Instant::now() + LOOKUP_TIMEOUT,
                        cancelled,
                        &stopped_apis,
                        &broker,
                    );
                    if !links.is_empty() {
                        if let Ok(mut resolved) = resolved.lock() {
                            resolved.insert(original.clone(), links);
                        }
                    }
                }
            });
        }
    });
    resolved.into_inner().unwrap_or_default()
}

fn web_url(input: &str) -> Option<Url> {
    let url = Url::parse(input).ok()?;
    (matches!(url.scheme(), "https" | "http")
        && url.host().is_some()
        && url.username().is_empty()
        && url.password().is_none())
    .then_some(url)
}

fn client_for(url: &Url, deadline: Instant) -> Option<Client> {
    let remaining = deadline.checked_duration_since(Instant::now())?;
    public_http_client_builder_for_url(url.as_str(), REQUEST_TIMEOUT.min(remaining), USER_AGENT)
        .ok()?
        .no_proxy()
        .build()
        .ok()
}

fn get(
    url: &Url,
    deadline: Instant,
    cancelled: &AtomicBool,
    known_destination: Option<&Url>,
) -> Option<(Url, Option<Response>)> {
    let mut current = url.clone();
    for _ in 0..=MAX_REDIRECTS {
        if known_destination.is_some_and(|known| same_destination(known, &current)) {
            return Some((current, None));
        }
        if cancelled.load(Ordering::Acquire) {
            return None;
        }
        let response = client_for(&current, deadline)?
            .get(current.clone())
            .send()
            .ok()?;
        if response.status().is_success() {
            return Some((current, Some(response)));
        }
        if !matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
            return None;
        }
        let location = response.headers().get(LOCATION)?.to_str().ok()?;
        let target = current.join(location).ok()?;
        let mut target = web_url(target.as_str())?;
        if target.fragment().is_none() {
            target.set_fragment(current.fragment());
        }
        if target == current {
            return None;
        }
        current = target;
    }
    None
}

static PERCENT_ESCAPE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"%[0-9a-fA-F]{2}").ok());

pub(super) fn same_destination(left: &Url, right: &Url) -> bool {
    left == right
        || PERCENT_ESCAPE.as_ref().is_some_and(|escapes| {
            let uppercase = |matched: &regex::Captures<'_>| matched[0].to_ascii_uppercase();
            escapes.replace_all(left.as_str(), uppercase)
                == escapes.replace_all(right.as_str(), uppercase)
        })
}

static LINK_VALUE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r#"(?:^|,)\s*<([^>]+)>((?:[^",]|"(?:\\.|[^"\\])*")*)"#).ok());
static LINK_PARAMETER: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r#";\s*([-\w]+)\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;\s]+))"#).ok());

fn relation(list: &str, expected: &str) -> bool {
    list.split_ascii_whitespace()
        .any(|rel| rel.eq_ignore_ascii_case(expected))
}

fn header_links(headers: &HeaderMap) -> Vec<(&str, &str)> {
    let (Some(value), Some(parameter)) = (LINK_VALUE.as_ref(), LINK_PARAMETER.as_ref()) else {
        return Vec::new();
    };
    headers
        .get_all(LINK)
        .iter()
        .filter_map(|header| header.to_str().ok())
        .flat_map(|header| value.captures_iter(header))
        .filter_map(|link| {
            let parameters = link.get(2)?.as_str();
            let rel = parameter
                .captures_iter(parameters)
                .find(|parameter| parameter[1].eq_ignore_ascii_case("rel"))?;
            let list = rel.get(2).or_else(|| rel.get(3))?.as_str();
            Some((list, link.get(1)?.as_str()))
        })
        .collect()
}

#[derive(Default)]
struct PageLinks {
    shortlinks: Vec<Url>,
    wiki_api: Option<Url>,
    wiki_article: Option<WikiArticle>,
}

struct WikiArticle {
    id: u64,
    canonical: Url,
}

fn page_links(page: &Url, headers: &HeaderMap, html: &str) -> PageLinks {
    let mut links = PageLinks {
        wiki_api: wikimedia_api(page),
        ..PageLinks::default()
    };
    let mut wordpress_api = None;
    let mut alternates = Vec::new();
    let mut collect_link = |rel: &str, href: &str| {
        let Ok(target) = page.join(href) else { return };
        if relation(rel, "shortlink") {
            links.shortlinks.push(target);
        } else if target.origin() == page.origin() {
            if relation(rel, "https://api.w.org/") {
                wordpress_api = Some(target);
            } else if relation(rel, "alternate") {
                alternates.push(target);
            }
        }
    };
    for (rel, href) in header_links(headers) {
        collect_link(rel, href);
    }
    let html = Html::parse_document(html);
    let Some(selector) =
        Selector::parse("head link[href][rel], head meta[name][content], head script:not([src])")
            .ok()
    else {
        return links;
    };
    let mut mediawiki = false;
    let mut advertised_api = None;
    let mut wiki_id = None;
    let mut canonical = None;
    for node in html.select(&selector) {
        let element = node.value();
        if element.name() == "script" {
            if wiki_id.is_none() {
                wiki_id = node.text().find_map(mediawiki_article_id);
            }
            continue;
        }
        if element
            .attr("name")
            .is_some_and(|name| name.eq_ignore_ascii_case("generator"))
        {
            mediawiki |= element.attr("content").is_some_and(|content| {
                content.split_ascii_whitespace().next() == Some("MediaWiki")
            });
        } else if let Some((rel, href)) = element.attr("rel").zip(element.attr("href")) {
            collect_link(rel, href);
            if relation(rel, "canonical") {
                canonical = page
                    .join(href)
                    .ok()
                    .filter(|target| target.origin() == page.origin());
            }
            if relation(rel, "EditURI") {
                if let Ok(target) = page.join(href) {
                    if target.origin() == page.origin()
                        && target.path().ends_with("/api.php")
                        && target
                            .query_pairs()
                            .any(|(name, value)| name == "action" && value == "rsd")
                    {
                        advertised_api = Some(target);
                    }
                }
            }
        }
    }
    if let Some(api) = wordpress_api {
        links.shortlinks.extend(
            alternates
                .iter()
                .filter_map(|alternate| wordpress_post_id_link(&api, alternate)),
        );
    }
    if links.wiki_api.is_none() && mediawiki {
        links.wiki_api = advertised_api.map(|mut api| {
            api.set_query(None);
            api.set_fragment(None);
            api
        });
    }
    if mediawiki {
        links.wiki_article = wiki_id
            .zip(canonical)
            .map(|(id, canonical)| WikiArticle { id, canonical });
    }
    links
}

static WIKI_ARTICLE_ID: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r#""wgArticleId"\s*:\s*(\d+)\s*[,}]"#).ok());

fn mediawiki_article_id(script: &str) -> Option<u64> {
    let id = WIKI_ARTICLE_ID
        .as_ref()?
        .captures(script)?
        .get(1)?
        .as_str()
        .parse()
        .ok()?;
    (id > 0).then_some(id)
}

fn wiki_page_id_urls(page: &Url, api: &Url, article: &WikiArticle) -> Vec<Url> {
    if page.query().is_some() {
        return Vec::new();
    }
    let wikimedia = wikimedia_api(page).is_some();
    let script_dir = if wikimedia {
        Some("/w")
    } else if api.origin() == page.origin() {
        api.path().strip_suffix("/api.php")
    } else {
        None
    };
    let script_path = script_dir.map(|directory| format!("{directory}/index.php"));
    wikimedia
        .then_some("/")
        .into_iter()
        .chain(script_path.as_deref())
        .map(|path| {
            let mut candidate = page.clone();
            candidate.set_path(path);
            candidate
                .query_pairs_mut()
                .append_pair("curid", &article.id.to_string());
            candidate
        })
        .collect()
}

fn wordpress_post_id_link(api: &Url, alternate: &Url) -> Option<Url> {
    let (home, route) = if let Some(home) = api.path().strip_suffix("wp-json/") {
        let route = alternate.path().strip_prefix(api.path())?;
        (home, std::borrow::Cow::Borrowed(route))
    } else if api.path() == alternate.path()
        && api
            .query_pairs()
            .any(|(name, value)| name == "rest_route" && value == "/")
    {
        let (_, route) = alternate
            .query_pairs()
            .find(|(name, _)| name == "rest_route")?;
        (api.path(), route)
    } else {
        return None;
    };
    let route = route.trim_matches('/');
    let (kind, id) = route.strip_prefix("wp/v2/")?.split_once('/')?;
    if !matches!(kind, "posts" | "pages") || id.parse::<u64>().ok()? == 0 {
        return None;
    }
    let mut shortlink = api.clone();
    shortlink.set_path(home);
    shortlink.set_query(None);
    shortlink.set_fragment(None);
    shortlink.query_pairs_mut().append_pair("p", id);
    Some(shortlink)
}

fn wikimedia_api(page: &Url) -> Option<Url> {
    let host = page.domain()?;
    let wikimedia = [
        "wikipedia.org",
        "wikimedia.org",
        "wiktionary.org",
        "wikibooks.org",
        "wikinews.org",
        "wikiquote.org",
        "wikisource.org",
        "wikiversity.org",
        "wikivoyage.org",
        "wikidata.org",
        "mediawiki.org",
    ]
    .into_iter()
    .any(|domain| {
        host == domain
            || host
                .strip_suffix(domain)
                .is_some_and(|prefix| prefix.ends_with('.'))
    });
    wikimedia.then(|| Url::parse(WIKIMEDIA_API).ok()).flatten()
}

pub(super) fn is_cached_wiki_fallback(original: &str, links: &[Url]) -> bool {
    let Ok(page) = Url::parse(original) else {
        return false;
    };
    wikimedia_api(&page).is_some()
        && !links.iter().any(|link| link.domain() == Some("w.wiki"))
        && links.iter().any(|link| {
            link.origin() == page.origin() && link.query_pairs().any(|(key, _)| key == "curid")
        })
}

#[derive(Deserialize)]
struct WikiResponse {
    shortenurl: Option<WikiShortlink>,
    error: Option<WikiError>,
}

#[derive(Deserialize)]
struct WikiShortlink {
    shorturl: String,
}

#[derive(Deserialize)]
struct WikiError {
    code: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WikiStop {
    IpBlocked,
    Unavailable,
}

type StoppedApis = Mutex<HashMap<Url, WikiStop>>;

fn shorten_wiki(
    api: &Url,
    page: &Url,
    deadline: Instant,
    cancelled: &AtomicBool,
    stopped_apis: &StoppedApis,
    broker: &impl Fn(&Url, Instant) -> Option<Url>,
) -> Option<Url> {
    if cancelled.load(Ordering::Acquire) {
        return None;
    }
    let stopped = stopped_apis.lock().ok()?.get(api).copied();
    let (shortlink, reason) = match stopped {
        Some(reason) => (None, Some(reason)),
        None => request_wiki_shortlink(api, page, deadline)?,
    };
    let Some(reason) = reason else {
        return shortlink;
    };
    let reason = *stopped_apis
        .lock()
        .ok()?
        .entry(api.clone())
        .and_modify(|current| {
            if reason == WikiStop::Unavailable {
                *current = reason;
            }
        })
        .or_insert(reason);
    if reason == WikiStop::IpBlocked
        && api.as_str() == WIKIMEDIA_API
        && wikimedia_api(page).is_some()
        && page.scheme() == "https"
        && page.port().is_none()
    {
        return broker(page, deadline);
    }
    None
}

fn request_wiki_shortlink(
    api: &Url,
    page: &Url,
    deadline: Instant,
) -> Option<(Option<Url>, Option<WikiStop>)> {
    let response = client_for(api, deadline)?
        .post(api.clone())
        .form(&[
            ("action", "shortenurl"),
            ("format", "json"),
            ("url", page.as_str()),
        ])
        .send()
        .ok()?;
    if response.status().as_u16() == 429
        || (!response.status().is_success() && response.headers().contains_key(RETRY_AFTER))
    {
        return Some((None, Some(WikiStop::Unavailable)));
    }
    let mut json = Vec::new();
    response
        .error_for_status()
        .ok()?
        .take(MAX_API_BYTES)
        .read_to_end(&mut json)
        .ok()?;
    wiki_result(api, &json)
}

fn wiki_result(api: &Url, json: &[u8]) -> Option<(Option<Url>, Option<WikiStop>)> {
    let result: WikiResponse = serde_json::from_slice(json).ok()?;
    if let Some(error) = result.error {
        let stop = match error.code.as_str() {
            "urlshortener-blocked" => Some(WikiStop::IpBlocked),
            "ratelimited" | "permissiondenied" => Some(WikiStop::Unavailable),
            _ => None,
        };
        return Some((None, stop));
    }
    let shortlink = result.shortenurl.and_then(|result| {
        if result.shorturl.starts_with("//") {
            web_url(api.join(&result.shorturl).ok()?.as_str())
        } else {
            web_url(&result.shorturl)
        }
    });
    Some((shortlink, None))
}

fn shorten_via_broker(page: &Url, deadline: Instant, session: &str) -> Option<Url> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ShortlinkResponse {
        short_url: String,
    }
    const PATH: &str = "/wikimedia/shortlinks";
    if broker_path_url(PATH).ok()?.scheme() != "https" {
        return None;
    }
    let remaining = deadline.checked_duration_since(Instant::now())?;
    let client = Client::builder()
        .timeout(REQUEST_TIMEOUT.min(remaining))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .ok()?;
    let result: ShortlinkResponse = broker_post_json_with_session(
        &client,
        PATH,
        &serde_json::json!({ "url": page.as_str() }),
        session,
    )
    .ok()?;
    let link = web_url(&result.short_url)?;
    (link.scheme() == "https"
        && link.domain() == Some("w.wiki")
        && link.port().is_none()
        && link.query().is_none()
        && link.fragment().is_none())
    .then_some(link)
}

fn discover(
    url: &Url,
    deadline: Instant,
    cancelled: &AtomicBool,
    stopped_apis: &StoppedApis,
    broker: &impl Fn(&Url, Instant) -> Option<Url>,
) -> Vec<Url> {
    let Some((page, Some(response))) = get(url, deadline, cancelled, None) else {
        return Vec::new();
    };
    let PageLinks {
        shortlinks,
        wiki_api,
        wiki_article,
    } = response_links(&page, response);
    let wiki_shortlink = wiki_api
        .as_ref()
        .and_then(|api| shorten_wiki(api, &page, deadline, cancelled, stopped_apis, broker));
    let destination = |shortlink: &Url| {
        get(shortlink, deadline, cancelled, Some(&page)).map(|(destination, _)| destination)
    };
    let mut verified = verified_shortlinks(url, &page, shortlinks, destination);
    if let Some(shortlink) = wiki_shortlink {
        let wiki_verified = verify_wiki_shortlink(&page, shortlink, destination);
        if let Some(shortlink) = wiki_verified.filter(|link| !verified.contains(link)) {
            verified.push(shortlink);
        }
    }
    if verified.is_empty() {
        if let Some((api, article)) = wiki_api.as_ref().zip(wiki_article.as_ref()) {
            verified.extend(
                wiki_page_id_urls(&page, api, article)
                    .into_iter()
                    .find(|candidate| {
                        let Some((destination, response)) =
                            get(candidate, deadline, cancelled, Some(&page))
                        else {
                            return false;
                        };
                        same_destination(&destination, &page)
                            || (destination.origin() == page.origin()
                                && same_fragment(&destination, &page)
                                && response.is_some_and(|response| {
                                    response_links(&destination, response)
                                        .wiki_article
                                        .is_some_and(|found| {
                                            found.id == article.id
                                                && same_destination(
                                                    &found.canonical,
                                                    &article.canonical,
                                                )
                                        })
                                }))
                    }),
            );
        }
    }
    verified
}

fn verify_wiki_shortlink(
    page: &Url,
    mut shortlink: Url,
    destination: impl Fn(&Url) -> Option<Url>,
) -> Option<Url> {
    if same_destination(&shortlink, page) {
        return None;
    }
    let target = destination(&shortlink)?;
    if same_destination(&target, page) {
        return Some(shortlink);
    }
    if shortlink.fragment().is_some() || page.fragment().is_none() {
        return None;
    }
    let mut target_with_section = target;
    target_with_section.set_fragment(page.fragment());
    if !same_destination(&target_with_section, page) {
        return None;
    }
    shortlink.set_fragment(page.fragment());
    destination(&shortlink)
        .filter(|target| same_destination(target, page))
        .map(|_| shortlink)
}

#[cfg(test)]
const WIKI_SECTION_EXAMPLE: &str =
    "https://vi.wikipedia.org/wiki/Phẩm_trật_Thiên_sứ_trong_Kitô_giáo#Cherubim_-_Minh_thần";

fn same_fragment(left: &Url, right: &Url) -> bool {
    let mut candidate = left.clone();
    candidate.set_fragment(right.fragment());
    same_destination(&candidate, left)
}

fn response_links(page: &Url, response: Response) -> PageLinks {
    let headers = response.headers().clone();
    let is_html = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_none_or(|value| {
            value.starts_with("text/html") || value.starts_with("application/xhtml+xml")
        });
    let mut html = Vec::new();
    if is_html {
        let _ = response.take(MAX_HTML_BYTES).read_to_end(&mut html);
    }
    page_links(page, &headers, &String::from_utf8_lossy(&html))
}

fn verified_shortlinks(
    original: &Url,
    page: &Url,
    candidates: Vec<Url>,
    mut destination: impl FnMut(&Url) -> Option<Url>,
) -> Vec<Url> {
    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter_map(|mut candidate| {
            if candidate.fragment().is_none() {
                candidate.set_fragment(page.fragment());
            }
            let candidate = web_url(candidate.as_str())?;
            if same_destination(&candidate, original) || !seen.insert(candidate.clone()) {
                return None;
            }
            destination(&candidate)
                .filter(|target| same_destination(target, page))
                .map(|_| candidate)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_only_official_ip_blocks_to_the_broker_and_preserves_the_section() {
        let page = Url::parse(WIKI_SECTION_EXAMPLE).unwrap();
        let api = wikimedia_api(&page).unwrap();
        let deadline = Instant::now() + LOOKUP_TIMEOUT;
        let cancelled = AtomicBool::new(false);
        let broker = |url: &Url, _| {
            assert_eq!(url, &page);
            Url::parse("https://w.wiki/Test").ok()
        };
        let stopped = Mutex::new(HashMap::from([(api.clone(), WikiStop::IpBlocked)]));
        let result = shorten_wiki(&api, &page, deadline, &cancelled, &stopped, &broker).unwrap();
        assert_eq!(result.as_str(), "https://w.wiki/Test");
        let stopped = Mutex::new(HashMap::from([(api.clone(), WikiStop::Unavailable)]));
        assert!(shorten_wiki(&api, &page, deadline, &cancelled, &stopped, &broker).is_none());
        let wiki_api = Url::parse("https://example.org/w/api.php").unwrap();
        let stopped = Mutex::new(HashMap::from([(wiki_api.clone(), WikiStop::IpBlocked)]));
        assert!(shorten_wiki(&wiki_api, &page, deadline, &cancelled, &stopped, &broker).is_none());
    }

    #[test]
    fn builds_mediawiki_page_id_links_without_losing_the_fragment_or_revision() {
        let page = Url::parse(WIKI_SECTION_EXAMPLE).unwrap();
        let html = r#"<head><meta name="generator" content="MediaWiki 1.48">
            <link rel="canonical" href="/wiki/Current_name">
            <script>RLCONF={"wgArticleId":1519434,"wgIsArticle":true};</script></head>"#;
        let links = page_links(&page, &HeaderMap::new(), html);
        let article = links.wiki_article.unwrap();
        let api = links.wiki_api.unwrap();
        assert_eq!(article.canonical.path(), "/wiki/Current_name");
        let candidates = wiki_page_id_urls(&page, &api, &article);
        assert_eq!(
            candidates[0].as_str(),
            "https://vi.wikipedia.org/?curid=1519434#Cherubim_-_Minh_th%E1%BA%A7n"
        );
        assert_eq!(candidates[1].fragment(), page.fragment());
        let mut revision = page;
        revision.set_query(Some("oldid=123"));
        assert!(wiki_page_id_urls(&revision, &api, &article).is_empty());
    }

    #[test]
    fn keeps_the_official_shortlink_compact_if_it_already_points_to_the_section() {
        let page = Url::parse(WIKI_SECTION_EXAMPLE).unwrap();
        let shortlink = Url::parse("https://w.wiki/ABCD").unwrap();
        let result = verify_wiki_shortlink(&page, shortlink.clone(), |_| Some(page.clone()));
        assert_eq!(result, Some(shortlink.clone()));
        let result = verify_wiki_shortlink(&page, shortlink, |candidate| {
            let mut target = page.clone();
            target.set_fragment(candidate.fragment());
            Some(target)
        });
        assert_eq!(result.unwrap().fragment(), page.fragment());
    }

    #[test]
    fn uses_the_page_id_when_wikimedia_shortener_is_unavailable_in_live_test() {
        if std::env::var_os("GNOSIS_QR_WIKIMEDIA_LIVE_TEST").is_none() {
            return;
        }
        let page = Url::parse(WIKI_SECTION_EXAMPLE).unwrap();
        let throttled = Mutex::new(HashMap::from([(
            wikimedia_api(&page).unwrap(),
            WikiStop::Unavailable,
        )]));
        let links = discover(
            &page,
            Instant::now() + LOOKUP_TIMEOUT,
            &AtomicBool::new(false),
            &throttled,
            &|_, _| None,
        );
        assert_eq!(
            links[0].as_str(),
            "https://vi.wikipedia.org/?curid=1519434#Cherubim_-_Minh_th%E1%BA%A7n"
        );
        let source = format!(r#"Minh thần. <a href="{WIKI_SECTION_EXAMPLE}">Đọc thêm.</a>"#);
        let render = |links: &Shortlinks| {
            super::super::qr_footnotes::render(&source, 11, links)
                .unwrap()
                .unwrap()
        };
        assert!(render(&Shortlinks::new()).contains("modules: 37"));
        assert!(
            render(&Shortlinks::from([(WIKI_SECTION_EXAMPLE.into(), links)]))
                .contains("modules: 29")
        );
    }

    #[test]
    fn reads_shortlinks_from_wordpress_headers_and_html() {
        let page = Url::parse("https://example.org/2023/01/25/article/").unwrap();
        let mut headers = HeaderMap::new();
        headers.append(LINK, r#"</wp-json/>; rel="https://api.w.org/"; title="an API, with a comma", <https://wp.me/a,b>; rel="alternate SHORTLINK""#.parse().unwrap());
        headers.append(LINK, r#"</other>; rel=canonical"#.parse().unwrap());
        headers.append(
            LINK,
            r#"</still-not-short>; title="other; rel=shortlink"; rel=alternate"#
                .parse()
                .unwrap(),
        );
        let links = page_links(
            &page,
            &headers,
            r#"<head><link rel='shortlink' href='/?p=11370'><link rel='alternate' href='/feed'></head>"#,
        );
        assert_eq!(
            links.shortlinks.iter().map(Url::as_str).collect::<Vec<_>>(),
            ["https://wp.me/a,b", "https://example.org/?p=11370"],
        );
        assert!(links.wiki_api.is_none());
    }

    #[test]
    fn finds_wikimedia_and_independent_mediawiki_api_endpoints() {
        let wikipedia = Url::parse("https://vi.wikipedia.org/wiki/QR").unwrap();
        let api = wikimedia_api(&wikipedia).unwrap();
        assert_eq!(api.as_str(), "https://meta.wikimedia.org/w/api.php");
        let page = Url::parse("https://wiki.example.org/wiki/Article").unwrap();
        let html = r#"<head><meta name='generator' content='MediaWiki 1.43'>
            <link rel='EditURI' href='/custom/api.php?action=rsd'></head>"#;
        let links = page_links(&page, &HeaderMap::new(), html);
        assert_eq!(
            links.wiki_api.unwrap().as_str(),
            "https://wiki.example.org/custom/api.php"
        );
        let cross_site = html.replace("/custom/api.php", "https://elsewhere.org/custom/api.php");
        assert!(page_links(&page, &HeaderMap::new(), &cross_site)
            .wiki_api
            .is_none());
        let lookalike = Url::parse("https://notwikipedia.org/wiki/Article").unwrap();
        assert!(wikimedia_api(&lookalike).is_none());
    }

    #[test]
    fn finds_own_domain_wordpress_link_from_the_advertised_post_id() {
        let page = Url::parse("https://example.org/blog/article").unwrap();
        let mut headers = HeaderMap::new();
        headers.append(
            LINK,
            r#"</blog/wp-json/>; rel="https://api.w.org/""#.parse().unwrap(),
        );
        headers.append(
            LINK,
            r#"</blog/wp-json/wp/v2/posts/11370>; rel=alternate; type="application/json""#
                .parse()
                .unwrap(),
        );
        let links = page_links(&page, &headers, "");
        assert_eq!(
            links.shortlinks[0].as_str(),
            "https://example.org/blog/?p=11370"
        );
        let api = Url::parse("https://example.org/blog/?rest_route=/").unwrap();
        let alternate = api.join("?rest_route=%2Fwp%2Fv2%2Fpages%2F123").unwrap();
        assert_eq!(
            wordpress_post_id_link(&api, &alternate).unwrap().as_str(),
            "https://example.org/blog/?p=123",
        );
    }

    #[test]
    fn parses_mediawiki_shortlinks_and_stops_on_blocked_or_rate_limited_responses() {
        let api = Url::parse("https://meta.wikimedia.org/w/api.php").unwrap();
        let success = br#"{"shortenurl":{"shorturl":"https://w.wiki/w"}}"#;
        let (link, stop) = wiki_result(&api, success).unwrap();
        assert_eq!(link.unwrap().as_str(), "https://w.wiki/w");
        assert_eq!(stop, None);
        for (failure, expected) in [
            (
                br#"{"error":{"code":"urlshortener-blocked"}}"#.as_slice(),
                WikiStop::IpBlocked,
            ),
            (
                br#"{"error":{"code":"ratelimited"}}"#.as_slice(),
                WikiStop::Unavailable,
            ),
        ] {
            assert_eq!(wiki_result(&api, failure), Some((None, Some(expected))));
        }
    }

    #[test]
    fn verifies_the_same_destination_including_section_and_deduplicates() {
        let page = Url::parse("https://example.org/article#section").unwrap();
        let candidates = [
            "https://wp.me/Xy",
            "https://wp.me/Xy#section",
            "https://wp.me/Xz#other",
            "file:///payload",
            "https://user@example.org/",
        ]
        .map(|url| Url::parse(url).unwrap())
        .to_vec();
        let mut requests = Vec::new();
        let verified = verified_shortlinks(&page, &page, candidates, |candidate| {
            requests.push(candidate.clone());
            if candidate.fragment() == Some("section") {
                Some(page.clone())
            } else {
                Url::parse("https://example.org/article#other").ok()
            }
        });
        assert_eq!(requests.len(), 2);
        assert_eq!(verified[0].as_str(), "https://wp.me/Xy#section");
        assert_eq!(verified.len(), 1);
    }

    #[test]
    fn accepts_percent_escape_case_differences_without_changing_path_or_section() {
        let page = Url::parse("https://gnosisvn.org/2023/07/22/𓆎𓅓𓏏𓊖-km-t/#Đề-mục").unwrap();
        let redirect = Url::parse("https://gnosisvn.org/2023/07/22/%f0%93%86%8e%f0%93%85%93%f0%93%8f%8f%f0%93%8a%96-km-t/#%c4%90%e1%bb%81-m%e1%bb%a5c").unwrap();
        let shortlink = Url::parse("https://wp.me/p6Zr2M-3li").unwrap();
        assert_ne!(page, redirect);
        assert!(same_destination(&page, &redirect));
        let verified =
            verified_shortlinks(&page, &page, vec![shortlink], |_| Some(redirect.clone()));
        assert_eq!(verified.len(), 1);
        assert_eq!(verified[0].fragment(), page.fragment());
        for changed in [
            page.as_str().replace("-km-t/", "-KM-T/"),
            page.as_str().replace("-km-t/", "-km-t%2F"),
            page.as_str().replace("-m%", "-M%"),
        ] {
            let changed = Url::parse(&changed).unwrap();
            assert!(!same_destination(&page, &changed));
        }
    }

    #[test]
    fn discovers_wordpress_shortlink_when_live_test_is_configured() {
        if std::env::var_os("GNOSIS_QR_WORDPRESS_LIVE_TEST").is_none() {
            return;
        }
        let url = "https://gnosisvn.org/2023/01/25/ky-nguyen-bao-binh/";
        let links = resolve(vec![url.into(), url.into()], &AtomicBool::new(false), None);
        assert!(links[url]
            .iter()
            .any(|link| link.as_str() == "https://wp.me/p6Zr2M-2Xo"));
        assert!(links[url]
            .iter()
            .any(|link| link.as_str() == "https://gnosisvn.org/?p=11370"));
        let source = format!(r#"Kỷ nguyên Bảo Bình. <a href="{url}">Đọc thêm.</a>"#);
        let note = super::super::qr_footnotes::render(&source, 1, &links)
            .unwrap()
            .unwrap();
        assert!(note.contains("modules: 21"));
    }

    #[test]
    fn discovers_shortlink_for_hieroglyphic_slug_in_live_test() {
        if std::env::var_os("GNOSIS_QR_WORDPRESS_LIVE_TEST").is_none() {
            return;
        }
        let url = "https://gnosisvn.org/2023/07/22/𓆎𓅓𓏏𓊖-km-t/";
        let links = resolve(vec![url.into()], &AtomicBool::new(false), None);
        assert!(links.get(url).is_some_and(|candidates| candidates
            .iter()
            .any(|link| link.as_str() == "https://wp.me/p6Zr2M-3li")));
        let source =
            format!(r#"Khem là tên gọi cũ xưa của nước Ai Cập. <a href="{url}">Đọc thêm.</a>"#);
        let note = super::super::qr_footnotes::render(&source, 4, &links)
            .unwrap()
            .unwrap();
        assert!(note.contains("modules: 21"));
    }

    #[test]
    fn minimizes_both_gnosis_vn_links_in_the_same_lookup() {
        if std::env::var_os("GNOSIS_QR_WORDPRESS_LIVE_TEST").is_none() {
            return;
        }
        let articles = [
            (
                "https://gnosisvn.org/2015/11/30/dai-bach-hoi-quan/",
                "https://wp.me/p6Zr2M-v",
            ),
            (
                "https://gnosisvn.org/2023/07/22/𓆎𓅓𓏏𓊖-km-t/",
                "https://wp.me/p6Zr2M-3li",
            ),
        ];
        let links = resolve(
            articles.iter().map(|(url, _)| (*url).into()).collect(),
            &AtomicBool::new(false),
            None,
        );
        for (url, shortlink) in articles {
            assert!(
                links.get(url).is_some_and(|candidates| candidates
                    .iter()
                    .any(|link| link.as_str() == shortlink)),
                "Expected {shortlink} for {url}, got {:?}",
                links.get(url)
            );
            let note = super::super::qr_footnotes::render(url, 1, &links)
                .unwrap()
                .unwrap();
            assert!(note.contains("modules: 21"), "{url}");
        }
    }
}
