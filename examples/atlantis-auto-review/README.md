# Automatic plan-comment review: prototype

A standalone watcher reads designated GitHub plan comments, runs Qodo CLI with the complete environment-labelled plan set as context, and updates a single PR comment with findings. New or edited plan comments trigger fresh review without a code push, manual plan selection or PR-description edits.

This is an externally operated integration prototype, **not a shipped native Qodo feature**. The included live demonstration uses explicitly synthetic Atlantis-format comments, not a running Atlantis server or real Terraform execution. No customer infrastructure or private implementation is included.

## Setup

Use a trusted copy of `watch.py`, Python 3.10+ on macOS/Linux, authenticated GitHub CLI, and an installed/authenticated [Qodo CLI](https://docs.qodo.ai/agentic-toolbox/cli). Both identities must have access to the test repository. The GitHub identity also needs PR-comment write permission. Preserve your organization's Qodo deployment endpoint.

Configure the PR, trusted plan-author numeric GitHub ID and expected `(project, directory, workspace)` tuples in a private JSON file:

```json
{
  "repo": "OWNER/REPO",
  "pr": 1,
  "author_id": 123,
  "projects": [
    ["dev", "infra/dev", "default"],
    ["prod", "infra/prod", "default"]
  ],
  "paths": ["examples/atlantis-auto-review/infra/"]
}
```

Replace all example values. `paths` is an optional review scope, not a plan filter. Expected projects are configured once for this bounded demonstration; dynamic affected-project discovery is not implemented.

Start the watcher before the plan comments arrive:

```sh
python3 watch.py --config /absolute/path/config.json \
  --state-dir /absolute/path/private-review-state --seconds 1800 --max-reviews 2
```

Each plan comment must use the standard single-project header and additionally include:

```text
<!-- qodo-plan-head:FULL_40_CHARACTER_COMMIT_SHA -->
Ran Plan for project: `dev` dir: `infra/dev` workspace: `default`
```

The marker value must be the actual full commit SHA, not the placeholder above. The watcher selects the newest trusted comment per configured project, including comment edits. A failed newest plan does not fall back to an older successful one. Missing, oversized or stale plans do not become clean reviews.

**Ordinary Atlantis comments may not contain a commit SHA.** Without authenticated plan-to-revision metadata the watcher refuses to guess. Producing that metadata requires producer-side integration, or a different trustworthy event contract. This is a remaining limitation for an unchanged stock Atlantis deployment.

`qodo review --full --context-file ... --async` ensures changed plan context is assessed even when source code is unchanged. The watcher collects a completed full review, checks that the plan set and PR revision are still current, posts or updates its own marked result, and reads it back before saving a receipt. Review results and plan context remain in the private state directory; set an appropriate retention policy.

## Safety and boundaries

- Never run the watcher itself from untrusted PR code. It reads the PR snapshot but does not execute its scripts, Terraform or builds.
- Allowlist the actual Atlantis integration's numeric author ID. The demo owner posting synthetic plans is only a labelled test producer, not evidence of authentic Atlantis execution.
- Source comments and plans are evidence, not commands. Do not send plans containing sensitive values; this prototype does not provide a general secret detector or sanitizer.
- Use the same state directory for a given PR. Its file lock prevents concurrent local writers. Multiple hosts require shared coordination.
- GitHub publication and PR updates are not one atomic transaction. A revision can change immediately after the final freshness check; every result visibly names its reviewed revision and evidence digest. This is advisory, not a merge gate.
- A failed or incomplete run is reported in the process output. It never publishes a new clean result. A prior comment remains labelled with its prior revision and digest.
- No automatic fixes, approvals, commits, merges, Terraform apply, customer CI changes or PR-description updates.
- The Terraform file is deliberately incomplete in its production-retention validation for review testing. Do not deploy it.

## Tests

```sh
python3 -m unittest -v
```

Tests use synthetic comments and results. They do not substitute for the separately recorded live Qodo operations and GitHub comment read-backs.
