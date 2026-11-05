"""Validate returned execution metadata against independently reconstructed inputs.

The caller must compute tree_sha from the actual isolated Git index and skill_sha256
from the submitted skill bytes, not from an adjudication flag. This checks saved
artifacts, not a cryptographic service attestation or future deployment guarantee.
"""


def validate_execution(raw, *, base_sha, tree_sha, skill_sha256,
                       expected_skill_sha256, require_skill):
    errors = []
    meta = raw.get('meta', {})
    run = meta.get('run', {})
    snapshot = run.get('snapshot', {})
    if not run.get('id'):
        errors.append('Missing returned execution identity')
    if snapshot.get('base_sha') != base_sha:
        errors.append('Returned base differs from frozen input')
    if snapshot.get('tree_sha') != tree_sha:
        errors.append('Returned tree differs from reconstructed submitted worktree')
    if require_skill and skill_sha256 != expected_skill_sha256:
        errors.append('Submitted skill bytes differ from frozen lens')
    if not require_skill and skill_sha256 is not None:
        errors.append('No-skill control contains the lens')
    if meta.get('analysis', {}).get('mode') != 'full':
        errors.append('Execution is not a fresh full review')
    if meta.get('coverage', {}).get('complete') is not True:
        errors.append('Review coverage is incomplete')
    if raw.get('finding_state', {}).get('complete') is not True:
        errors.append('Finding state is incomplete')
    if meta.get('skipped_files'):
        errors.append('Review omitted files')
    if run.get('effort', {}).get('requested') != 'deep' or run.get('effort', {}).get('effective') != 'extended':
        errors.append('Review depth differs from evaluation contract')
    agents = [agent for review_pass in run.get('passes', []) for agent in review_pass.get('agents', [])]
    skills_completed = any(agent.get('name') == 'skills-agent' and agent.get('status') == 'completed'
                           for agent in agents)
    if require_skill != skills_completed:
        errors.append('Actual skills-component execution does not match arm')
    return errors
