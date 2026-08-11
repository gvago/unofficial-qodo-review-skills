# Portal-managed keys: starter map

This map is a STARTER APPROXIMATION built from support history. Which keys
the portal owns varies by deployment version. A deployment-specific list
from the deploy team replaces this file entirely. Any key not matched here
is classified unknown and marked `NEEDS-DEPLOY-TEAM-CONFIRMATION`.

Classification values:

- `portal-managed`: propose removal from `.pr_agent.toml`.
- `toml-only`: keep in the file; the portal has no equivalent.
- Rows tagged `(version-dependent)` moved to the portal in recent
  deployments only; on older on-prem versions they may still be toml-only.
  Treat them as portal-managed but call the tag out in migration notes.

| toml key pattern | classification | portal location or reason |
| --- | --- | --- |
| `pr_reviewer.reasoning_effort` | portal-managed | Portal: Review settings, effort mode |
| `pr_reviewer.extended_mode` | portal-managed | Portal: Review settings, extended mode toggle |
| `pr_reviewer.enable_smart_router` | portal-managed (version-dependent) | Portal: Review settings, smart router |
| `config.smart_router` | portal-managed (version-dependent) | Portal: Review settings, smart router |
| `pr_reviewer.require_score_review` | portal-managed | Portal: Review output, section toggles |
| `pr_reviewer.require_tests_review` | portal-managed | Portal: Review output, section toggles |
| `pr_reviewer.require_estimate_effort_to_review` | portal-managed | Portal: Review output, section toggles |
| `pr_reviewer.require_security_review` | portal-managed | Portal: Review output, section toggles |
| `pr_reviewer.require_ticket_analysis_review` | portal-managed (version-dependent) | Portal: Review output, section toggles |
| `pr_reviewer.num_max_findings` | portal-managed | Portal: Review output, finding count cap |
| `pr_code_suggestions.num_code_suggestions_per_chunk` | portal-managed (version-dependent) | Portal: Suggestions, finding count cap |
| `config.notifications` | portal-managed | Portal: Notifications, defaults |
| `github_app.handle_pr_actions` | portal-managed (version-dependent) | Portal: Notifications, trigger defaults |
| `github_app.pr_commands` | portal-managed (version-dependent) | Portal: Notifications, command defaults |
| `gerrit.notify` | toml-only | Gerrit notify blocks have no portal equivalent |
| `gerrit.*` | toml-only | Gerrit settings blocks stay in the file |
| `config.additional_repos` | toml-only | additional_repos entries stay in the file |
| `config.git_provider` | toml-only | Deployment infrastructure key |
| `config.deployment_type` | toml-only | Deployment infrastructure key |
| `config.custom_model` / model routing keys | toml-only | Deployment infrastructure keys |

Matching rules:

- Match on the full `section.key` path. `gerrit.*` matches every key in any
  `[gerrit...]` section.
- A key that matches no row is unknown, never inferred from similarity to a
  listed row. Mark it `NEEDS-DEPLOY-TEAM-CONFIRMATION`.
