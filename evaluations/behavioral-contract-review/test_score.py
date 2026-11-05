import copy
import unittest
from score import grade


def sample():
    cases = [{'id': 'A', 'group': 'main', 'file': 'workspace/a.py'},
             {'id': 'B', 'group': 'holdout', 'file': 'docs/b.md'}]
    runs = []
    for arm in ('control', 'treatment', 'clean', 'holdout', 'holdout-clean'):
        for repetition in range(1, 2 if arm == 'control' else 4):
            expected = ['A'] if arm in ('control', 'treatment') else ['B'] if arm == 'holdout' else []
            runs.append({'arm': arm, 'repetition': repetition, 'run_id': f'unit-{arm}-{repetition}',
                         'complete': True, 'analysis_mode': 'full', 'skill_sha256': 'unit-digest',
                         'skill_consulted': arm != 'control',
                         'findings': [{'id': f'unit-finding-{arm}-{repetition}', 'case_ids': expected,
                                       'disposition': 'true_positive', 'skill_grounded': arm != 'control',
                                       'location': {'file_path': 'workspace/a.py' if expected == ['A'] else 'docs/b.md'},
                                       'evidence': {'citations': [{'source_type': 'skill', 'source': 'behavioral-contract-review'}]
                                                    if arm != 'control' else []}}]
                                     if expected else []})
    return runs, cases


class GateTests(unittest.TestCase):
    def test_all_cases_detected_three_times_pass(self):
        runs, cases = sample()
        self.assertTrue(grade(runs, cases)['passed'])

    def test_missing_case_blocks_gate(self):
        runs, cases = sample()
        next(r for r in runs if r['arm'] == 'treatment')['findings'] = []
        self.assertFalse(grade(runs, cases)['passed'])

    def test_clean_false_positive_blocks_gate(self):
        runs, cases = sample()
        next(r for r in runs if r['arm'] == 'clean')['findings'] = [
            {'id': 'unit-fp', 'case_ids': [], 'disposition': 'false_positive', 'skill_grounded': True}]
        self.assertFalse(grade(runs, cases)['passed'])

    def test_reused_execution_blocks_gate(self):
        runs, cases = sample()
        runs[1]['run_id'] = runs[2]['run_id']
        self.assertFalse(grade(runs, cases)['passed'])

    def test_missing_repetition_blocks_gate(self):
        runs, cases = sample()
        runs.pop()
        self.assertFalse(grade(runs, cases)['passed'])

    def test_unadjudicated_finding_blocks_gate(self):
        runs, cases = sample()
        runs[1]['findings'][0]['disposition'] = 'unknown'
        self.assertFalse(grade(runs, cases)['passed'])

    def test_missing_attribution_blocks_gate(self):
        runs, cases = sample()
        for run in runs:
            for finding in run['findings']:
                finding['skill_grounded'] = False
                finding['evidence'] = {'citations': []}
        self.assertFalse(grade(runs, cases)['passed'])

    def test_partial_coverage_blocks_gate(self):
        runs, cases = sample()
        runs[1]['complete'] = False
        self.assertFalse(grade(runs, cases)['passed'])

    def test_claimed_attribution_without_citation_blocks_gate(self):
        runs, cases = sample()
        for run in runs:
            if run['arm'] == 'treatment':
                run['findings'][0]['evidence']['citations'] = []
        self.assertFalse(grade(runs, cases)['passed'])

    def test_wrong_case_location_blocks_gate(self):
        runs, cases = sample()
        runs[1]['findings'][0]['location']['file_path'] = 'unrelated.py'
        self.assertFalse(grade(runs, cases)['passed'])

    def test_one_finding_cannot_credit_multiple_cases(self):
        runs, cases = sample()
        runs[1]['findings'][0]['case_ids'] = ['A', 'B']
        self.assertFalse(grade(runs, cases)['passed'])

    def test_empty_ground_truth_blocks_gate(self):
        runs, _ = sample()
        self.assertFalse(grade(runs, [])['passed'])

    def test_duplicate_ground_truth_blocks_gate(self):
        runs, cases = sample()
        cases.append(dict(cases[0]))
        self.assertFalse(grade(runs, cases)['passed'])

    def test_different_skill_revisions_block_gate(self):
        runs, cases = sample()
        runs[1]['skill_sha256'] = 'changed'
        self.assertFalse(grade(runs, cases)['passed'])


if __name__ == '__main__':
    unittest.main()
