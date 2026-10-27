use super::*;
use std::collections::{HashMap, HashSet};
fn units(text: &str) -> Vec<String> {
    let text = normalized(text).to_lowercase();
    text.graphemes(true)
        .filter(|g| g.chars().any(|c| c.is_alphanumeric()))
        .map(str::to_owned)
        .collect()
}
fn patterns(text: &str, sizes: &[usize]) -> HashSet<String> {
    let chars = units(text);
    sizes
        .iter()
        .flat_map(|&n| chars.windows(n).map(|w| w.concat()).collect::<Vec<_>>())
        .collect()
}
/// Candidate generation uses book-local frequency, never language dictionaries.
/// Fixed suffix lengths and wider phrase lengths bound index work.
pub(super) fn pairs(
    notes: &[Occurrence],
    book_texts: &[String],
    near_cache: &mut BTreeMap<String, bool>,
) -> BTreeSet<(usize, usize)> {
    let mut index: HashMap<String, Vec<usize>> = HashMap::new();
    let mut body_index: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, note) in notes.iter().enumerate() {
        let tail = note
            .context
            .graphemes(true)
            .rev()
            .take(128)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<String>();
        let tail_units = units(&tail);
        let mut context_patterns = patterns(&tail, &[16, 32]);
        for size in [1, 2, 4, 8, 16, 32, 64] {
            if tail_units.len() >= size {
                context_patterns.insert(tail_units[tail_units.len() - size..].concat());
            }
        }
        for pattern in context_patterns {
            index.entry(pattern).or_default().push(i);
        }
        body_index
            .entry(format!("exact:{}", normalized(&note.text)))
            .or_default()
            .push(i);
        if note.text.graphemes(true).count() >= 50 {
            for p in patterns(&note.text, &[8]) {
                body_index.entry(p).or_default().push(i);
            }
        }
    }
    let mut frequencies: HashMap<String, usize> = HashMap::new();
    for text in book_texts {
        for pattern in patterns(text, &[1, 2, 4, 8, 16, 32, 64]) {
            if index.contains_key(&pattern) {
                *frequencies.entry(pattern).or_default() += 1;
            }
        }
    }
    let mut result = BTreeSet::new();
    for (pattern, members) in index {
        let length = pattern.graphemes(true).count();
        let frequency = *frequencies.get(&pattern).unwrap_or(&1);
        // Estimate information from this book, with a small-corpus prior. A
        // boilerplate ending occurring everywhere supplies little evidence even
        // when long. Body matching remains an independent route into review.
        let population = book_texts.len().max(20) as f64;
        let information = ((population + 1.0) / (frequency as f64 + 1.0))
            .ln()
            .max(0.0);
        if length as f64 * information < 1.5 {
            continue;
        }
        for (offset, &a) in members.iter().enumerate() {
            for &b in &members[offset + 1..] {
                result.insert((a, b));
            }
        }
    }
    for members in body_index.values() {
        for (offset, &a) in members.iter().enumerate() {
            for &b in &members[offset + 1..] {
                let mut bodies = [normalized(&notes[a].text), normalized(&notes[b].text)];
                bodies.sort();
                let key = digest(format!("{}\0{}", bodies[0], bodies[1]));
                if bodies[0] == bodies[1]
                    || *near_cache
                        .entry(key)
                        .or_insert_with(|| near(&bodies[0], &bodies[1]))
                {
                    result.insert((a, b));
                }
            }
        }
    }
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
    fn local_frequency_prunes_common_endings_in_every_script() {
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
            let mut text = vec![common.to_string(); 30];
            text.push(distinct.into());
            let found = pairs(&notes, &text, &mut BTreeMap::new());
            assert!(!found.contains(&(0, 1)), "common ending {common}");
            assert!(found.contains(&(2, 3)), "distinct phrase {distinct}");
        }
    }
    #[test]
    fn body_matching_survives_common_context_and_reuses_distance_evidence() {
        let body =
            "This is a sufficiently long explanation to qualify for near duplicate comparison.";
        let notes = vec![
            note(0, "the", body),
            note(1, "the", &body.replace("long", "full")),
        ];
        let mut distances = BTreeMap::new();
        let texts = vec!["the".to_string(); 30];
        assert!(pairs(&notes, &texts, &mut distances).contains(&(0, 1)));
        let saved = distances.clone();
        assert!(!saved.is_empty());
        assert!(pairs(&notes, &texts, &mut distances).contains(&(0, 1)));
        assert_eq!(distances, saved);
    }
    #[test]
    fn benchmark_common_endings_1000_notes() {
        let notes = (0..1000)
            .map(|id| {
                note(
                    id,
                    &format!("Context {id} ends in the"),
                    &format!("Distinct short note {id}"),
                )
            })
            .collect::<Vec<_>>();
        let texts = notes.iter().map(|n| n.context.clone()).collect::<Vec<_>>();
        let started = std::time::Instant::now();
        let found = pairs(&notes, &texts, &mut BTreeMap::new());
        eprintln!(
            "1000 notes: {} candidates, {:?}",
            found.len(),
            started.elapsed()
        );
        assert!(
            found.len() < 100_000,
            "common endings should not generate every pair"
        );
    }
}
