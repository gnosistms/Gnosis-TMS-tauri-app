//! List rows. A row in one of the list text styles holds a whole, possibly nested,
//! list: each line of its text is one item, and the tabs at the start of a line set
//! the item's nesting level. The list style picks how each level is marked. These
//! rules mirror `src-ui/app/editor-list.js`; see `plans/list-row-style-plan.md`.
use super::chapter_export::{footnote_paragraphs, inline_visible_text};
use super::normalize_editor_text_style_value;

pub(super) const LIST_BULLET_TEXT_STYLE: &str = "list_bullet";
pub(super) const LIST_NUMBER_TEXT_STYLE: &str = "list_number";
pub(super) const LIST_LETTER_TEXT_STYLE: &str = "list_letter";
pub(super) const LIST_ROMAN_TEXT_STYLE: &str = "list_roman";

/// The deepest level, zero-based: nine levels, the DOCX maximum.
pub(super) const LIST_MAX_LEVEL: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ListKind {
    Bullet,
    Number,
    Letter,
    Roman,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ListLevelFormat {
    Disc,
    Circle,
    Square,
    Decimal,
    LowerAlpha,
    LowerRoman,
    UpperAlpha,
    UpperRoman,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ListItem {
    pub(super) level: usize,
    /// The item's inline markup, without its leading tabs.
    pub(super) text: String,
}

/// The nesting structure of a list, for the formats with native nested lists. A
/// nested list opens inside its parent item, before that item closes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ListEvent {
    OpenList(ListLevelFormat),
    OpenItem(usize),
    CloseItem,
    CloseList(ListLevelFormat),
}

pub(super) fn list_kind(text_style: &str) -> Option<ListKind> {
    match normalize_editor_text_style_value(Some(text_style)).as_str() {
        LIST_BULLET_TEXT_STYLE => Some(ListKind::Bullet),
        LIST_NUMBER_TEXT_STYLE => Some(ListKind::Number),
        LIST_LETTER_TEXT_STYLE => Some(ListKind::Letter),
        LIST_ROMAN_TEXT_STYLE => Some(ListKind::Roman),
        _ => None,
    }
}

pub(super) fn is_list_text_style(text_style: &str) -> bool {
    list_kind(text_style).is_some()
}

impl ListKind {
    /// The format of a nesting level; the sequence repeats past its end.
    pub(super) fn level_format(self, level: usize) -> ListLevelFormat {
        use ListLevelFormat::*;
        let sequence: &[ListLevelFormat] = match self {
            ListKind::Bullet => &[Disc, Circle, Square],
            ListKind::Number => &[Decimal, LowerAlpha, LowerRoman],
            ListKind::Letter => &[LowerAlpha, LowerRoman, Decimal],
            ListKind::Roman => &[UpperRoman, UpperAlpha, Decimal, LowerAlpha, LowerRoman],
        };
        sequence[level % sequence.len()]
    }
}

impl ListLevelFormat {
    pub(super) fn is_ordered(self) -> bool {
        !matches!(
            self,
            ListLevelFormat::Disc | ListLevelFormat::Circle | ListLevelFormat::Square
        )
    }

    pub(super) fn css_list_style_type(self) -> &'static str {
        match self {
            ListLevelFormat::Disc => "disc",
            ListLevelFormat::Circle => "circle",
            ListLevelFormat::Square => "square",
            ListLevelFormat::Decimal => "decimal",
            ListLevelFormat::LowerAlpha => "lower-alpha",
            ListLevelFormat::LowerRoman => "lower-roman",
            ListLevelFormat::UpperAlpha => "upper-alpha",
            ListLevelFormat::UpperRoman => "upper-roman",
        }
    }

    pub(super) fn bullet(self) -> Option<&'static str> {
        match self {
            ListLevelFormat::Disc => Some("•"),
            ListLevelFormat::Circle => Some("◦"),
            ListLevelFormat::Square => Some("▪"),
            _ => None,
        }
    }

    /// The counter value alone ("3", "c", "iii"); empty for bullets.
    pub(super) fn counter(self, number: usize) -> String {
        let number = number.max(1);
        match self {
            ListLevelFormat::Disc | ListLevelFormat::Circle | ListLevelFormat::Square => {
                String::new()
            }
            ListLevelFormat::Decimal => number.to_string(),
            ListLevelFormat::LowerAlpha => alphabetic(number),
            ListLevelFormat::LowerRoman => roman(number).to_lowercase(),
            ListLevelFormat::UpperAlpha => alphabetic(number).to_uppercase(),
            ListLevelFormat::UpperRoman => roman(number),
        }
    }

    /// The marker as text, for the formats that set it by hand: the bullet glyph,
    /// or the counter with a trailing period.
    pub(super) fn marker(self, number: usize) -> String {
        match self.bullet() {
            Some(bullet) => bullet.to_string(),
            None => format!("{}.", self.counter(number)),
        }
    }
}

/// Alphabetic counters continue past z as aa, ab, … (bijective base 26), as CSS
/// and Typst count.
fn alphabetic(mut number: usize) -> String {
    let mut letters = Vec::new();
    while number > 0 {
        number -= 1;
        letters.push(char::from(b'a' + (number % 26) as u8));
        number /= 26;
    }
    letters.iter().rev().collect()
}

/// Roman numerals for any positive integer; thousands repeat M.
fn roman(mut number: usize) -> String {
    const NUMERALS: &[(usize, &str)] = &[
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ];
    let mut output = String::new();
    for (value, numeral) in NUMERALS {
        while number >= *value {
            output.push_str(numeral);
            number -= value;
        }
    }
    output
}

/// The items of a list row's text. Every line is an item, and a formatting run
/// that spans a line break is closed and reopened, so each item's markup stands
/// alone. The tabs that start a line, read through any tags among them (as when
/// formatting covers a whole line), give the item's level and are removed; the
/// tags stay. Blank lines are
/// dropped. The first item is at level 0, and an item is at most one level deeper
/// than the item before it.
pub(super) fn list_items(text: &str) -> Vec<ListItem> {
    let mut items: Vec<ListItem> = Vec::new();
    for line in footnote_paragraphs(text) {
        if inline_visible_text(&line).trim().is_empty() {
            continue;
        }
        let (tabs, item_text) = strip_leading_tabs(&line);
        let level = items
            .last()
            .map_or(0, |previous| tabs.min(previous.level + 1))
            .min(LIST_MAX_LEVEL);
        items.push(ListItem {
            level,
            text: item_text.trim().to_string(),
        });
    }
    items
}

fn strip_leading_tabs(line: &str) -> (usize, String) {
    let mut tabs = 0;
    let mut text = String::new();
    let mut cursor = 0;
    while cursor < line.len() {
        let remaining = &line[cursor..];
        if remaining.starts_with('\t') {
            tabs += 1;
            cursor += 1;
        } else if let Some(close) = remaining.strip_prefix('<').and_then(|tag| tag.find('>')) {
            let length = close + 2;
            text.push_str(&remaining[..length]);
            cursor += length;
        } else {
            break;
        }
    }
    text.push_str(&line[cursor..]);
    (tabs, text)
}

/// A list row's text in normal form: its items, one per line, each preceded by
/// one tab per level.
pub(super) fn normalized_list_text(text: &str) -> String {
    list_items(text)
        .iter()
        .map(|item| format!("{}{}", "\t".repeat(item.level), item.text))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Each item's number within its own level. An item counts up its level and
/// restarts the levels below it; every list row starts again at 1.
pub(super) fn list_item_numbers(items: &[ListItem]) -> Vec<usize> {
    let mut counters = [0usize; LIST_MAX_LEVEL + 1];
    items
        .iter()
        .map(|item| {
            let level = item.level.min(LIST_MAX_LEVEL);
            counters[level] += 1;
            counters[level + 1..].fill(0);
            counters[level]
        })
        .collect()
}

/// Opens and closes the nested lists around the items. Expects the normalized
/// levels `list_items` returns.
pub(super) fn list_events(kind: ListKind, items: &[ListItem]) -> Vec<ListEvent> {
    let mut events = Vec::new();
    let mut open_lists = 0usize;
    for (index, item) in items.iter().enumerate() {
        if item.level < open_lists {
            while open_lists > item.level + 1 {
                open_lists -= 1;
                events.push(ListEvent::CloseItem);
                events.push(ListEvent::CloseList(kind.level_format(open_lists)));
            }
            events.push(ListEvent::CloseItem);
        }
        while open_lists <= item.level {
            events.push(ListEvent::OpenList(kind.level_format(open_lists)));
            open_lists += 1;
        }
        events.push(ListEvent::OpenItem(index));
    }
    while open_lists > 0 {
        open_lists -= 1;
        events.push(ListEvent::CloseItem);
        events.push(ListEvent::CloseList(kind.level_format(open_lists)));
    }
    events
}

/// Nested `<ul>`/`<ol>` lists with each level's `list-style-type`, for the HTML
/// and EPUB exports. `items_html` holds each item's rendered inline HTML;
/// `attributes` go on the outermost list element.
pub(super) fn render_list_html(
    kind: ListKind,
    items: &[ListItem],
    items_html: &[String],
    attributes: &str,
) -> String {
    let mut html = String::new();
    let mut outermost = true;
    for event in list_events(kind, items) {
        match event {
            ListEvent::OpenList(format) => {
                let tag = if format.is_ordered() { "ol" } else { "ul" };
                let attributes = if std::mem::take(&mut outermost) {
                    attributes
                } else {
                    ""
                };
                html.push_str(&format!(
                    "<{tag}{attributes} style=\"list-style-type:{}\">",
                    format.css_list_style_type()
                ));
            }
            ListEvent::OpenItem(index) => {
                html.push_str("<li>");
                html.push_str(items_html.get(index).map(String::as_str).unwrap_or(""));
            }
            ListEvent::CloseItem => html.push_str("</li>"),
            ListEvent::CloseList(format) => {
                let tag = if format.is_ordered() { "ol" } else { "ul" };
                html.push_str(&format!("</{tag}>"));
            }
        }
    }
    html
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(level: usize, text: &str) -> ListItem {
        ListItem {
            level,
            text: text.to_string(),
        }
    }

    #[test]
    fn list_styles_are_recognized_with_their_aliases() {
        for (style, kind) in [
            ("list_bullet", ListKind::Bullet),
            ("list", ListKind::Bullet),
            ("ul", ListKind::Bullet),
            ("list-bullet", ListKind::Bullet),
            ("list_number", ListKind::Number),
            ("ol", ListKind::Number),
            ("list-number", ListKind::Number),
            ("list_letter", ListKind::Letter),
            ("list-letter", ListKind::Letter),
            ("list_roman", ListKind::Roman),
            ("list-roman", ListKind::Roman),
        ] {
            assert_eq!(list_kind(style), Some(kind), "{style}");
            assert!(is_list_text_style(style));
        }
        assert_eq!(list_kind("paragraph"), None);
        assert_eq!(list_kind("quote"), None);
        assert!(!is_list_text_style("list_unknown"));
    }

    #[test]
    fn items_take_their_level_from_leading_tabs_and_drop_blank_lines() {
        assert_eq!(
            list_items("One\r\n\tTwo\n\n  \n\t\tThree\n<b> </b>\n\tFour  \n Five"),
            vec![
                item(0, "One"),
                item(1, "Two"),
                item(2, "Three"),
                item(1, "Four"),
                item(0, "Five"),
            ]
        );
        assert!(list_items("").is_empty());
        assert!(list_items("\n\t\n<i></i>").is_empty());
    }

    #[test]
    fn levels_start_at_zero_deepen_one_at_a_time_and_stop_at_the_ninth() {
        assert_eq!(
            list_items("\t\tFirst\n\t\t\t\tSecond\n\tThird"),
            vec![item(0, "First"), item(1, "Second"), item(1, "Third")]
        );
        let deep = (0..12)
            .map(|level| format!("{}{level}", "\t".repeat(level)))
            .collect::<Vec<_>>()
            .join("\n");
        let levels = list_items(&deep)
            .iter()
            .map(|item| item.level)
            .collect::<Vec<_>>();
        assert_eq!(levels, vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8, 8]);
    }

    #[test]
    fn formatting_spanning_lines_is_reopened_per_item() {
        assert_eq!(
            list_items("<b>One\n\tTwo</b> and <i>three\n\n\t\tfour</i>"),
            vec![
                item(0, "<strong>One</strong>"),
                item(1, "<strong>Two</strong> and <em>three</em>"),
                item(2, "<em>four</em>"),
            ]
        );
        assert_eq!(
            list_items(
                "<a href=\"https://example.com\">Site\n\tpage</a> [1]\n\t<ruby>漢<rt>かん</rt></ruby>"
            ),
            vec![
                item(0, "<a href=\"https://example.com\">Site</a>"),
                item(1, "<a href=\"https://example.com\">page</a> [1]"),
                item(1, "<ruby>漢<rt>かん</rt></ruby>"),
            ]
        );
    }

    #[test]
    fn tabs_after_leading_tags_still_set_the_level() {
        assert_eq!(
            list_items("Top\n<strong>\t\titem</strong>\n<b>\t<i>\tdeep</i></b>"),
            vec![
                item(0, "Top"),
                item(1, "<strong>item</strong>"),
                item(2, "<strong><em>deep</em></strong>"),
            ]
        );
        // Any tag counts, as in the editor; an unclosed "<" is visible text.
        assert_eq!(
            list_items("a\n\t<mark>\tb</mark>\n\t< \tc"),
            vec![item(0, "a"), item(1, "<mark>b</mark>"), item(1, "< \tc")]
        );
        // A tab after the first visible character stays in the text.
        assert_eq!(list_items("a\tb"), vec![item(0, "a\tb")]);
    }

    #[test]
    fn normalized_text_round_trips_through_item_parsing() {
        let text = "\n\t\tOne\n<b>Two\n\t\t\tThree</b>\n\n\tFour";
        let normalized = normalized_list_text(text);
        assert_eq!(
            normalized,
            "One\n<strong>Two</strong>\n\t<strong>Three</strong>\n\tFour"
        );
        assert_eq!(list_items(&normalized), list_items(text));
        assert_eq!(normalized_list_text(&normalized), normalized);
    }

    #[test]
    fn numbers_count_per_level_and_restart_deeper_levels() {
        let items = list_items("a\n\tb\n\tc\n\t\td\n\te\nf\n\tg\n\t\th");
        assert_eq!(list_item_numbers(&items), vec![1, 1, 2, 1, 3, 2, 1, 1]);
    }

    #[test]
    fn level_formats_cycle_per_list_style() {
        use ListLevelFormat::*;
        let formats = |kind: ListKind, count: usize| {
            (0..count)
                .map(|level| kind.level_format(level))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            formats(ListKind::Bullet, 4),
            vec![Disc, Circle, Square, Disc]
        );
        assert_eq!(
            formats(ListKind::Number, 4),
            vec![Decimal, LowerAlpha, LowerRoman, Decimal]
        );
        assert_eq!(
            formats(ListKind::Letter, 4),
            vec![LowerAlpha, LowerRoman, Decimal, LowerAlpha]
        );
        assert_eq!(
            formats(ListKind::Roman, 6),
            vec![UpperRoman, UpperAlpha, Decimal, LowerAlpha, LowerRoman, UpperRoman]
        );
    }

    #[test]
    fn markers_and_css_types_follow_the_level_format() {
        use ListLevelFormat::*;
        assert_eq!(Disc.marker(3), "•");
        assert_eq!(Circle.marker(3), "◦");
        assert_eq!(Square.marker(3), "▪");
        assert_eq!(Decimal.marker(12), "12.");
        assert_eq!(LowerAlpha.marker(1), "a.");
        assert_eq!(LowerAlpha.marker(26), "z.");
        assert_eq!(LowerAlpha.marker(27), "aa.");
        assert_eq!(LowerAlpha.marker(28), "ab.");
        assert_eq!(LowerAlpha.marker(52), "az.");
        assert_eq!(LowerAlpha.marker(53), "ba.");
        assert_eq!(LowerAlpha.marker(703), "aaa.");
        assert_eq!(UpperAlpha.marker(27), "AA.");
        assert_eq!(LowerRoman.marker(4), "iv.");
        assert_eq!(UpperRoman.marker(1994), "MCMXCIV.");
        assert_eq!(UpperRoman.marker(4000), "MMMM.");
        assert_eq!(Decimal.counter(7), "7");
        assert_eq!(Disc.counter(7), "");
        assert!(!Disc.is_ordered() && !Circle.is_ordered() && !Square.is_ordered());
        assert!(Decimal.is_ordered() && UpperRoman.is_ordered());
        assert_eq!(
            [Disc, Circle, Square, Decimal, LowerAlpha, LowerRoman, UpperAlpha, UpperRoman]
                .map(ListLevelFormat::css_list_style_type),
            [
                "disc",
                "circle",
                "square",
                "decimal",
                "lower-alpha",
                "lower-roman",
                "upper-alpha",
                "upper-roman"
            ]
        );
    }

    #[test]
    fn events_nest_child_lists_inside_their_parent_item() {
        use ListEvent::*;
        use ListLevelFormat::*;
        let items = list_items("a\n\tb\n\t\tc\nd");
        assert_eq!(
            list_events(ListKind::Number, &items),
            vec![
                OpenList(Decimal),
                OpenItem(0),
                OpenList(LowerAlpha),
                OpenItem(1),
                OpenList(LowerRoman),
                OpenItem(2),
                CloseItem,
                CloseList(LowerRoman),
                CloseItem,
                CloseList(LowerAlpha),
                CloseItem,
                OpenItem(3),
                CloseItem,
                CloseList(Decimal),
            ]
        );
        assert!(list_events(ListKind::Bullet, &[]).is_empty());
    }

    #[test]
    fn html_lists_nest_with_per_level_style_types() {
        let items = list_items("One\n\tTwo\n\t\tThree\nFour");
        let html_items = items
            .iter()
            .map(|item| item.text.clone())
            .collect::<Vec<_>>();
        assert_eq!(
            render_list_html(ListKind::Roman, &items, &html_items, " id=\"x\""),
            "<ol id=\"x\" style=\"list-style-type:upper-roman\"><li>One<ol style=\"list-style-type:upper-alpha\"><li>Two<ol style=\"list-style-type:decimal\"><li>Three</li></ol></li></ol></li><li>Four</li></ol>"
        );
        assert_eq!(
            render_list_html(ListKind::Bullet, &items[..2], &html_items, ""),
            "<ul style=\"list-style-type:disc\"><li>One<ul style=\"list-style-type:circle\"><li>Two</li></ul></li></ul>"
        );
    }
}
