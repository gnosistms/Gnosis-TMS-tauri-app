use super::*;
use std::sync::atomic::AtomicUsize;

pub(super) fn batches(
    groups: &[Vec<usize>],
    notes: &[Occurrence],
    known: &BTreeMap<String, Verdict>,
) -> Vec<Vec<usize>> {
    let mut result = Vec::new();
    let mut members = BTreeSet::new();
    let mut bytes = 0;
    for group in groups {
        for edge in group.windows(2) {
            if known.contains_key(&pair_key(&notes[edge[0]], &notes[edge[1]])) {
                continue;
            }
            let missing = edge
                .iter()
                .filter(|id| !members.contains(*id))
                .copied()
                .collect::<Vec<_>>();
            let size = missing
                .iter()
                .map(|&id| notes[id].text.len() + notes[id].context.len())
                .sum::<usize>();
            if !members.is_empty() && (members.len() + missing.len() > 24 || bytes + size > 150_000)
            {
                result.push(std::mem::take(&mut members).into_iter().collect());
                bytes = 0;
            }
            for &id in edge {
                if members.insert(id) {
                    bytes += notes[id].text.len() + notes[id].context.len();
                }
            }
        }
    }
    if !members.is_empty() {
        result.push(members.into_iter().collect());
    }
    result
}

pub(super) fn restrict_partition(
    mut verdicts: BTreeMap<(usize, usize), Verdict>,
    groups: &[Vec<usize>],
) -> Result<BTreeMap<(usize, usize), Verdict>, String> {
    let membership = groups
        .iter()
        .enumerate()
        .flat_map(|(group, ids)| ids.iter().map(move |&id| (id, group)))
        .collect::<BTreeMap<_, _>>();
    let same_group =
        |a: &usize, b: &usize| membership.contains_key(a) && membership.get(a) == membership.get(b);
    if verdicts
        .iter()
        .any(|((a, b), verdict)| verdict.equivalent && !same_group(a, b))
    {
        return Err(
            "AI mixed unrelated footnote candidate groups. The affected notes remain included."
                .into(),
        );
    }
    verdicts.retain(|(a, b), _| same_group(a, b));
    Ok(verdicts)
}

// Independent bounded batches can run together; cache writes stay on the caller.
// Never hold a cache lock inside provider threads or launch a thread per pair.
pub(super) fn run_batches<T: Send>(
    batches: &[Vec<usize>],
    cancel: &AtomicBool,
    compare: impl Fn(&[usize]) -> Result<T, String> + Sync,
    mut accept: impl FnMut(Result<T, String>) -> Result<(), String>,
) -> Result<(), String> {
    let next = AtomicUsize::new(0);
    let failed = AtomicBool::new(false);
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::scope(|scope| {
        for _ in 0..batches.len().min(4) {
            let (sender, next, failed, compare) = (sender.clone(), &next, &failed, &compare);
            scope.spawn(move || loop {
                if cancel.load(AtomicOrdering::Acquire) || failed.load(AtomicOrdering::Acquire) {
                    break;
                }
                let index = next.fetch_add(1, AtomicOrdering::AcqRel);
                let Some(batch) = batches.get(index) else {
                    break;
                };
                let result = compare(batch);
                if result.is_err() {
                    failed.store(true, AtomicOrdering::Release);
                }
                if sender.send(result).is_err() {
                    break;
                }
            });
        }
        drop(sender);
        for result in receiver {
            if cancel.load(AtomicOrdering::Acquire) {
                return Err("Book review cancelled.".into());
            }
            accept(result)?;
        }
        if cancel.load(AtomicOrdering::Acquire) {
            Err("Book review cancelled.".into())
        } else {
            Ok(())
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn semantic_results_cannot_merge_separate_neighbor_chains() {
        let verdicts = BTreeMap::from([(
            (0, 1),
            Verdict {
                equivalent: true,
                anchor: "term".into(),
            },
        )]);
        assert!(restrict_partition(verdicts.clone(), &[vec![0, 1]]).is_ok());
        assert!(restrict_partition(verdicts, &[vec![0, 2], vec![1, 3]]).is_err());
    }
    #[test]
    fn provider_batches_run_concurrently_with_a_bound_of_four() {
        let batches = (0..8).map(|n| vec![n]).collect::<Vec<_>>();
        let active = AtomicUsize::new(0);
        let peak = AtomicUsize::new(0);
        let barrier = std::sync::Barrier::new(4);
        let mut accepted = Vec::new();
        run_batches(
            &batches,
            &AtomicBool::new(false),
            |batch| {
                let running = active.fetch_add(1, AtomicOrdering::AcqRel) + 1;
                peak.fetch_max(running, AtomicOrdering::AcqRel);
                barrier.wait();
                active.fetch_sub(1, AtomicOrdering::AcqRel);
                Ok(batch[0])
            },
            |result| {
                accepted.push(result?);
                Ok(())
            },
        )
        .expect("batches");
        accepted.sort();
        assert_eq!(accepted, (0..8).collect::<Vec<_>>());
        assert_eq!(peak.load(AtomicOrdering::Acquire), 4);
    }
    #[test]
    fn cancelled_batches_never_dispatch_provider_calls() {
        run_batches(
            &[vec![0, 1]],
            &AtomicBool::new(true),
            |_| -> Result<(), String> { panic!("cancelled provider call") },
            |_| panic!("cancelled result"),
        )
        .expect_err("cancelled run");
    }
}
