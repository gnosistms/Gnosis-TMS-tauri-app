use std::collections::BTreeSet;

const MAX_SHORT_FOLDER_BASE_LEN: usize = 22;
const MAX_IMAGE_BASE_LEN: usize = 22;
const MAX_IMAGE_EXTENSION_LEN: usize = 5;

pub(crate) fn allocate_short_folder_name<I, S>(input: &str, existing_names: I) -> String
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let base = truncate_name_base(
        &sanitize_folder_component(input),
        MAX_SHORT_FOLDER_BASE_LEN,
        "untitled",
    );
    allocate_unique_name(base, None, existing_names)
}

pub(crate) fn allocate_short_image_filename<I, S>(
    filename: &str,
    fallback_extension: &str,
    existing_names: I,
) -> String
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let (base, extension) = split_image_filename(filename, fallback_extension);
    let base = truncate_name_base(&sanitize_file_component(&base), MAX_IMAGE_BASE_LEN, "image");
    let extension = truncate_chars(&sanitize_extension(&extension), MAX_IMAGE_EXTENSION_LEN);
    let extension = if extension.is_empty() {
        None
    } else {
        Some(extension)
    };
    allocate_unique_name(base, extension.as_deref(), existing_names)
}

pub(crate) fn sanitize_folder_component(value: &str) -> String {
    let mut slug = String::new();
    let mut last_was_separator = false;

    for character in value.trim().chars().flat_map(char::to_lowercase) {
        if character.is_ascii_alphanumeric() {
            slug.push(character);
            last_was_separator = false;
        } else if matches!(character, '-' | '_' | '.') {
            if !last_was_separator {
                slug.push(character);
                last_was_separator = true;
            }
        } else if !last_was_separator {
            slug.push('-');
            last_was_separator = true;
        }
    }

    let trimmed = slug.trim_matches(['-', '_', '.']).to_string();
    if trimmed.is_empty() {
        "untitled".to_string()
    } else {
        trimmed
    }
}

fn sanitize_file_component(value: &str) -> String {
    let mut slug = String::new();
    let mut last_was_separator = false;

    for character in value.trim().chars() {
        let character = if character.is_ascii_alphanumeric() {
            character.to_ascii_lowercase()
        } else if matches!(character, '-' | '_' | '.') {
            character
        } else {
            '-'
        };

        if matches!(character, '-' | '_' | '.') {
            if last_was_separator {
                continue;
            }
            last_was_separator = true;
        } else {
            last_was_separator = false;
        }
        slug.push(character);
    }

    let trimmed = slug.trim_matches(['-', '_', '.']).to_string();
    if trimmed.is_empty() {
        "image".to_string()
    } else {
        trimmed
    }
}

fn sanitize_extension(value: &str) -> String {
    value
        .trim()
        .trim_start_matches('.')
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn split_image_filename(filename: &str, fallback_extension: &str) -> (String, String) {
    let normalized = filename.trim();
    let fallback_extension = sanitize_extension(fallback_extension);
    match normalized.rsplit_once('.') {
        Some((base, extension)) if !base.trim().is_empty() && !extension.trim().is_empty() => {
            (base.to_string(), extension.to_string())
        }
        _ => (normalized.to_string(), fallback_extension),
    }
}

fn allocate_unique_name<I, S>(base: String, extension: Option<&str>, existing_names: I) -> String
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let existing = existing_names
        .into_iter()
        .map(|name| name.as_ref().trim().to_ascii_lowercase())
        .collect::<BTreeSet<_>>();

    for suffix in 1usize.. {
        let candidate = if suffix == 1 {
            format_name(&base, extension)
        } else {
            format_name(&format!("{base}-{suffix}"), extension)
        };
        if !existing.contains(&candidate.to_ascii_lowercase()) {
            return candidate;
        }
    }

    unreachable!("usize suffix iteration should eventually find a unique name")
}

fn format_name(base: &str, extension: Option<&str>) -> String {
    match extension {
        Some(extension) if !extension.is_empty() => format!("{base}.{extension}"),
        _ => base.to_string(),
    }
}

fn truncate_chars(value: &str, max_len: usize) -> String {
    value.chars().take(max_len).collect()
}

fn truncate_name_base(value: &str, max_len: usize, fallback: &str) -> String {
    let truncated = truncate_chars(value, max_len)
        .trim_matches(['-', '_', '.'])
        .to_string();
    if truncated.is_empty() {
        fallback.to_string()
    } else {
        truncated
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_names_are_sanitized_truncated_and_unique_case_insensitively() {
        assert_eq!(
            allocate_short_folder_name(
                "A Very Long Chapter Name That Keeps Going",
                ["a-very-long-chapter-na"]
            ),
            "a-very-long-chapter-na-2"
        );
        assert_eq!(
            allocate_short_folder_name("!!!", Vec::<String>::new()),
            "untitled"
        );
        assert_eq!(
            allocate_short_folder_name("Chapter", ["chapter", "CHAPTER-2"]),
            "chapter-3"
        );
    }

    #[test]
    fn image_names_preserve_extension_and_suffix_before_extension() {
        assert_eq!(
            allocate_short_image_filename(
                "A very long imported screenshot.filename.jpeg",
                "jpg",
                ["a-very-long-imported-s.jpeg"]
            ),
            "a-very-long-imported-s-2.jpeg"
        );
        assert_eq!(
            allocate_short_image_filename("photo.png", "png", ["PHOTO.png"]),
            "photo-2.png"
        );
    }

    #[test]
    fn image_extensions_are_limited_to_five_characters() {
        assert_eq!(
            allocate_short_image_filename("sample.longextension", "png", Vec::<String>::new()),
            "sample.longe"
        );
    }
}
