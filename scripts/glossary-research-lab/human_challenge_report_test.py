"""Check that uncertain and both-bad cases cannot earn correction credit."""
import unittest
from human_challenge_report import summarize


def case(key, neutral, candidate):
    return {'id': key, 'versions': [{'method': 'no-glossary', 'accuracy': neutral},
                                   {'method': 'meaning-first', 'accuracy': candidate}]}


class CorrectionMetrics(unittest.TestCase):
    def test_confirmed_correction_requires_a_frozen_baseline_error(self):
        baseline = [{'id': 'a', 'confirmedError': True}, {'id': 'b', 'confirmedError': False}]
        comparison = {'rows': [case('a', 'error', 'correct'), case('b', 'error', 'correct')],
                      'events': [{'id': k, 'method': 'meaning-first', 'firstEffect': 1, 'confirmed': True} for k in ['a', 'b']]}
        result = summarize(baseline, comparison, 'meaning-first')
        self.assertEqual(result['confirmedCorrections'], 1)
        self.assertEqual(result['otherConfirmedGains'], 1)

    def test_uncertain_or_unconfirmed_fix_earns_no_credit(self):
        baseline = [{'id': k, 'confirmedError': True} for k in ['a', 'b']]
        comparison = {'rows': [case('a', 'error', 'uncertain'), case('b', 'error', 'correct')],
                      'events': [{'id': 'b', 'method': 'meaning-first', 'firstEffect': 1, 'confirmed': False}]}
        result = summarize(baseline, comparison, 'meaning-first')
        self.assertEqual(result['confirmedCorrections'], 0)
        self.assertEqual(result['unresolvedKnownErrors'], 2)

    def test_both_wrong_is_not_a_success(self):
        baseline = [{'id': 'a', 'confirmedError': True}]
        result = summarize(baseline, {'rows': [case('a', 'error', 'error')], 'events': []}, 'meaning-first')
        self.assertEqual(result['uncorrectedErrors'], 1)
        self.assertEqual(result['allConfirmedNetGains'], 0)

    def test_new_errors_offset_gains(self):
        baseline = [{'id': 'a', 'confirmedError': True}, {'id': 'b', 'confirmedError': False}]
        comparison = {'rows': [case('a', 'error', 'correct'), case('b', 'correct', 'error')],
                      'events': [{'id': 'a', 'method': 'meaning-first', 'firstEffect': 1, 'confirmed': True},
                                 {'id': 'b', 'method': 'meaning-first', 'firstEffect': -1, 'confirmed': True}]}
        result = summarize(baseline, comparison, 'meaning-first')
        self.assertEqual(result['confirmedIntroducedErrors'], 1)
        self.assertEqual(result['allConfirmedNetGains'], 0)


if __name__ == '__main__':
    unittest.main()
