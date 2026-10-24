import unittest
from no_glossary_metrics import summarize, paired


def row(key, result, candidate='A', a='faithful', b='faithful'):
    return dict(id=key, accuracy=result, candidateSide=candidate, accuracyA=a, accuracyB=b)


class TranslationBenefitTest(unittest.TestCase):
    def test_acceptable_ties_do_not_establish_success(self):
        result = summarize([row('1', 'tie'), row('2', 'tie')])
        self.assertEqual(result['net_gain'], 0)
        self.assertEqual(result['sample_outcome'], 'no_net_benefit_demonstrated')

    def test_unfixed_shared_errors_do_not_establish_success(self):
        result = summarize([row('1', 'tie', a='material_error', b='material_error')])
        self.assertEqual(result['initial_grade_states']['both_problematic'], 1)
        self.assertEqual(result['gains'], 0)

    def test_harms_offset_gains_and_side_randomization_is_respected(self):
        result = summarize([row('1', 'B', candidate='B', a='material_error'), row('2', 'B', a='material_error')])
        self.assertEqual((result['gains'], result['harms'], result['net_gain']), (1, 1, 0))
        self.assertEqual(result['confirmed_fixes'], 1)
        self.assertEqual(result['confirmed_introduced_problems'], 1)

    def test_pair_by_source_not_array_order_or_unmatched_totals(self):
        a = [row('1', 'A', b='material_error'), row('2', 'tie'), row('unpaired', 'A', b='material_error')]
        b = [row('2', 'B', b='material_error'), row('1', 'A', b='material_error')]
        result = paired(a, b)
        self.assertEqual(result['passages'], 2)
        self.assertEqual(result['candidate_unpaired'], ['unpaired'])
        self.assertEqual(result['net_effect_difference'], 1)
        self.assertEqual(result['matrix_candidate_reference'], {'gain/gain': 1, 'tie/harm': 1})

    def test_duplicate_ids_are_rejected(self):
        with self.assertRaises(ValueError):
            paired([row('1', 'tie'), row('1', 'tie')], [])


if __name__ == '__main__':
    unittest.main()
