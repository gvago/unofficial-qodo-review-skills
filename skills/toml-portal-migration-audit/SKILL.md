---
name: toml-portal-migration-audit
description: Use when a repo still has a .pr_agent.toml and Qodo settings are managed in the portal, or when a portal setting change has no effect. Audits every toml key against the portal-managed key map and proposes the exact minimal removal diff so the portal becomes the single source of truth. Run it before touching any Qodo config.
license: Apache-2.0
metadata:
  author: gvago
  variant: workflow
  version: 1.0.0
---

# toml-portal-migration-audit

Qodo settings are migrating from per-repo `.pr_agent.toml` files to the Qodo
portal. A leftover toml key silently overrides the portal value, which
produces the classic confusion: someone changes a setting in the portal and
nothing happens. This workflow audits the toml file, classifies every key,
and proposes a removal diff for the keys the portal now owns. It never
applies anything.

## Boundaries

- Read-only analysis. Never apply the diff, never commit, never push. The
  output is a proposal for the repo owner or deploy team to apply.
- Single file scope: only `.pr_agent.toml` at the repo root on the default
  branch. Do not touch other config files.
- No portal API calls and no portal login. The audit works entirely from the
  local file and the key map.
- The bundled map in `references/portal-managed-keys.md` is a starter
  approximation. Which keys are portal-managed varies by deployment version.
  If the deploy team supplies a deployment-specific key list, it replaces
  the bundled map entirely.
- Never guess a classification. Unknown keys get the fixed marker
  `NEEDS-DEPLOY-TEAM-CONFIRMATION` and go to the Data gaps section.

## Workflow

1. **Locate and parse.** Find `.pr_agent.toml` at the repo root on the
   default branch. Parse every key, including section headers such as
   `[pr_reviewer]` and dotted or array-of-tables sections. Record each key
   with its section, value, and line number. If the file is absent, report
   "nothing to migrate" and stop.
2. **Classify every key.** Match each `section.key` against the map in
   `references/portal-managed-keys.md` (or the deploy team's supplied list,
   which takes full precedence). Three buckets:
   - portal-managed: the portal now owns this setting; propose removal.
   - toml-only: still lives in the file; keep, do not touch.
   - unknown: not in the map; mark `NEEDS-DEPLOY-TEAM-CONFIRMATION` and
     list it in a Data gaps section. Never guess.
3. **Produce the removal diff.** Emit one unified diff against
   `.pr_agent.toml` that removes ONLY the portal-managed keys. Preserve all
   comments, blank lines, ordering, and formatting of the surviving
   content. Remove a section header only when every key inside it is
   removed and no comments would be orphaned. toml-only and unknown keys
   must appear untouched in the diff context.
4. **Emit migration notes.** For each removed key, one short line naming
   where the setting now lives in the portal (portal page or section from
   the map), so whoever applies the diff can verify parity first.
5. **Hand off, do not apply.** Present the diff, the migration notes, and
   the Data gaps section. State explicitly that the diff has not been
   applied and that the repo owner or deploy team applies it after
   confirming portal values match the removed toml values.
6. **Deployment-specific override.** If the user or deploy team provides
   their own portal-managed key list, discard the bundled map and rerun
   classification from step 2 using only their list.

## Output format

- **Summary**: counts per bucket (portal-managed / toml-only / unknown).
- **Removal diff**: unified diff, portal-managed keys only.
- **Migration notes**: one line per removed key, `key -> portal location`.
- **Data gaps**: every unknown key with `NEEDS-DEPLOY-TEAM-CONFIRMATION`,
  plus a reminder that the bundled map is version-dependent and the deploy
  team should confirm before applying.

## Reference

- `references/portal-managed-keys.md`: the starter key map (pattern,
  classification, portal location or reason). Read it before classifying.
