//! Fit native footnotes with the actual Typst fonts and page geometry, then
//! verify their anchors after the more compact layout repaginates the book.
use super::{eval_typst, AppHandle, AtomicBool, Path, PathBuf};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::{fs, future::Future};

const PLAN_FILE: &str = "qr-rows.json";
pub(super) const IMPORT: &str = r#"#import "qr-footnotes.typ": packable-note as gnosis-qr-note, entry-rule, callout-rule
#let gnosis-qr-rows = json("qr-rows.json")
#set footnote.entry(gap: gnosis-footnote-gap)
#show footnote.entry: it => entry-rule(it, gnosis-qr-rows, gnosis-footnote-gap)
#show footnote: it => callout-rule(it, gnosis-qr-rows)
"#;
const MEASURE: &str = "query(<gnosis-qr-measure>).map(m => m.value)";
const PAGE_AUDIT: &str = "(anchors: query(footnote).map(n => n.location().page()), cells: query(<gnosis-qr-cell>).map(c => (c.value, c.location().page())))";

#[derive(Deserialize)]
struct Measure {
    id: usize,
    span: usize,
    capacity: usize,
    height: f64,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Cell {
    row: usize,
    column: usize,
    span: usize,
    height: f64,
}

type Rows = BTreeMap<usize, Cell>;

// A gap in the measured note numbers represents a plain, multi-link, or long
// note. Only consecutive entries that fit in the same row get placements.
fn pack(measures: &[Measure], breaks: &BTreeSet<usize>) -> Rows {
    let mut rows = Rows::new();
    let mut index = 0;
    while index < measures.len() {
        let first = &measures[index];
        let mut end = index + 1;
        let mut used = first.span;
        let mut height = first.height;
        while let Some(next) = measures.get(end) {
            if next.id != measures[end - 1].id + 1
                || breaks.contains(&next.id)
                || next.capacity != first.capacity
                || used + next.span > first.capacity
            {
                break;
            }
            used += next.span;
            height = height.max(next.height);
            end += 1;
        }
        if end > index + 1 {
            let mut column = 0;
            for note in &measures[index..end] {
                rows.insert(
                    note.id,
                    Cell {
                        row: first.id,
                        column,
                        span: note.span,
                        height,
                    },
                );
                column += note.span;
            }
        }
        index = end;
    }
    rows
}

#[derive(Deserialize)]
struct PageAudit {
    anchors: Vec<usize>,
    cells: Vec<(usize, usize)>,
}

impl PageAudit {
    fn split_crossing_rows(&self, rows: &Rows, breaks: &mut BTreeSet<usize>) -> Result<(), String> {
        // Each compact cell is rendered inside its own native entry. Check the
        // page of the drawn cell as well as the page of the callout.
        let drawn: BTreeMap<_, _> = self.cells.iter().copied().collect();
        for (&id, cell) in rows.iter().filter(|(id, cell)| **id != cell.row) {
            let Some(pages) = self.anchors.get(cell.row - 1..id) else {
                return Err("Could not locate the PDF footnote callouts.".into());
            };
            if pages[pages.len() - 2] != pages[pages.len() - 1]
                || drawn.get(&cell.row) != pages.first()
                || drawn.get(&id) != pages.last()
            {
                breaks.insert(id);
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
    let mut measures: Vec<Measure> = serde_json::from_slice(&evaluate(MEASURE).await?)
        .map_err(|_| "Could not read the measured PDF footnotes.")?;
    measures.sort_unstable_by_key(|m| m.id);
    let mut breaks = BTreeSet::new();
    // Every retry permanently separates at least one adjacent pair. The
    // final render uses this fixed plan, independent of layout introspection.
    loop {
        let rows = pack(&measures, &breaks);
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
    fn rows_keep_order_respect_barriers_and_repack_after_page_breaks() {
        let measures: Vec<_> = [2, 1, 1, 1, 2, 2, 1, 1]
            .into_iter()
            .zip([1, 2, 3, 4, 5, 7, 8, 9])
            .map(|(span, id)| Measure {
                id,
                span,
                capacity: 4,
                height: id as f64,
            })
            .collect();
        let mut breaks = BTreeSet::new();
        let rows = pack(&measures, &breaks);
        assert_eq!(
            (rows[&3].row, rows[&3].column, rows[&3].height),
            (1, 3, 3.0)
        );
        assert_eq!((rows[&5].row, rows[&5].column), (4, 1));
        assert_eq!((rows[&9].row, rows[&9].column), (7, 3));
        let pages = vec![1, 1, 2, 2, 2, 2, 2, 2, 2];
        let audit = PageAudit {
            cells: rows.keys().map(|&id| (id, pages[id - 1])).collect(),
            anchors: pages,
        };
        audit.split_crossing_rows(&rows, &mut breaks).unwrap();
        assert_eq!(breaks, BTreeSet::from([3]));
        let rows = pack(&measures, &breaks);
        assert_eq!((rows[&5].row, rows[&5].column), (3, 2));
    }
}
