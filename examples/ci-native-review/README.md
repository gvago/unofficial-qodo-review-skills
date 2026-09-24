# CI-generated deployment review

GitHub Actions renders the development and production Kustomize overlays, preserves the output as a run artifact, and requests a native Qodo review with that output as additional evidence. Qodo publishes its own review; the workflow does not publish findings or change the PR description.

The audit export service has no application authentication and must remain private in production. The production overlay deliberately contains a review-test defect. No Kubernetes cluster is contacted and nothing is deployed.

The renderer assigns fresh resource-name suffixes and ports on each CI run. These values are not committed, so findings that cite them demonstrate consumption of generated output. Re-running the job changes this evidence without a source commit and requests another full review.

This is a CI-to-Qodo example, not an Atlantis integration. It does not deploy infrastructure. The final head check and review request are separate API calls, so this advisory example is not an atomic merge gate; the request tells Qodo to reject evidence for another revision.

Requires Qodo installed on the repository, GitHub Actions comment-write permission, and kubectl on the runner. The example is restricted to same-repository PRs authored by the owner. No additional API key is used.

Local command-format checks: `python3 examples/ci-native-review/run.py --test`.
