import unittest
from bilingual_origins_report import score_axis


def row(key, accuracy=('correct', 'correct'), term=('fail', 'pass'), natural=('acceptable', 'acceptable'), side='B'):
    before = dict(accuracy=accuracy[0], requiredTerm=term[0], naturalness=natural[0])
    after = dict(accuracy=accuracy[1], requiredTerm=term[1], naturalness=natural[1])
    return dict(id=key, candidateSide=side, A=before if side == 'B' else after, B=after if side == 'B' else before)


class SeparateMetrics(unittest.TestCase):
    def test_spelling_change_does_not_earn_semantic_credit(self):
        first = row('a')
        data = dict(rows=[first], confirmations=[row('a', side='A')])
        baseline = [dict(id='a', grade=first['A'])]
        self.assertEqual(score_axis(baseline, data, 'accuracy')['wins'], 0)
        self.assertEqual(score_axis(baseline, data, 'requiredTerm')['frozenBaselineCorrections'], 1)

    def test_unconfirmed_change_or_confirmation_disagreement_is_unresolved(self):
        first = row('a', accuracy=('material_error', 'correct'))
        baseline = [dict(id='a', grade=first['A'])]
        for checks in [[], [row('a', accuracy=('correct', 'correct'))]]:
            result = score_axis(baseline, dict(rows=[first], confirmations=checks), 'accuracy')
            self.assertEqual((result['wins'], result['unresolved']), (0, 1))

    def test_inapplicable_term_rule_is_no_win(self):
        first = row('a', term=('not_applicable', 'not_applicable'))
        result = score_axis([dict(id='a', grade=first['A'])], dict(rows=[first], confirmations=[]), 'requiredTerm')
        self.assertEqual((result['wins'], result['notApplicable']), (0, 1))

    def test_both_bad_is_no_gain_and_regression_offsets_gain(self):
        rows = [row('a', accuracy=('material_error', 'correct')),
                row('b', accuracy=('correct', 'material_error')), row('c', accuracy=('material_error', 'material_error'))]
        result = score_axis([dict(id=r['id'], grade=r['A']) for r in rows], dict(rows=rows, confirmations=rows[:2]), 'accuracy')
        self.assertEqual((result['wins'], result['losses'], result['net'], result['bothBad']), (1, 1, 0, 1))

    def test_naturalness_change_requires_separate_confirmation(self):
        first = row('a', natural=('clear_problem', 'acceptable'))
        baseline = [dict(id='a', grade=first['A'])]
        pending = score_axis(baseline, dict(rows=[first], confirmations=[]), 'naturalness')
        confirmed = score_axis(baseline, dict(rows=[first], confirmations=[row('a', natural=('clear_problem', 'acceptable'), side='A')]), 'naturalness')
        self.assertEqual((pending['wins'], pending['unresolved']), (0, 1))
        self.assertEqual((confirmed['wins'], confirmed['frozenBaselineCorrections']), (1, 1))


if __name__ == '__main__':
    unittest.main()
