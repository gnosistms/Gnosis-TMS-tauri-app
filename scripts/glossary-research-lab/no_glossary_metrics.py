"""Measure actual translation benefit; acceptable ties never count as success."""
from collections import Counter


def effect(row, dimension='accuracy'):
    value = row[dimension]
    return 0 if value == 'tie' else 1 if value == row['candidateSide'] else -1


def grades(row, dimension='accuracy'):
    candidate = row['candidateSide']
    baseline = 'B' if candidate == 'A' else 'A'
    return row[dimension + candidate], row[dimension + baseline]


def summarize(rows, dimension='accuracy'):
    effects = [effect(row, dimension) for row in rows]
    gains, harms = effects.count(1), effects.count(-1)
    acceptable = {'faithful', 'minor_nuance'} if dimension == 'accuracy' else {'natural', 'minor_style'}
    problem = 'material_error' if dimension == 'accuracy' else 'clear_problem'
    states = Counter()
    for row in rows:
        candidate, baseline = grades(row, dimension)
        if baseline == 'uncertain' or candidate == 'uncertain':
            states['uncertain'] += 1
        elif candidate in acceptable and baseline in acceptable:
            states['both_acceptable'] += 1
        elif candidate == baseline == problem:
            states['both_problematic'] += 1
        elif baseline == problem and candidate in acceptable:
            states['baseline_problem_candidate_acceptable'] += 1
        elif candidate == problem and baseline in acceptable:
            states['candidate_problem_baseline_acceptable'] += 1
    return {
        'passages': len(rows), 'gains': gains, 'harms': harms, 'ties': effects.count(0),
        'net_gain': gains - harms,
        'net_gain_per_100': 100 * (gains - harms) / len(rows) if rows else None,
        'changed_outcomes': gains + harms,
        'gain_share_among_clear_changes': gains / (gains + harms) if gains + harms else None,
        'sample_outcome': 'no_quality_evidence' if not rows else 'positive_net_benefit' if gains > harms else 'net_harm' if harms > gains else 'no_net_benefit_demonstrated',
        # These are independent initial grades, not a ground-truth error inventory.
        # Confirmed direction requires two judges; a disagreement retains its initial grades but becomes a tie.
        'initial_grade_states': dict(states),
        'confirmed_fixes': sum(effect(r, dimension) == 1 and grades(r, dimension)[1] == problem and grades(r, dimension)[0] in acceptable for r in rows),
        'confirmed_introduced_problems': sum(effect(r, dimension) == -1 and grades(r, dimension)[0] == problem and grades(r, dimension)[1] in acceptable for r in rows),
    }


def paired(candidate, reference, dimension='accuracy'):
    a = {r['id']: r for r in candidate}
    b = {r['id']: r for r in reference}
    if len(a) != len(candidate) or len(b) != len(reference):
        raise ValueError('Duplicate passage IDs in paired no-glossary comparisons')
    shared = sorted(a.keys() & b.keys())
    rows = [{'id': key, 'candidate_effect': effect(a[key], dimension), 'reference_effect': effect(b[key], dimension),
             'delta': effect(a[key], dimension) - effect(b[key], dimension),
             'baseline_grade_agrees': grades(a[key], dimension)[1] == grades(b[key], dimension)[1]}
            for key in shared]
    labels = {-1: 'harm', 0: 'tie', 1: 'gain'}
    matrix = Counter(labels[r['candidate_effect']] + '/' + labels[r['reference_effect']] for r in rows)
    net = sum(r['delta'] for r in rows)
    return {'passages': len(rows), 'candidate_unpaired': sorted(a.keys() - b.keys()), 'reference_unpaired': sorted(b.keys() - a.keys()),
            'net_effect_difference': net, 'net_effect_difference_per_100': 100 * net / len(rows) if rows else None,
            'matrix_candidate_reference': dict(matrix), 'baseline_grade_disagreements': sum(not r['baseline_grade_agrees'] for r in rows),
            'rows': rows}
