use super::*;
use std::collections::{HashMap, HashSet};

fn stripped(text: &str) -> String {
    normalized(
        &text
            .nfc()
            .collect::<String>()
            .to_lowercase()
            .graphemes(true)
            .filter(|g| {
                g.chars().any(|c| c.is_alphanumeric()) || g.chars().all(char::is_whitespace)
            })
            .collect::<String>(),
    )
}
fn common_suffix<'a>(a: &[&'a str], b: &[&'a str]) -> String {
    a.iter()
        .zip(b)
        .take_while(|(left, right)| left == right)
        .map(|(unit, _)| *unit)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}
fn word_boundary(text: &str, offset: usize) -> bool {
    offset == 0
        || text[offset..].starts_with(char::is_whitespace)
        || text
            .unicode_word_indices()
            .any(|(start, _)| start == offset)
}
fn meaningful_suffix(
    a: &str,
    b: &str,
    suffix: &str,
    frequency: &HashMap<String, usize>,
    population: usize,
) -> bool {
    if suffix.is_empty() {
        return false;
    }
    let complete =
        word_boundary(a, a.len() - suffix.len()) && word_boundary(b, b.len() - suffix.len());
    let mut words = suffix.unicode_words();
    if !complete {
        // Drop a shared ending inside an ordinary word ("health"/"wealth").
        // Long unsegmented runs still support Thai and other unspaced scripts.
        let dense = [a, b].iter().all(|text| {
            text.unicode_words()
                .next_back()
                .unwrap_or("")
                .graphemes(true)
                .count()
                > 12
        });
        if dense && suffix.graphemes(true).count() >= 4 {
            return true;
        }
        words.next();
    }
    let information: f64 = words
        .map(|word| {
            let count = *frequency.get(word).unwrap_or(&0);
            ((population.max(20) as f64 + 1.0) / (count as f64 + 1.0))
                .ln()
                .max(0.0)
        })
        .sum();
    information >= 2.5
}
#[derive(Default, Serialize, Deserialize)]
pub(super) struct WordFrequencies {
    population: usize,
    words: HashMap<String, usize>,
}
pub(super) fn count_words(book_texts: &[String]) -> WordFrequencies {
    let mut words = HashMap::<String, usize>::new();
    for text in book_texts {
        let clean = text.nfc().flat_map(char::to_lowercase).collect::<String>();
        for word in clean.unicode_words().collect::<HashSet<_>>() {
            *words.entry(word.to_owned()).or_default() += 1;
        }
    }
    WordFrequencies {
        population: book_texts.len(),
        words,
    }
}
/// Reverse punctuation-stripped contexts, sort, then compare ONLY neighbors.
/// Matching adjacent notes chain into candidate groups for semantic splitting.
pub(super) fn groups(notes: &[Occurrence], frequency: &WordFrequencies) -> Vec<Vec<usize>> {
    if notes.len() < 2 {
        return Vec::new();
    }
    #[cfg(debug_assertions)]
    let phase = std::time::Instant::now();
    let contexts = notes
        .iter()
        .map(|note| stripped(&note.context))
        .collect::<Vec<_>>();
    let reversed = contexts
        .iter()
        .map(|text| text.graphemes(true).rev().collect::<Vec<_>>())
        .collect::<Vec<_>>();
    let mut order = (0..notes.len()).collect::<Vec<_>>();
    order.sort_by(|&a, &b| reversed[a].cmp(&reversed[b]));
    let mut result = Vec::new();
    let mut chain = Vec::new();
    for adjacent in order.windows(2) {
        let (a, b) = (adjacent[0], adjacent[1]);
        let suffix = common_suffix(&reversed[a], &reversed[b]);
        if meaningful_suffix(
            &contexts[a],
            &contexts[b],
            &suffix,
            &frequency.words,
            frequency.population,
        ) {
            if chain.is_empty() {
                chain.push(a);
            }
            chain.push(b);
        } else if chain.len() > 1 {
            result.push(std::mem::take(&mut chain));
        }
    }
    if chain.len() > 1 {
        result.push(chain);
    }
    #[cfg(debug_assertions)]
    eprintln!(
        "[book redundancy] {} notes: {} neighbor comparisons including normalization/sort {:?}",
        notes.len(),
        notes.len() - 1,
        phase.elapsed()
    );
    result
}

pub(super) fn near(a: &str, b: &str) -> bool {
    let a = normalized(a);
    let b = normalized(b);
    let a: Vec<_> = a.graphemes(true).collect();
    let b: Vec<_> = b.graphemes(true).collect();
    if a.len() < 50 || b.len() < 50 {
        return false;
    }
    let limit = a.len().max(b.len()) / 20;
    if a.len().abs_diff(b.len()) > limit {
        return false;
    }
    let infinity = limit + 1;
    let mut previous = (0..=limit.min(b.len())).collect::<Vec<_>>();
    let mut previous_start = 0usize;
    for (i, x) in a.iter().enumerate() {
        let row = i + 1;
        let start = row.saturating_sub(limit);
        let end = (row + limit).min(b.len());
        let mut current = vec![infinity; end - start + 1];
        let prior = |col: usize| {
            if col >= previous_start {
                previous
                    .get(col - previous_start)
                    .copied()
                    .unwrap_or(infinity)
            } else {
                infinity
            }
        };
        for col in start..=end {
            current[col - start] = if col == 0 {
                row
            } else {
                let insert = if col > start {
                    current[col - start - 1] + 1
                } else {
                    infinity
                };
                (prior(col) + 1)
                    .min(insert)
                    .min(prior(col - 1) + usize::from(*x != b[col - 1]))
            };
        }
        if *current.iter().min().unwrap_or(&infinity) > limit {
            return false;
        }
        previous = current;
        previous_start = start;
    }
    previous
        .get(b.len() - previous_start)
        .copied()
        .unwrap_or(infinity)
        <= limit
}

#[cfg(test)]
mod tests {
    use super::*;
    fn find_groups(notes: &[Occurrence], texts: &[String]) -> Vec<Vec<usize>> {
        groups(notes, &count_words(texts))
    }
    fn note(id: usize, context: &str, body: &str) -> Occurrence {
        Occurrence {
            id: id.to_string(),
            item_id: "chapter".into(),
            chapter_name: "Chapter".into(),
            row_id: id.to_string(),
            kind: "footnote".into(),
            marker: 1,
            signature: "sig".into(),
            text: body.into(),
            context: context.into(),
            image_src: String::new(),
            choice_aliases: Vec::new(),
            identity: String::new(),
        }
    }
    #[test]
    fn neighboring_reversed_contexts_chain_without_cross_comparisons() {
        let notes = vec![
            note(0, "First: dependent origination!", "one"),
            note(1, "Other term", "other"),
            note(2, "Second dependent origination", "two"),
            note(3, "Third dependent origination.", "three"),
        ];
        let texts = notes
            .iter()
            .map(|note| note.context.clone())
            .collect::<Vec<_>>();
        let found = find_groups(&notes, &texts);
        assert_eq!(found.len(), 1);
        assert_eq!(
            found[0].iter().copied().collect::<BTreeSet<_>>(),
            BTreeSet::from([0, 2, 3])
        );
        assert_eq!(found[0].windows(2).count(), 2);
        assert!(find_groups(&[], &[]).is_empty());
        assert!(find_groups(&notes[..1], &texts).is_empty());
    }
    #[test]
    fn common_words_and_partial_word_endings_do_not_group() {
        let notes = vec![
            note(0, "First the", "one"),
            note(1, "Second the", "two"),
            note(2, "health", "three"),
            note(3, "wealth", "four"),
        ];
        let mut texts = vec!["the".into(); 30];
        texts.extend(["health".into(), "wealth".into()]);
        assert!(find_groups(&notes, &texts).is_empty());
    }
    #[test]
    fn meaningful_endings_work_without_language_dictionaries() {
        for (common, distinct) in [
            ("the", "Avalokiteśvara"),
            ("的", "緣起"),
            ("และ", "ปฏิจจสมุปบาท"),
            ("في", "الإسكندرية"),
        ] {
            let notes = vec![
                note(0, common, "one"),
                note(1, common, "two"),
                note(2, distinct, "three"),
                note(3, distinct, "four"),
            ];
            let mut texts = vec![common.to_string(); 30];
            texts.push(distinct.into());
            let found = find_groups(&notes, &texts);
            assert!(
                !found
                    .iter()
                    .any(|group| group.contains(&0) && group.contains(&1)),
                "common {common}"
            );
            assert!(
                found
                    .iter()
                    .any(|group| group.contains(&2) && group.contains(&3)),
                "distinct {distinct}"
            );
        }
    }
    #[test]
    fn body_matches_do_not_trigger_a_separate_all_pairs_search() {
        let body =
            "This is a sufficiently long explanation to qualify for near duplicate comparison.";
        let notes = vec![
            note(0, "one unique referent", body),
            note(1, "a different anchor", body),
        ];
        let texts = notes
            .iter()
            .map(|note| note.context.clone())
            .collect::<Vec<_>>();
        assert!(find_groups(&notes, &texts).is_empty());
        assert!(near(body, &body.replace("long", "full")));
    }
    #[test]
    fn near_threshold_and_unicode() {
        assert!(!near("short", "short"));
        let a = "a".repeat(100);
        assert!(near(&a, &"a".repeat(95)));
        assert!(!near(&a, &"a".repeat(94)));
        assert!(near(&a, &format!("{}bbbbb", "a".repeat(95))));
        assert!(!near(&a, &format!("{}bbbbbb", "a".repeat(94))));
        assert!(near(&"字".repeat(50), &format!("{}文", "字".repeat(49))));
    }
    #[test]
    fn benchmark_common_endings_1000_notes() {
        let notes = (0..1000)
            .map(|id| {
                note(
                    id,
                    &format!("Context {id} ends in the"),
                    &format!("Distinct note {id}"),
                )
            })
            .collect::<Vec<_>>();
        let texts = notes
            .iter()
            .map(|note| note.context.clone())
            .collect::<Vec<_>>();
        let started = std::time::Instant::now();
        let found = find_groups(&notes, &texts);
        eprintln!(
            "1000 notes: {} groups, {:?}",
            found.len(),
            started.elapsed()
        );
        assert!(found.is_empty());
    }
}
