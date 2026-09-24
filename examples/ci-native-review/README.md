# CI-generated deployment review

GitHub Actions renders the development and production Kustomize overlays, preserves the output as a run artifact, and requests a native Qodo review with that output as additional evidence. Qodo publishes its own review; the workflow does not publish findings or change the PR description.

The audit export service has no application authentication and must remain private in production. The default branch keeps both environments on `ClusterIP`. A demo PR changes only the production overlay to `LoadBalancer`, leaving this README, the renderer, and the workflow unchanged. No Kubernetes cluster is contacted and nothing is deployed.

The renderer assigns fresh resource-name suffixes and ports on each CI run. These values are not committed, so findings that cite them demonstrate consumption of generated output. Re-running the job changes this evidence without a source commit and requests another full review.

This is a CI-to-Qodo example, not an Atlantis integration. It does not deploy infrastructure. The final head check and review request are separate API calls, so this advisory example is not an atomic merge gate; the request tells Qodo to reject evidence for another revision.

Requires Qodo installed on the repository, GitHub Actions comment-write permission, and kubectl on the runner. The example is restricted to same-repository PRs authored by the owner. No additional API key is used.

## One review trigger

Make CI the only automatic review trigger so review starts after rendering. Preserve automatic PR descriptions, but disable native review on PR open and push:

```toml
[github_app]
ignore_bot_pr = false
pr_commands = ["/agentic_describe"]
handle_push_trigger = false
push_commands = []
```

These settings live on the default branch and disable automatic PR-open and push reviews repository-wide, including unrelated PRs. CI triggers reviews for the example paths; other changes require an explicit review command. Existing in-flight reviews must finish before starting the demo. Disabling push reviews alone does not disable the PR-open review. Do not issue manual review commands or rerun CI while a review is still running: GitHub workflow concurrency does not cancel a Qodo review already submitted.

## Folded context and optional cleanup

By default the CI trigger stays on the PR with its context inside nested, collapsed sections. A successful CI job means rendering and trigger publication succeeded; confirm the separate **Code Review by Qodo** response before treating review as completed.

To delete only this run's Actions-authored trigger after a fresh, same-commit Qodo review appears, change the workflow's renderer command to:

```sh
python3 examples/ci-native-review/run.py --delete-trigger
```

Cleanup waits up to seven minutes, verifies the comment author and unchanged trigger body, deletes it, and checks that it is gone. It preserves the trigger on a changed PR head or timeout. Qodo findings and other comments are untouched. The original trigger and generated manifests remain in the CI artifact.

Cleanup relies on the single-trigger setup above, not an exact Qodo-operation identifier. Keep the default (no deletion) if manual or overlapping reviews are possible. For another repository, update the workflow's owner allowlist and the script's `QODO_BOT` login.

## Checks

`python3 examples/ci-native-review/run.py --test` checks command quoting, context size, opt-in deletion, and rejection of stale or non-Qodo completion comments.
