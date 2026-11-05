import copy
import unittest
from provenance import validate_execution


def sample():
    return {'findings': [], 'finding_state': {'complete': True}, 'meta': {
        'analysis': {'mode': 'full'}, 'coverage': {'complete': True}, 'skipped_files': [],
        'run': {'id': 'unit-run', 'effort': {'requested': 'deep', 'effective': 'extended'},
                'snapshot': {'base_sha': 'base', 'tree_sha': 'tree'},
                'passes': [{'kind': 'primary', 'agents': [
                    {'name': 'issue-review-agent-unit', 'status': 'completed'},
                    {'name': 'skills-agent', 'status': 'completed'}]}]}}}


class ProvenanceTests(unittest.TestCase):
    def verify(self, raw, **overrides):
        expected = dict(base_sha='base', tree_sha='tree', skill_sha256='skill',
                        expected_skill_sha256='skill', require_skill=True)
        expected.update(overrides)
        return validate_execution(raw, **expected)

    def test_matching_execution_passes(self):
        self.assertEqual(self.verify(sample()), [])

    def test_changed_tree_fails(self):
        self.assertTrue(self.verify(sample(), tree_sha='other'))

    def test_changed_skill_bytes_fail(self):
        self.assertTrue(self.verify(sample(), skill_sha256='other'))

    def test_reused_mode_fails(self):
        raw = sample()
        raw['meta']['analysis']['mode'] = 'reused'
        self.assertTrue(self.verify(raw))

    def test_skipped_skill_cannot_pass_as_execution(self):
        raw = sample()
        raw['meta']['run']['passes'][0]['agents'][1]['status'] = 'skipped'
        self.assertTrue(self.verify(raw))

    def test_incomplete_finding_state_fails(self):
        raw = sample()
        raw['finding_state']['complete'] = False
        self.assertTrue(self.verify(raw))

    def test_wrong_base_fails(self):
        self.assertTrue(self.verify(sample(), base_sha='other'))

    def test_control_must_not_execute_skills(self):
        self.assertTrue(self.verify(sample(), require_skill=False))


    def test_missing_or_empty_control_passes_fail(self):
        for passes in (None, [], [{'kind': 'primary', 'agents': []}]):
            with self.subTest(passes=passes):
                raw = sample()
                if passes is None:
                    del raw['meta']['run']['passes']
                else:
                    raw['meta']['run']['passes'] = passes
                self.assertTrue(self.verify(raw, require_skill=False, skill_sha256=None))

    def test_incomplete_primary_issue_reviewer_fails(self):
        raw = sample()
        raw['meta']['run']['passes'][0]['agents'][0]['status'] = 'skipped'
        self.assertTrue(self.verify(raw))

    def test_completed_issue_only_control_passes(self):
        raw = sample()
        raw['meta']['run']['passes'][0]['agents'].pop()
        self.assertEqual(self.verify(raw, require_skill=False, skill_sha256=None), [])


if __name__ == '__main__':
    unittest.main()
