import unittest
from deterministic_names import discover


def evidence():
    return {'term': 'Vornag', 'nearSourceSpellings': {'near': [{'form': 'Vornak'}]},
            'passages': [{'text': 'Un Vornag equivale a 1.234.567 unidades.'}],
            'nearSourcePassages': {'items': [{'text': 'Un Vornak representa 1.234.567 unidades.',
                                            'representative': {'doc_id': 'source-test'}}]},
            'originalPassages': {'book_id': 'test', 'author': 'Test Author', 'title_es': 'Test Book',
                                 'language': 'en', 'items': [{'text': 'A Vornak is a named unit.'}]}}


class NumericNameGuards(unittest.TestCase):
    def test_verified_source_name_is_derived_without_gold(self):
        result = discover(evidence())
        self.assertEqual((result['canonical'], result['author']), ('Vornak', 'Test Author'))

    def test_ambiguous_candidates_are_rejected(self):
        data = evidence()
        data['nearSourceSpellings']['near'].append({'form': 'Vornam'})
        with self.assertRaises(ValueError):
            discover(data)

    def test_same_number_with_wrong_unit_or_same_unit_wrong_number_is_rejected(self):
        for text in ['Un Vornak representa 1.234.567 segundos.', 'Un Vornak representa 1.234.568 unidades.']:
            data = evidence()
            data['nearSourcePassages']['items'][0]['text'] = text
            with self.assertRaises(ValueError):
                discover(data)

    def test_unrelated_edition_and_incidental_number_are_rejected(self):
        data = evidence()
        data['originalPassages']['book_id'] = 'unrelated'
        with self.assertRaises(ValueError):
            discover(data)
        data = evidence()
        data['nearSourcePassages']['items'][0]['text'] = 'Vornak aparece en 1.234.567 unidades.'
        with self.assertRaises(ValueError):
            discover(data)


if __name__ == '__main__':
    unittest.main()
