# Unofficial Qodo Review Skills

Community-authored [agent skills](https://code.claude.com/docs/en/skills) shaped for
**Qodo Merge PR review** — the skills agent that discovers `SKILL.md` files in a repo and
emits review findings driven by their rules.

> **Unofficial.** Not affiliated with or endorsed by Qodo. These are community adaptations.

## How Qodo's skills agent uses these

When enabled, the review pipeline scans these directories at a repo root:

```
.qodo/skills/  .claude/skills/  .cursor/skills/  .agents/skills/  skills/
```

For each `SKILL.md` it reads the frontmatter `description`, decides whether the skill is
relevant to the PR diff, and — for the ones that pass — applies the skill body's rules to
the changed code, citing the skill in each finding.

That means a review skill must:

- declare a `description` that reads as a **review lens** (so the relevance filter fires),
- contain **concrete, checkable rules** the agent can point at a diff span for,
- assume **no execution** — the agent sees a unified diff, not a live workspace.

## Available skills

| Skill | Purpose |
|-------|---------|
| [`terraform-review`](skills/terraform-review/SKILL.md) | Flags Terraform/OpenTofu diff issues: identity churn (missing `moved` blocks, `count` index churn), secrets that land in state, unsafe destroy/state ops, version-floor violations, backend antipatterns. Adapted from [antonbabenko/terraform-skill](https://github.com/antonbabenko/terraform-skill) (Apache-2.0). |
| [`apex-review`](skills/apex-review/SKILL.md) | Flags Salesforce Apex/SOQL diff issues: governor-limit killers (SOQL/DML in loops), missing CRUD/FLS & sharing enforcement, SOQL injection, hardcoded IDs, trigger anti-patterns. Rules derived from the [PMD Apex ruleset](https://github.com/pmd/pmd) (BSD-2). For *writing* SF code, see Salesforce's official [sf-skills](https://github.com/forcedotcom/sf-skills). |

## Usage

Drop a skill folder into one of the scanned directories of the repo you want reviewed —
e.g. copy `skills/terraform-review/` into your project's `skills/` (or `.qodo/skills/`).
The Qodo skills agent discovers it on the next review.

```bash
# from the repo you want reviewed
git clone https://github.com/gvago/unofficial-qodo-review-skills /tmp/uqrs
cp -R /tmp/uqrs/skills/terraform-review skills/terraform-review
```

## Attribution

`terraform-review` is a PR-review adaptation of
[**terraform-skill**](https://github.com/antonbabenko/terraform-skill) by
**Anton Babenko** (Apache-2.0). The original is a *coding* skill; this variant flips the
contract and rule framing toward *reviewing a diff*. Reference files under
`skills/terraform-review/references/` are reproduced from the source under the same license.

## License

[Apache License 2.0](LICENSE).
