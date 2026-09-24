import unittest
from copy import deepcopy
from watch import select_plans, complete_review

HEAD = 'a' * 40
PROJECTS = [('dev', 'infra/dev', 'default'), ('prod', 'infra/prod', 'default')]


def comment(cid, project, body='Plan: 0 to add, 1 to change, 0 to destroy.'):
    name, directory, workspace = project
    return {'id': cid, 'user': {'id': 123}, 'updated_at': f'2026-09-24T10:00:{cid:02d}Z',
            'body': f'<!-- qodo-plan-head:{HEAD} -->\nRan Plan for project: `{name}` dir: `{directory}` workspace: `{workspace}`\n{body}',
            'html_url': f'https://github.com/example/demo/pull/1#issuecomment-{cid}'}


class SelectionTests(unittest.TestCase):
    def test_complete_set_and_new_comment_replaces_only_its_environment(self):
        comments = [comment(1, PROJECTS[0]), comment(2, PROJECTS[1])]
        plans, key = select_plans(comments, HEAD, 123, PROJECTS)
        self.assertEqual([p['id'] for p in plans], [1, 2])
        comments.append(comment(3, PROJECTS[1], 'No changes.'))
        plans, new_key = select_plans(comments, HEAD, 123, PROJECTS)
        self.assertEqual([p['id'] for p in plans], [1, 3])
        self.assertNotEqual(key, new_key)
        self.assertEqual(select_plans(list(reversed(comments)), HEAD, 123, PROJECTS)[1], new_key)

    def test_edited_comment_changes_digest_even_same_timestamp(self):
        comments = [comment(1, PROJECTS[0]), comment(2, PROJECTS[1])]
        key = select_plans(comments, HEAD, 123, PROJECTS)[1]
        comments[1]['body'] += '\nReplacement required.'
        self.assertNotEqual(key, select_plans(comments, HEAD, 123, PROJECTS)[1])

    def test_untrusted_missing_stale_error_or_deleted_plan_never_looks_complete(self):
        good = [comment(1, PROJECTS[0]), comment(2, PROJECTS[1])]
        variants = [good[:1]]
        for field, value in [('user', {'id': 456}), ('body', good[1]['body'].replace(HEAD, 'b'*40)),
                             ('body', good[1]['body']+'\nError: plan failed'), ('body', 'deleted plan')]:
            items = deepcopy(good)
            items[1][field] = value
            variants.append(items)
        variants.append(good + [comment(3, PROJECTS[1], 'Error: newest plan failed')])
        for items in variants:
            with self.subTest(items=items):
                with self.assertRaises(ValueError):
                    select_plans(items, HEAD, 123, PROJECTS)

    def test_no_sha_marker_is_rejected_not_guessed_from_time(self):
        comments = [comment(1, PROJECTS[0]), comment(2, PROJECTS[1])]
        comments[1]['body'] = comments[1]['body'].split('\n', 1)[1]
        with self.assertRaises(ValueError):
            select_plans(comments, HEAD, 123, PROJECTS)

    def test_complete_fresh_result_required(self):
        valid = {'findings': [], 'meta': {'coverage': {'complete': True}, 'analysis': {'mode': 'full'}},
                 'finding_state': {'complete': True}}
        complete_review(valid)
        for path, value in [('coverage', {'complete': False}), ('analysis', {'mode': 'reused'})]:
            result = deepcopy(valid)
            result['meta'][path] = value
            with self.assertRaises(ValueError):
                complete_review(result)
        for result in [{}, {'status': 'running'}, dict(valid, error='failed')]:
            with self.assertRaises(ValueError):
                complete_review(result)


if __name__ == '__main__':
    unittest.main()
