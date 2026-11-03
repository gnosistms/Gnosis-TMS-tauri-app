//! Whether a row's stored image value holds an image, audio or video.
//!
//! The stored value (`{ kind: "url" | "upload", ... }`) never records the media
//! kind: older app versions would drop an extra field when they rewrite the
//! row. It is derived from the URL or the uploaded file name instead.
//! `src-ui/app/editor-media-kind.js` must agree on every case in
//! `tests/fixtures/editor-media-kind/cases.json`.

use std::{io::Read as _, time::Duration};

pub(super) const AUDIO_EXTENSIONS: [&str; 3] = ["mp3", "m4a", "wav"];
const VIDEO_FILE_EXTENSIONS: [&str; 4] = ["mp4", "m4v", "mov", "webm"];
const VIMEO_COLLECTION_SEGMENTS: [&str; 3] = ["groups", "album", "showcase"];

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum VideoSource {
    YouTube { id: String },
    Vimeo { id: String, hash: Option<String> },
    VideoPress { guid: String },
    File,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum EditorMedia {
    Image,
    Audio,
    Video(VideoSource),
}

impl EditorMedia {
    pub(super) fn is_image(&self) -> bool {
        matches!(self, Self::Image)
    }

    /// Reader-facing label for exports that show media as a link or as text.
    pub(super) fn label(&self) -> &'static str {
        match self {
            Self::Image => "Image",
            Self::Audio => "Audio",
            Self::Video(_) => "Video",
        }
    }

    /// The embeddable player address for a YouTube, Vimeo or VideoPress video.
    /// Mirrors editorVideoEmbedUrl in editor-media-kind.js (without autoplay).
    pub(super) fn video_embed_url(&self) -> Option<String> {
        match self {
            Self::Video(VideoSource::YouTube { id }) => {
                Some(format!("https://www.youtube-nocookie.com/embed/{id}?rel=0"))
            }
            Self::Video(VideoSource::Vimeo { id, hash }) => Some(match hash {
                Some(hash) => format!("https://player.vimeo.com/video/{id}?h={hash}"),
                None => format!("https://player.vimeo.com/video/{id}"),
            }),
            Self::Video(VideoSource::VideoPress { guid }) => {
                Some(format!("https://video.wordpress.com/embed/{guid}"))
            }
            _ => None,
        }
    }
}

/// The MIME type of uploaded audio, by its stored extension.
pub(crate) fn audio_mime_type(path: &str) -> Option<&'static str> {
    match file_extension(path).as_str() {
        "mp3" => Some("audio/mpeg"),
        "m4a" => Some("audio/mp4"),
        "wav" => Some("audio/wav"),
        _ => None,
    }
}

fn file_extension(path: &str) -> String {
    let name = path.rsplit(['/', '\\']).next().unwrap_or_default();
    match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => extension.to_ascii_lowercase(),
        _ => String::new(),
    }
}

fn media_for_extension(extension: &str, allow_video: bool) -> EditorMedia {
    if AUDIO_EXTENSIONS.contains(&extension) {
        EditorMedia::Audio
    } else if allow_video && VIDEO_FILE_EXTENSIONS.contains(&extension) {
        EditorMedia::Video(VideoSource::File)
    } else {
        EditorMedia::Image
    }
}

fn site_host(host: &str) -> String {
    let host = host.to_ascii_lowercase();
    for prefix in ["www.", "m.", "music."] {
        if let Some(rest) = host.strip_prefix(prefix) {
            return rest.to_string();
        }
    }
    host
}

fn path_segments(url: &url::Url) -> Vec<String> {
    url.path()
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(str::to_string)
        .collect()
}

fn query_value(url: &url::Url, name: &str) -> Option<String> {
    url.query_pairs()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
}

fn is_youtube_id(value: &str) -> bool {
    value.len() == 11
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn is_vimeo_hash(value: &str) -> bool {
    value.len() >= 6
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn youtube_media(url: &url::Url, host: &str) -> Option<EditorMedia> {
    let segments = path_segments(url);
    let id = match host {
        "youtu.be" => segments.first().cloned().unwrap_or_default(),
        "youtube.com" | "youtube-nocookie.com" => match segments.first().map(String::as_str) {
            Some("watch") => query_value(url, "v").unwrap_or_default(),
            Some("shorts" | "embed" | "live" | "v") => segments.get(1).cloned().unwrap_or_default(),
            _ => String::new(),
        },
        _ => return None,
    };
    Some(if is_youtube_id(&id) {
        EditorMedia::Video(VideoSource::YouTube { id })
    } else {
        EditorMedia::Image
    })
}

fn vimeo_media(url: &url::Url, host: &str) -> Option<EditorMedia> {
    if host != "vimeo.com" && host != "player.vimeo.com" {
        return None;
    }
    let segments = path_segments(url);
    let numeric_indexes = segments
        .iter()
        .enumerate()
        .filter(|(_, segment)| segment.bytes().all(|byte| byte.is_ascii_digit()))
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    let in_collection = segments
        .first()
        .is_some_and(|first| VIMEO_COLLECTION_SEGMENTS.contains(&first.as_str()));
    let id_index = if in_collection {
        numeric_indexes.last()
    } else {
        numeric_indexes.first()
    };
    let Some(&id_index) = id_index else {
        return Some(EditorMedia::Image);
    };
    let hash = query_value(url, "h")
        .filter(|hash| !hash.is_empty())
        .or_else(|| segments.get(id_index + 1).cloned())
        .filter(|hash| is_vimeo_hash(hash));
    Some(EditorMedia::Video(VideoSource::Vimeo {
        id: segments[id_index].clone(),
        hash,
    }))
}

fn videopress_media(url: &url::Url, host: &str) -> Option<EditorMedia> {
    if host != "videopress.com" && host != "video.wordpress.com" {
        return None;
    }
    let segments = path_segments(url);
    let guid = match (segments.first().map(String::as_str), segments.get(1)) {
        (Some("v" | "embed"), Some(guid))
            if guid.len() == 8 && guid.bytes().all(|byte| byte.is_ascii_alphanumeric()) =>
        {
            guid.clone()
        }
        _ => return Some(EditorMedia::Image),
    };
    Some(EditorMedia::Video(VideoSource::VideoPress { guid }))
}

pub(super) fn media_for_url(value: &str) -> EditorMedia {
    let Ok(url) = url::Url::parse(value.trim()) else {
        return EditorMedia::Image;
    };
    if !matches!(url.scheme(), "http" | "https") {
        return EditorMedia::Image;
    }
    let host = site_host(url.host_str().unwrap_or_default());
    youtube_media(&url, &host)
        .or_else(|| vimeo_media(&url, &host))
        .or_else(|| videopress_media(&url, &host))
        .unwrap_or_else(|| media_for_extension(&file_extension(url.path()), true))
}

/// Video cannot be uploaded, so an uploaded file is only ever an image or audio.
pub(super) fn media_for_upload_path(path: &str) -> EditorMedia {
    media_for_extension(&file_extension(path), false)
}

const THUMBNAIL_LOOKUP_TIMEOUT: Duration = Duration::from_secs(6);
const MAX_THUMBNAIL_RESPONSE_BYTES: u64 = 256 * 1024;
const THUMBNAIL_USER_AGENT: &str = concat!("GnosisTMS/", env!("CARGO_PKG_VERSION"));

/// Where a Vimeo or VideoPress video's poster image can be looked up, and the
/// JSON field that holds it. YouTube needs no lookup; files have no poster.
fn thumbnail_lookup(media: &EditorMedia) -> Option<(String, &'static str)> {
    let EditorMedia::Video(source) = media else {
        return None;
    };
    match source {
        VideoSource::Vimeo { id, hash } => {
            let video_url = match hash {
                Some(hash) => format!("https://vimeo.com/{id}/{hash}"),
                None => format!("https://vimeo.com/{id}"),
            };
            let mut endpoint = url::Url::parse("https://vimeo.com/api/oembed.json").ok()?;
            endpoint
                .query_pairs_mut()
                .append_pair("url", &video_url)
                .append_pair("width", "640");
            Some((endpoint.to_string(), "thumbnail_url"))
        }
        VideoSource::VideoPress { guid } => Some((
            format!("https://public-api.wordpress.com/rest/v1.1/videos/{guid}"),
            "poster",
        )),
        VideoSource::YouTube { .. } | VideoSource::File => None,
    }
}

/// The poster image address for a Vimeo or VideoPress video, or None when the
/// video has none or the lookup fails.
pub(crate) fn fetch_video_thumbnail_url(video_url: &str) -> Option<String> {
    let (endpoint, field) = thumbnail_lookup(&media_for_url(video_url))?;
    let client = super::chapter_export::public_http_client_for_url(
        &endpoint,
        THUMBNAIL_LOOKUP_TIMEOUT,
        THUMBNAIL_USER_AGENT,
    )
    .ok()?;
    let response = client.get(&endpoint).send().ok()?;
    if !response.status().is_success() {
        return None;
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_THUMBNAIL_RESPONSE_BYTES)
        .read_to_end(&mut bytes)
        .ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let thumbnail = value.get(field)?.as_str()?.trim();
    let parsed = url::Url::parse(thumbnail).ok()?;
    (parsed.scheme() == "https").then(|| thumbnail.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const CASES_JSON: &str =
        include_str!("../../../../tests/fixtures/editor-media-kind/cases.json");

    fn describe(media: &EditorMedia) -> (String, Option<String>, Option<String>, Option<String>) {
        match media {
            EditorMedia::Image => ("image".into(), None, None, None),
            EditorMedia::Audio => ("audio".into(), None, None, None),
            EditorMedia::Video(VideoSource::YouTube { id }) => (
                "video".into(),
                Some("youtube".into()),
                Some(id.clone()),
                None,
            ),
            EditorMedia::Video(VideoSource::Vimeo { id, hash }) => (
                "video".into(),
                Some("vimeo".into()),
                Some(id.clone()),
                hash.clone(),
            ),
            EditorMedia::Video(VideoSource::VideoPress { guid }) => (
                "video".into(),
                Some("videopress".into()),
                Some(guid.clone()),
                None,
            ),
            EditorMedia::Video(VideoSource::File) => {
                ("video".into(), Some("file".into()), None, None)
            }
        }
    }

    #[test]
    fn media_kind_matches_the_shared_fixture() {
        let fixture: Value = serde_json::from_str(CASES_JSON).expect("fixture json");
        let cases = fixture["cases"].as_array().expect("cases");
        assert!(!cases.is_empty());
        for case in cases {
            let text = |key: &str| case.get(key).and_then(Value::as_str).map(str::to_string);
            let (media, input) = match text("url") {
                Some(url) => (media_for_url(&url), url),
                None => {
                    let path = text("uploadPath").expect("url or uploadPath");
                    (media_for_upload_path(&path), path)
                }
            };
            let expected = (
                text("kind").expect("kind"),
                text("provider"),
                text("id"),
                text("hash"),
            );
            assert_eq!(describe(&media), expected, "case {input}");
        }
    }

    #[test]
    fn thumbnail_lookups_use_each_provider_endpoint() {
        let lookup = |url: &str| thumbnail_lookup(&media_for_url(url));
        assert_eq!(
            lookup("https://vimeo.com/76979871/8272103f6e"),
            Some((
                "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871%2F8272103f6e&width=640".to_string(),
                "thumbnail_url"
            ))
        );
        assert_eq!(
            lookup("https://videopress.com/v/bd2G0c0g"),
            Some((
                "https://public-api.wordpress.com/rest/v1.1/videos/bd2G0c0g".to_string(),
                "poster"
            ))
        );
        assert_eq!(lookup("https://youtu.be/dQw4w9WgXcQ"), None);
        assert_eq!(lookup("https://example.org/talk.mp4"), None);
    }
}
