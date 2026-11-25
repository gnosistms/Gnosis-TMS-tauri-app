//! Fit native footnotes with the actual Typst fonts and page geometry, then
//! verify their anchors after the more compact layout repaginates the book.
use super::{eval_typst, AppHandle, AtomicBool, Path, PathBuf};
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet};
use std::{fs, future::Future};

const PLAN_FILE: &str = "qr-rows.json";
pub(super) const IMPORT: &str = r#"#import "qr-footnotes.typ": gnosis-qr-note, entry-rule, callout-rule
#set footnote.entry(gap: gnosis-footnote-gap)
#show footnote.entry: it => entry-rule(it, gnosis-qr-rows, gnosis-footnote-gap)
#show footnote: it => callout-rule(it, gnosis-qr-rows)
"#;
const MEASURE: &str = "query(<gnosis-qr-measure>).map(m => m.value).flatten()";
const PAGE_AUDIT: &str = "(anchors: query(footnote).map(n => n.location().page()), cells: query(<gnosis-qr-cell>).map(c => (c.value, c.location().page())), tall: query(<gnosis-qr-tall>).map(m => m.value))";

#[derive(Deserialize)]
struct Candidate {
    first: usize,
    count: usize,
    // Measured gain in hundredths of a point at the actual export width.
    saved: u64,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Cell {
    row: usize,
    count: usize,
}

type Rows = BTreeMap<usize, Cell>;

// Choose nonoverlapping groups with the greatest measured vertical savings.
// At equal savings, keep as many notes as possible beside their own codes.
fn pack(candidates: &[Candidate], breaks: &BTreeSet<usize>) -> Rows {
    let end = candidates
        .iter()
        .map(|c| c.first + c.count)
        .max()
        .unwrap_or(1);
    let mut starts = vec![Vec::new(); end];
    for c in candidates {
        if breaks
            .range(c.first + 1..c.first + c.count)
            .next()
            .is_none()
        {
            starts[c.first].push(c);
        }
    }
    let mut best = vec![(0, Reverse(0)); end + 1];
    let mut counts = vec![1; end];
    for first in (1..end).rev() {
        best[first] = best[first + 1];
        for c in &starts[first] {
            let (saved, Reverse(grouped)) = best[first + c.count];
            let score = (saved + c.saved, Reverse(grouped + c.count));
            if score > best[first] {
                best[first] = score;
                counts[first] = c.count;
            }
        }
    }
    let mut rows = Rows::new();
    let mut first = 1;
    while first < end {
        let count = counts[first];
        if count > 1 {
            for id in first..first + count {
                rows.insert(id, Cell { row: first, count });
            }
        }
        first += count;
    }
    rows
}

#[derive(Deserialize)]
struct PageAudit {
    anchors: Vec<usize>,
    cells: Vec<(usize, usize)>,
    tall: BTreeSet<usize>,
}

impl PageAudit {
    fn split_crossing_rows(&self, rows: &Rows, breaks: &mut BTreeSet<usize>) -> Result<(), String> {
        // Grouped entries draw together at the leader. All of their callouts
        // must still be on that same page after the book has repaginated.
        let drawn: BTreeMap<_, _> = self.cells.iter().copied().collect();
        for (&id, cell) in rows.iter().filter(|(id, cell)| **id == cell.row) {
            let Some(pages) = self.anchors.get(id - 1..id - 1 + cell.count) else {
                return Err("Could not locate the PDF footnote callouts.".into());
            };
            let mut split = false;
            for (offset, pair) in pages.windows(2).enumerate() {
                if pair[0] != pair[1] {
                    breaks.insert(id + offset + 1);
                    split = true;
                }
            }
            let misplaced = pages
                .iter()
                .enumerate()
                .any(|(i, page)| drawn.get(&(id + i)) != Some(page));
            if !split && (misplaced || self.tall.contains(&id)) {
                breaks.insert(id + cell.count / 2);
            }
        }
        Ok(())
    }
}

pub(super) fn initialize(workspace: &Path) -> Result<(), String> {
    fs::write(workspace.join(PLAN_FILE), "null")
        .map_err(|error| format!("Could not initialize PDF footnote rows: {error}"))
}

pub(super) async fn prepare(
    app: &AppHandle,
    workspace: &Path,
    font_dir: &Path,
    fonts: &[PathBuf],
    cancelled: &AtomicBool,
) -> Result<(), String> {
    fit(workspace, |expression| {
        eval_typst(
            app,
            workspace,
            font_dir,
            fonts,
            "chapter.typ",
            expression,
            cancelled,
        )
    })
    .await
}

pub(super) async fn fit<F, Fut>(workspace: &Path, mut evaluate: F) -> Result<(), String>
where
    F: FnMut(&'static str) -> Fut,
    Fut: Future<Output = Result<Vec<u8>, String>>,
{
    let path = workspace.join(PLAN_FILE);
    if !path.is_file() {
        return Ok(());
    }
    initialize(workspace)?;
    let candidates: Vec<Candidate> = serde_json::from_slice(&evaluate(MEASURE).await?)
        .map_err(|_| "Could not read the measured PDF footnotes.")?;
    let mut breaks = BTreeSet::new();
    // Every retry permanently separates at least one adjacent pair. The
    // final render uses this fixed plan, independent of layout introspection.
    loop {
        let rows = pack(&candidates, &breaks);
        let bytes = serde_json::to_vec(&rows).map_err(|error| error.to_string())?;
        fs::write(&path, bytes)
            .map_err(|error| format!("Could not prepare PDF footnote rows: {error}"))?;
        if rows.is_empty() {
            return Ok(());
        }
        let audit: PageAudit = serde_json::from_slice(&evaluate(PAGE_AUDIT).await?)
            .map_err(|_| "Could not verify the pages containing the PDF footnotes.")?;
        let previous = breaks.len();
        audit.split_crossing_rows(&rows, &mut breaks)?;
        if breaks.len() == previous {
            return Ok(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fitting_prefers_the_smallest_group_that_recovers_the_space() {
        let candidates = [
            Candidate {
                first: 1,
                count: 2,
                saved: 600,
            },
            Candidate {
                first: 1,
                count: 3,
                saved: 600,
            },
            Candidate {
                first: 2,
                count: 3,
                saved: 700,
            },
            Candidate {
                first: 4,
                count: 2,
                saved: 450,
            },
        ];
        let mut breaks = BTreeSet::new();
        let rows = pack(&candidates, &breaks);
        assert_eq!(rows[&1], Cell { row: 1, count: 2 });
        assert!(!rows.contains_key(&3));
        assert_eq!(rows[&5], Cell { row: 4, count: 2 });
        let pages = vec![1, 2, 2, 2, 3];
        let audit = PageAudit {
            cells: rows.keys().map(|&id| (id, pages[id - 1])).collect(),
            anchors: pages,
            tall: BTreeSet::new(),
        };
        audit.split_crossing_rows(&rows, &mut breaks).unwrap();
        assert_eq!(breaks, BTreeSet::from([2, 5]));
        let rows = pack(&candidates, &breaks);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[&3], Cell { row: 2, count: 3 });
        assert!(pack(&[], &breaks).is_empty());
    }
}
