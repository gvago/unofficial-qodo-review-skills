# CI-generated deployment review

GitHub Actions renders the development and production Kustomize overlays, preserves the output as a run artifact, and requests a native Qodo review with that output as additional evidence. Qodo publishes its own review; the workflow does not publish findings or change the PR description.

The audit export service has no application authentication and must remain private in production. The production overlay deliberately contains a review-test defect. No Kubernetes cluster is contacted and nothing is deployed.

This example validates CI output ingestion and native review delivery. It is not an Atlantis integration. Re-running the job generates fresh output and requests another full review at the same commit.

Requires Qodo installed on the repository, GitHub Actions comment-write permission, and kubectl on the runner. The example is restricted to same-repository PRs authored by the owner. No additional API key is used.

Local command-format checks: `python3 examples/ci-native-review/run.py --test`.
