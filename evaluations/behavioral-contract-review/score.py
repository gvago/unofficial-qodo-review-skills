"""Fail-closed scoring of explicitly adjudicated, real review execution receipts.

This scores saved evidence. It neither runs Qodo nor invents verdicts. Unit fixtures
in test_score.py test this gate only and are not review-performance evidence.
"""
import argparse
import json
from pathlib import Path


def grade(runs, cases):
    errors = []
    case_ids = [case.get('id') for case in cases]
    if not cases or any(not value for value in case_ids) or len(set(case_ids)) != len(case_ids):
        errors.append('Ground truth is empty, duplicate or lacks case identity')
    if {case.get('group') for case in cases} != {'main', 'holdout'}:
        errors.append('Ground truth must contain main and holdout populations only')
    populations = {group: {case['id'] for case in cases if case['group'] == group}
                   for group in ('main', 'holdout')}
    required = {(arm, rep) for arm in ('control', 'treatment', 'clean', 'holdout', 'holdout-clean')
                for rep in range(1, 2 if arm == 'control' else 4)}
    observed = [(run.get('arm'), run.get('repetition')) for run in runs]
    if set(observed) != required or len(observed) != len(required):
        errors.append('Missing, duplicate or unexpected arm/repetition')
    for identity in ('run_id', 'operation_id', 'raw_result_sha256'):
        ids = [run.get(identity) for run in runs]
        if any(not item for item in ids) or len(set(ids)) != len(ids):
            errors.append(f'Missing or reused {identity}')
    hashes = {run.get('skill_sha256') for run in runs if run.get('arm') != 'control'}
    if len(hashes) != 1 or None in hashes:
        errors.append('Treatment skill revisions differ or are missing')
    attributed = set()
    rows = []
    case_by_id = {case['id']: case for case in cases}
    for run in runs:
        arm, rep = run.get('arm'), run.get('repetition')
        if run.get('complete') is not True or run.get('analysis_mode') != 'full':
            errors.append(f'{arm}/{rep}: not a complete fresh full review')
        if arm == 'control' and run.get('skill_consulted'):
            errors.append('Control consulted the treatment skill')
        if run.get('skills_component_completed') is not (arm != 'control'):
            errors.append(f'{arm}/{rep}: skills-component completion does not match arm')
        if arm != 'control' and run.get('skill_consulted') is not True:
            errors.append(f'{arm}/{rep}: skill execution not established')
        expected = populations['main'] if arm in ('control', 'treatment') else populations['holdout'] if arm == 'holdout' else set()
        found = set()
        for finding in run.get('findings', []):
            disposition = finding.get('disposition')
            matched = set(finding.get('case_ids', []))
            if disposition == 'true_positive':
                if len(matched) != 1 or not matched <= expected:
                    errors.append(f'{arm}/{rep}: invalid true-positive case mapping')
                for case_id in matched & set(case_by_id):
                    if finding.get('location', {}).get('file_path') != case_by_id[case_id].get('file'):
                        errors.append(f'{arm}/{rep}: credited case has the wrong source location')
                found |= matched
                grounded = any(citation.get('source_type') == 'skill'
                               and citation.get('source') == 'behavioral-contract-review'
                               for citation in finding.get('evidence', {}).get('citations', []))
                if arm in ('treatment', 'holdout'):
                    if grounded:
                        attributed |= matched
            elif disposition in ('false_positive', 'fixture_defect', 'unknown'):
                errors.append(f'{arm}/{rep}: {disposition}: {finding.get("id")}')
            elif disposition != 'out_of_scope':
                errors.append(f'{arm}/{rep}: finding not adjudicated')
            if disposition != 'true_positive' and matched:
                errors.append(f'{arm}/{rep}: non-positive finding claims case credit')
        missing = expected - found
        if missing and arm != 'control':
            errors.append(f'{arm}/{rep}: missed {sorted(missing)}')
        if arm in ('clean', 'holdout-clean') and run.get('findings'):
            errors.append(f'{arm}/{rep}: clean control produced findings')
        rows.append({'arm': arm, 'repetition': rep, 'detected': sorted(found), 'missing': sorted(missing),
                     'findings': len(run.get('findings', []))})
    missing_attribution = (populations['main'] | populations['holdout']) - attributed
    if missing_attribution:
        errors.append(f'No skill-grounded detection for {sorted(missing_attribution)}')
    return {'passed': not errors, 'errors': errors, 'runs': rows,
            'attributed_cases': sorted(attributed), 'scope': 'Finite synthetic fixture suite only'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('receipts', type=Path)
    parser.add_argument('cases', type=Path)
    args = parser.parse_args()
    verdict = grade(json.loads(args.receipts.read_text()), json.loads(args.cases.read_text()))
    print(json.dumps(verdict, indent=2))
    return 0 if verdict['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
