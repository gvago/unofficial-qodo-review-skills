---
name: qodo-calibrate-rules
description: Calibrate the severity of every active Qodo rule across the workspace as one reviewable, reversible batch — export the active rules, propose a severity per rule from a fixed rubric, let the workspace admin approve or override each row, apply only what was approved, re-read the workspace to confirm it took, and revert the whole run from its receipt if asked — using the qodo CLI's managed rules tools. Use on "calibrate our rule severities", "recalibrate our rules", "recalibrate our review standards", "re-level the rules", "too many rules are errors", "bulk severity review", "which rules should be errors vs warnings", and afterwards on "did the severity changes actually take", "check the workspace matches the receipt", "undo the calibration", "roll back that severity run"; skip changing one rule's severity or any single-rule edit (use qodo-manage-standards), reading or applying rules while coding (use qodo-get-rules), and anything that isn't workspace-wide severity calibration.
owner: Qodo
metadata:
  vendor: qodo
  version: "0.8.0"
  recommended: "false"
  package: "qodo-standards"
  distribution: "skills-sh"
---

# Calibrate Review Standards Severity

## Description

Use the `qodo` CLI to **calibrate** the severity of the workspace's Review Standards as one
reviewable, reversible batch: export every active rule, propose a severity per rule from a fixed
rubric, let the workspace admin approve or override each row, apply only what was approved, and
verify the result. Review Standards is Qodo's umbrella term for rules and suggestions. This skill
is the workspace-wide counterpart to `qodo-manage-standards`: changing one rule's severity ("make
the X rule an error") belongs there; re-levelling many rules at once belongs here. Reading and
applying rules while coding belongs to `qodo-get-rules`.

**This version implements every phase: preflight, rubric, export, classification (delegated to
classifier subagents), the proposal, an optional browser review page, the approval readback, apply
with a resumable receipt, a read-only verify, and a revert of the run from its receipt.** **Apply
and revert are the only writes, and they write only `severity`.**

## Prerequisites

- This skill is installed from its preview repository (skills.sh) and loaded explicitly.
- The Qodo CLI (0.1.0-next.37 or newer) is installed and authenticated.
- Node.js 20 or newer on PATH (the CLI itself needs it; the bundled scripts use built-ins only).
- The user is an admin (`owner` or `admin`) of the workspace whose rules will be calibrated.

## Instructions

Follow the workflow in order: preserve update notices, resolve the executable, pass the
compatibility gate, confirm authentication with provenance stamped on the first call, confirm admin
permission, confirm the tool catalog, then run the rubric, export, classify, propose, approve, and
apply and verify phases and report the outcome (revert only if the admin asks). The provenance
flags (`--skill`, `--skill-version`, `--distribution`) go on the first authenticated call — `qodo
read whoami` — only. Every phase but Apply and Revert is read-only against the workspace; those two
write each row's `severity` and nothing else, and every file lives under
`${QODO_HOME:-$HOME/.qodo}/calibrate/`. Stop at the first failed step with its plain message.

`<skill-dir>` is the directory containing this SKILL.md; its `scripts/` and `references/` folders
ship with the skill. `<launcher>` is the resolved `qodo` executable from the fallback below.

**Context budget.** You, the orchestrator, never read a rule's text. Rule content lives in the
batch files and is read only by classifier subagents, each in its own fresh context; every script
answers you with one short JSON line. Read a reference file only at the phase that names it.

## Handle a skill update notice

A Qodo command can emit `QODO_NOTICE <json>` to stderr while still succeeding. When `code` is
`qodo_skill_update_available`, keep the command's result and finish the current task. Then follow
the notice's `steps`: read-only inventory first, resolve the installed Qodo package and scope, show
the exact lifecycle-owner update command or UI action, and ask once before any mutation. If the
user declines, keep the current version usable. Never invoke a different lifecycle owner, guess a
placeholder, or install an optional package implicitly. After an approved update, ask for the host
restart named by the notice; the current session may still have the old skill loaded.

## Runtime compatibility gate

First resolve the executable using the `qodo: command not found` fallback below. Before any other
Qodo command, run `<qodo> --version` exactly as shown, with no provenance flags. This skill
requires Qodo CLI **0.1.0-next.37 or newer**.

If the version is older or cannot be parsed, do not run `whoami`, `login`, or a managed tool, and
do not describe the failure as an authentication problem. Explain that the skill is newer than the
runtime, show `qodo update` as the update command for the runtime's already-recorded origin, and
ask once before running it. For a customer deployment keep its organization-provided update origin;
never switch to the public service. After an approved update, rerun the unadorned probe and
continue only when it satisfies the minimum. If the user declines or the update fails, stop with
the current skill and user files unchanged.

Compare versions as semver: a prerelease `0.1.0-next.N` orders by N numerically (`next.100` beats
`next.37`), and a stable `0.1.0` counts as newer than any `0.1.0-next.N`.

## Quick start

```
qodo --version                                                      # compatibility probe — run this FIRST
qodo read whoami --json --skill qodo-calibrate-rules --skill-version 0.8.0 --distribution skills-sh
qodo tools --json                                                   # catalog must list rules-update, rules-list, rules-get, rules-metadata
ls "${QODO_HOME:-$HOME/.qodo}/calibrate/runs/"                                      # an interrupted run to resume?
RUN="${QODO_HOME:-$HOME/.qodo}/calibrate/runs/$(date -u +%Y%m%d-%H%M%S)"            # new run id (skip when resuming)
node <skill-dir>/scripts/rubric.mjs --snapshot "$RUN/rubric-snapshot.yaml"          # new run only; creates rubric.yaml on first run
node <skill-dir>/scripts/export-rules.mjs --out "$RUN" --qodo <launcher>            # writes export.json + batches/batch-NNN.{json,txt}
node <skill-dir>/scripts/record-batch.mjs --run "$RUN" --status                       # which batches remain
#   classifier subagents (references/classifier-prompt.md) each run, per batch:
node <skill-dir>/scripts/record-batch.mjs --run "$RUN" --batch N --tags-file <path>   # {"<ruleId>":"<tag>", ...}
node <skill-dir>/scripts/proposal.mjs --run "$RUN" --render --workspace-id <workspace_id>   # writes proposal.md
node <skill-dir>/scripts/stage-review.mjs --run "$RUN"                              # optional: writes review.html; open it in a browser
node <skill-dir>/scripts/approve.mjs --run "$RUN" --readback                        # counts + invalid rows; writes nothing
node <skill-dir>/scripts/approve.mjs --run "$RUN" --record-skips                    # only after the admin says yes
node <skill-dir>/scripts/apply.mjs --run "$RUN" --generate --qodo <launcher>        # writes receipt.md + apply.sh
sh "$RUN/apply.sh"                                                                  # ONE invocation applies the batch
node <skill-dir>/scripts/verify.mjs --run "$RUN" --qodo <launcher>                  # read-only re-read; tokens every applied row
node <skill-dir>/scripts/apply.mjs --run "$RUN" --generate --revert --qodo <launcher>  # only if the admin asks to undo
sh "$RUN/revert.sh"                                                                 # ONE invocation puts the batch back
node <skill-dir>/scripts/ledger.mjs --show                                          # what earlier runs decided
node <skill-dir>/scripts/ledger.mjs --reconsider <ruleId>                           # release a held rule
```

**Windows.** PowerShell run-id line:
`$RUN = Join-Path $qodoHome "calibrate/runs/$((Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss'))"`.
Always pass JSON through `--tags-file`; single-quoted JSON does not survive PowerShell quoting. `apply.sh` and `revert.sh` are POSIX `sh`: run them under Git Bash or WSL.

**`qodo: command not found`?** That's usually PATH, not a missing install: GUI-launched agents run
shells with a minimal PATH. On POSIX, retry `"${QODO_HOME:-$HOME/.qodo}/bin/qodo"`. In Windows
PowerShell, retry:

```powershell
$qodoHome = if ($env:QODO_HOME) { $env:QODO_HOME } else { Join-Path $HOME '.qodo' }
& (Join-Path $qodoHome 'bin/qodo.cmd')
```

Keep using the resolved launcher for every Qodo command, and pass it to the export and apply
scripts as `--qodo`. Only if it is missing is Qodo actually not installed: tell the user to obtain
a checksum-pinned installer from Qodo or their administrator (served from https://get.qodo.ai),
and never invent a digest or pipe an installer into a shell.

**Sandbox auth diagnostic.** In a sandboxed environment, if `qodo read whoami` fails for any
reason (including `Not logged in`), ask the user to approve one exact read-only retry of
`qodo read whoami` outside the sandbox before recommending login or refreshing tools: keychain
failures can be reported as generic auth failures, so the sandboxed result alone is not
diagnostic. That approval covers only this single retry — never reuse it, request persistent
approval, or move later Qodo commands outside the sandbox. If the retry succeeds, continue with
normal per-command permission checks; if it still fails, follow the auth troubleshooting below.

Add `--json` to everything you parse, and **confirm the exact tool names and flags with
`qodo read tools rules [<tool>] --json`** (renders offline from the cached catalog; inspect write
commands with `qodo tools help rules [<tool>] --json`). A stale catalog shows as `unknown
command`/`unknown option` on `rules` while `whoami` succeeds, so run `qodo tools --refresh` and
retry before assuming a tool is gone.

## Preflight

1. **Auth first.** Run `qodo read whoami`. After the sandbox retry above when applicable, tell the
   user to run `qodo login` only when the result explicitly says `Not logged in`, then stop. `No
   tool catalog cached` is a catalog failure, not proof of missing credentials: run
   `qodo tools --refresh` once, then retry `whoami`. If either still fails, report that exact
   failure and stop instead of sending the user through login.
2. **Admin gate.** Read `organization_permission` from the `whoami` JSON and compare it
   case-insensitively. Continue only when it is `owner` or `admin`. For any other value (for
   example `member`), stop before any further Qodo command and tell the user plainly: *"This
   requires admin permission in your workspace — ask an admin to make the change or grant you
   access."* Do not continue to the catalog check, do not retry, and do not treat installation as
   evidence of authority. If the output is not parseable JSON, or `organization_permission` is
   absent or unrecognized, report the exact output and stop — never infer permission. Keep
   `workspace_id` and `organization_permission` for the outcome block; never invent a
   `workspace_id` — if it is absent, the block says "workspace id not reported by whoami".
3. **Catalog check.** Run `qodo tools --json` and confirm `rules-update`, `rules-list`,
   `rules-get`, and `rules-metadata` are listed; this version calls `rules-list` (export) and
   `rules-update` (apply). Take each tool's command path from the catalog's `command` field (and
   `readCommand` for the read tools), not from this file: export runs `<launcher> read rules list
   …` and apply runs `<launcher> rules update …`, so confirm both and pass the tails as
   `--read-args` / `--update-args` if they differ. If a tool is missing, or the `rules` commands
   answer `unknown command`/`unknown option` while `whoami` succeeded, run `qodo read tools rules
   --json` as the diagnostic, then `qodo tools --refresh` once and retry. If it still fails,
   report the exact failure and the diagnostic output and stop.

## Rubric

The rubric — the fixed tag taxonomy, each tag's default severity, the platform-category prior, and
the keyword guard — is documented in `<skill-dir>/references/rubric.md`. The classifier subagents
read it; you do not need to. The admin's editable copy lives at
`${QODO_HOME:-$HOME/.qodo}/calibrate/rubric.yaml` (schema: `version: 1`, `severity_overrides`
tag → severity, `guard_terms_extra` list; nothing else).

1. **Interrupted run?** List `${QODO_HOME:-$HOME/.qodo}/calibrate/runs/`. If it has folders, run
   `node <skill-dir>/scripts/record-batch.mjs --run <newest> --status`: when `batches_remaining`
   is non-empty (or `export.json` is missing), that run is unfinished — tell the user and resume
   it: reuse its folder, **skip step 2** (its `rubric-snapshot.yaml` already pins the rubric the
   recorded batches were classified under), and continue with Export and Classify. A run whose
   `receipt.md` frontmatter has no `apply_exit_code`, or has `apply_exit_code: 3`, resumes at
   Apply instead — read the frontmatter, never count status tokens. Otherwise mint a new run id
   `$(date -u +%Y%m%d-%H%M%S)` (PowerShell: see Quick start) and the folder
   `${QODO_HOME:-$HOME/.qodo}/calibrate/runs/<run-id>/`.
2. **New run only.** Run `node <skill-dir>/scripts/rubric.mjs --snapshot <run-dir>/rubric-snapshot.yaml`
   (it honors `QODO_HOME`). On a first run it copies `<skill-dir>/references/rubric-defaults.yaml`
   to `rubric.yaml` and reports `"created": true` — tell the user the path, that the file is
   theirs to edit, and that the next run picks up edits. If the snapshot already exists the script
   refuses (exit 2): that is a resumed run, skip this step. Never pass `--replace-snapshot`
   yourself — it re-pins a run whose recorded batches were classified under the old rubric.
3. Exit code 2 with a quoted line means the rubric is invalid: the message names the file, line,
   and the valid tags or severities. Show it verbatim and stop until the admin fixes the file.
4. On success it prints `severities`, `guard_terms`, and `snapshot`, having written the merged
   rubric verbatim to `<run-dir>/rubric-snapshot.yaml`. Export and classify both read that
   snapshot, so the run is pinned to the rubric as it was when the run started.

## Export

Run the bundled script — one Bash invocation, read-only against the workspace:

```
node <skill-dir>/scripts/export-rules.mjs --out <run-dir> --qodo <launcher>
```

It requires `<run-dir>/rubric-snapshot.yaml` (guard terms come from it) and runs `<launcher> read
rules list --state active --page-size 100 --page N --json`; if the catalog's `readCommand` for
`rules-list` is anything other than `qodo read rules list`, pass its tail as `--read-args`. It
halves the page size on the runtime's truncation marker, retries once on `MT-RATE-LIMITED`, and
exits 2 with nothing written on any other failure, a count mismatch, a duplicate id, or a
`totalCount` that changes mid-export — report it and stop; do not classify.

On success it prints one JSON line (`totalCount`, `exported`, `pages`, `batches`,
`guard_hit_rules`) and has written `<run-dir>/export.json` (raw rules, never edit it) and, per
batch of 40 rules ordered by `ruleId`, `<run-dir>/batches/batch-NNN.json` (the machine copy
record-batch validates against) and `batch-NNN.txt` — the same rules as plain text, one header
line per rule (`=== <ruleId> | <name> | category= | severity= | guard=`) followed by its full
content. **The `.txt` view is what a classifier reads; nobody writes their own dump.**

If `totalCount` is 0 the script writes an `export.json` with zero rules and no batch files: render
the outcome block saying there is nothing to calibrate and stop. If `export.json` already exists
(a resumed run) the script reports `already_exported`; if it exists but `batches/` is missing or
empty it stops and tells you to remove `export.json` to re-export — ask the user before deleting.

## Classify

Classification is judgment, batch by batch, from the rule's **full content** with its name and
category; the arithmetic is the script's. Each rule gets exactly one taxonomy tag. **You do not
read batch files.** Delegate:

1. Run `node <skill-dir>/scripts/record-batch.mjs --run <run-dir> --status`. It lists
   `batches_done` and `batches_remaining` from `<run-dir>/classification.jsonl`. A re-run in the
   same run folder resumes at the remaining batches.
2. Split `batches_remaining` into groups of **1–2 batches** and spawn one classifier subagent per
   group, using the prompt in `<skill-dir>/references/classifier-prompt.md` with its placeholders
   filled (skill dir, run dir, the group's batch numbers). **Issue every spawn in one message** —
   all the Agent calls as parallel tool calls of a single turn, not one spawn per turn: the prompt
   is the same apart from the batch numbers, and spawning one at a time makes you re-reason the
   whole plan before each call (measured at ~11k output tokens per spawn, ~200k per run). Small
   groups matter for the same reason on the classifier's side: a classifier that carries five
   batches accumulates all of them in its context and costs about twice as much per batch as one
   that carries one. Use a mid-tier model for the classifiers (Sonnet-class): the rubric is a
   fixed lookup with a short "common calls" table, and a stronger model adds cost, not accuracy.
   Each classifier reads `rubric.md` once, then for each of its batches reads `batch-NNN.txt` in
   full and records its tags in one command, inline:
   `node <skill-dir>/scripts/record-batch.mjs --run <run-dir> --batch N --tags '{"<ruleId>":"<tag>", …}'`
   (three tool calls per batch, no intermediate file; `--tags-file` exists for PowerShell). The
   script refuses the batch (exit 2) if any rule is missing, any id is not in the batch, or any
   tag is not in the taxonomy; the classifier fixes the map and records again — nothing was
   written. Recording appends to `classification.jsonl` in one write and readers take the last
   line per rule, so parallel classifiers on different batches never conflict, and `--replace`
   re-records a batch by appending. The classifier's whole reply to you is the script's final
   status line per batch — never rule text.
3. If no subagent facility is available, do the same work yourself, one batch at a time, reading
   `batch-NNN.txt` in full and recording before opening the next — and say so, because the
   session will be long.
4. When every classifier has reported, run `--status` once more: `decrease`, `increase`,
   `unchanged`, and `needs_decision` are disjoint and sum to `rows`; `batches_remaining` must be
   empty. The script derives `proposed` from the snapshot's
   severity for the tag; a guard hit or a `Security`/`Compliance` category vetoes a **decrease**
   into a `needs_decision` row (increases are never vetoed).


## Propose

```
node <skill-dir>/scripts/proposal.mjs --run <run-dir> --render --workspace-id <workspace_id>
```

This writes `<run-dir>/proposal.md`: the diff-only checklist (rule id, name, `current → target`,
guard terms, portal link) grouped by direction × tag, every
rubric-proposed row pre-checked, every needs-a-decision row deferred (`[?]`), the run's rubric snapshot in
the frontmatter, and a footer counting the rules held by a prior decision. The grammar, section
wording, frontmatter, and this phase's error handling are in
`<skill-dir>/references/proposal-format.md` — read it before you explain the file, and never
hand-write or hand-edit a row. Take `<workspace_id>` from `whoami`.

It refuses with exit 2 and writes nothing when the classification is incomplete (it names the
remaining batches) or `proposal.md` already exists. `--replace` overwrites it — ask the admin first, because their edits
are discarded.

Then hand the file to the admin: the path as a clickable link (see **Hand-off paths** under
Guardrails), and that a checked row is approved, clearing the box
(`[ ]`) skips it and is remembered, `[?]` defers it to the next run without recording anything,
editing the value after `→` is an override, and needs-a-decision rows start as `[?]` because a
guard term or the platform category contradicts the decrease. Offer the browser review page
(next step) as the alternative to hand-editing. Either way, ask them to say when they are done,
and do not edit the file for them.

## Review (optional, browser)

After the render succeeds, offer the review page instead of hand-editing `proposal.md`:

> *"proposal.md is ready: [proposal.md](file:///abs/path/to/run-dir/proposal.md). You can edit it directly, or review it in the
> browser — I'll open a page that lets you approve / skip / override each row. When you click
> **Commit decisions**, come back here and I'll continue."*

If they choose the browser:

1. **Stage and open the page.**

   ```
   node <skill-dir>/scripts/stage-review.mjs --run "$RUN"     # writes $RUN/review.html
   open "$RUN/review.html"                                     # macOS; xdg-open on Linux
   ```

   Windows: `Start-Process "$RUN\review.html"` in PowerShell, `start "" "$RUN/review.html"` in Git
   Bash, `wslview "$RUN/review.html"` (or `explorer.exe`) in WSL.

   The script inlines the page and the run's `proposal.md`, `classification.jsonl`, and
   `export.json` into one self-contained `review.html`, so it opens from the file system: no
   server, no port, nothing to stop. It refuses with exit 2 and writes nothing when a run file is
   missing. Optional URL parameters: `?density=comfortable` for taller rows, `?expand=inc,dec` to
   open the increase and decrease groups on load. The page never talks to the network beyond its
   two web fonts. Tell the admin: *"Opened the review page:
   [review.html](file:///abs/path/to/run-dir/review.html). Approve, skip, or override each row,
   then click Commit decisions — I'm waiting for the file and will read it back to you before
   anything is applied."* If `open` fails or is denied, the link is the fallback.

2. **Wait for the hand-off.** *Commit decisions* downloads one file, `proposal.md`: the input file
   with each row's checkbox (`[x]` approve, `[ ]` skip, `[?]` deferred) and, for an override, the
   value after `→` rewritten in the exact row grammar `approve.mjs` reads. Nothing else is
   produced. Poll the browser's download directory for a `proposal*.md` newer than the run's
   render time — the per-shell `$DL` table and both poll loops are in
   `<skill-dir>/references/proposal-format.md` ("Browser hand-off"); read it at this step. Say
   which folder you are watching and that the admin can name a different one; if it does not
   exist, ask instead of waiting. Cap the wait (30 minutes), then fall back to "tell me when you
   are done editing" or "paste the path of the downloaded file".

3. **Adopt the file.** The browser's copy *is* the admin's edited proposal, so it replaces the
   rendered one (`mv "$f" "$RUN/proposal.md"` — the reference has the PowerShell form and the rule
   about leaving other `proposal*.md` files alone). Say: *"Got your decisions from the browser (<a>
   approve · <o> override · <k> skip · <u> deferred). Reading them back now."* Then continue to
   **Approve** exactly as written. The readback is still the gate: the button finalizes the admin's
   *edits*, it does not authorize the apply.

Guardrails for this step:

- The page never talks to the Qodo API; the only mutation path is still `apply.sh` after the
  readback yes.
- Never modify `proposal.md` yourself between adopt and readback. If the readback reports `invalid`
  rows, hand them back to the admin (re-open the page, or let them edit the file).
- Rows the admin left undecided leave the page as `[?]`, i.e. **deferred**: not recorded, proposed
  again next run. Only an explicit skip is remembered; repeat the deferred count in the readback.
- If both a browser copy and a hand-edited run-folder copy exist and differ, ask which one wins.
- Decisions persist in the browser (`localStorage`, keyed by run id), so a refresh loses nothing;
  `review.html` is a snapshot — re-render and stage again if the run files change.

## Approve

```
node <skill-dir>/scripts/approve.mjs --run <run-dir> --readback
```

The readback prints each row's decision (`approve`, `skip`, `defer`, `override`) plus `counts`,
`invalid`, `removed`, and `readback_text`. Deferred rows are neither applied nor recorded.
Show `readback_text` verbatim, name every invalid row by line number and reason and say it is
excluded, mention `removed` rows if any, then ask for explicit confirmation. Nothing is written
at this point.

Only after the admin says yes: `node <skill-dir>/scripts/approve.mjs --run <run-dir> --record-skips`
appends their skipped rows to the decisions ledger, once per run (a second call reports
`already_recorded`). That confirmation, together with the edited file, authorizes the whole apply
loop — continue to Apply. Approvals and overrides go into the ledger after they are applied, not
here.

## Apply

Generate the loop only after the admin's explicit yes, then run it as **one** Bash invocation:

```
node <skill-dir>/scripts/apply.mjs --run <run-dir> --generate --qodo <launcher>
sh "<run-dir>/apply.sh"
```

`--generate` reads the decisions back (from `receipt.md` when it exists, otherwise `proposal.md`),
writes `<run-dir>/receipt.md` — the admin's file plus a status token per row — and writes
`<run-dir>/apply.sh`, one row per approve/override decision in file order. It prints
`rows_to_apply`, the rule ids, `skipped`, `skips_recorded` (it appends those skips to the ledger
itself, deduped per run and rule), and `invalid`. `rows_to_apply: 0` reports `nothing_to_apply`
and writes no script — say nothing was applied. If the catalog's `command` for `rules-update` is
anything other than `qodo rules update`, pass its tail as `--update-args`.

`invalid` rows stay excluded for the **rest of this run** and are re-proposed on the next one, so
name them to the admin *before* they say yes and offer to let them fix the file and read it back —
an invalid override is a severity they asked for and will not get.

Then run `sh "<run-dir>/apply.sh"` — **once, as a single Bash invocation**, path quoted. Never call
`apply.mjs --row` yourself, never loop over the rows as separate tool calls, and never call `qodo
rules update` directly: the one invocation is what makes the admin's single confirmation cover the
batch. Each row runs `qodo rules update --rule-id <id> --severity <target> --json
--idempotency-key calibrate-<run-id>-<rule-id>` and writes nothing else.

The script ends by printing one JSON report: `counts` (applied, failed, deferred, pending, skipped,
invalid), `non_applied` with each row's id, status, and code, `invalid`, `aborted`, and the receipt
path. Exit 0 means every approved row applied; 3 means at least one did not (name each
`non_applied` row by id and code). Report from the JSON, not from the receipt text.

**Resume** by regenerating and re-running the same two commands: rows already `applied` or
`· skipped` are never re-sent, `failed` and `deferred` rows are. The receipt grammar, failure
policy, exit codes, resume rules, and **this phase's error handling** are in
`<skill-dir>/references/receipt-format.md`. Never edit `receipt.md`, `proposal.md`, `apply.sh`, or
`revert.sh` by hand. Then continue to Verify.

## Verify

Run this after every apply, before you report the outcome:

```
node <skill-dir>/scripts/verify.mjs --run <run-dir> --qodo <launcher>
```

Verify is **read-only** and one invocation: it re-reads every active rule with the same paging the
export uses — never a `rules get` per row — and compares each approve/override row's live severity
to what the receipt expects (the row's **target** when the apply state is `applied`, its **current**
otherwise). Each compared row gains `· verified` or `· mismatch(<actual>)`; skipped, `[?]`-deferred
and invalid rows are never read against but are named in `out_of_scope`. An `applied` row is never trusted without this read.

Report `counts.checked`, `counts.verified` and `counts.mismatch`. `status: nothing_to_verify` means
no approved row was left to read back — say that, never "verified 0 of 0". Exit 3 means at least one
mismatch: name each by id, apply state, expected and actual, and say so plainly when one is flagged
`landed_despite_failure`. Every `out_of_scope` row with `changed_by_apply: true` is always listed
and is still at the target with no count covering it — name it and offer a revert; ordinary rows
there stop at 50 (`out_of_scope_omitted` counts the rest), so quote `counts.out_of_scope` for the
total. Exit 2 wrote nothing; re-running is safe.

## Revert

Only when the admin asks to undo the run — never on your own initiative, never as a reflex to a
mismatch. Ask before running the script, then run it as **one** Bash invocation:

```
node <skill-dir>/scripts/apply.mjs --run <run-dir> --generate --revert --qodo <launcher>
sh "<run-dir>/revert.sh"
```

`--generate --revert` reads the receipt (never `proposal.md`) and writes `<run-dir>/revert.sh` with
each row's target set to its **`current`** severity, selecting on the receipt's apply state rather
than the checkbox so a row unchecked after the apply is still put back. It prints `rows_to_revert`,
the rule ids, `already_reverted`, `unchecked_but_changed` and `not_candidates` (each with a reason);
`rows_to_revert: 0` reports `nothing_to_revert` and writes no script. The script is the
apply loop backwards and ends in one JSON report: `counts`, `non_reverted` by id and code, `aborted`,
and `closed_for_apply`. Exit 0 means every candidate is back at `current`; one that would not revert
reads `· failed(revert:<code>)`, re-sent by regenerating.

**Revert writes no ledger entry** — an approval holds a rule only while it sits at the approved
severity, so a reverted rule is re-proposed next run by itself. A revert that put a row back
(`closed_for_apply: true`) leaves the run **closed for apply**: `--generate`, `--row` and
`--write-receipt` without `--revert` refuse; one that reverted nothing leaves apply open, because the
receipt still describes the workspace. The token grammar, the revert selection rule, and both phases'
error handling are in `<skill-dir>/references/receipt-format.md`.

## Decisions ledger

`${QODO_HOME:-$HOME/.qodo}/calibrate/decisions.jsonl` remembers what the admin already decided, so
a second run does not ask twice: `skip` entries after the confirmation, `approve`/`override` for
the rows that actually applied. A rule is held out of the proposal while a skip or override still
matches its content hash, or an approve still matches its current severity; the footer counts
them. `ledger.mjs --show` prints the effective entry per rule; on "reconsider rule 815412" run
`ledger.mjs --reconsider 815412` and re-render with `--replace` (an id with no entry is reported
as nothing to release). Release a rule **before** the admin starts editing, or on the next run:
re-rendering mid-edit with `--replace` discards everything they have changed, so ask first.

## Report the verified outcome

After a read or mutation returns structured results, lead with one compact summary — `Outcome`
(what was found or changed), `Scope` (the workspace and paths involved), `State` (the actual
counts). Use the response's real state and succeeded/matched counts; never turn a successful HTTP
response into a stronger claim. Render it once per user-requested operation, not before the
confirmation gate and not for auth, permission, validation, or transport failures; put rule names,
ids, before/after fields, and skipped items below it. Fill the block from the render output, the
readback, and the apply report:

```
# 🛡️ Qodo Review Standards

**Outcome:** Exported <total_rules> active rules and classified all <rows> against the rubric, then proposed <rows-in-proposal> severity changes (<proposed> pre-checked · <needs_decision> needing a decision · <held_by_prior_decision> held by earlier decisions). Readback: <readback_text>. Applied <counts.applied> of <rows_to_apply> approved rows — <counts.failed> failed · <counts.deferred> deferred · <counts.pending> pending · <counts.skipped> skipped · <counts.invalid> invalid. Recorded <recorded> skips and the applied decisions in the ledger. Verified <counts.verified> of <counts.checked> rows · <counts.mismatch> mismatches.
**Scope:** workspace <workspace_id>; run folder [<run-id>/](file:///abs/path/to/run-dir/) — [proposal.md](file:///abs/path/to/run-dir/proposal.md) · [review.html](file:///abs/path/to/run-dir/review.html) if staged · [receipt.md](file:///abs/path/to/run-dir/receipt.md) · [apply-results.jsonl](file:///abs/path/to/run-dir/apply-results.jsonl) (plus export.json, batches/, rubric-snapshot.yaml, classification.jsonl, apply.sh, revert.sh); rubric [rubric.yaml](file:///abs/path/to/calibrate/rubric.yaml) (created this run | <n> overrides applied); ledger [decisions.jsonl](file:///abs/path/to/calibrate/decisions.jsonl)
**State:** permission <organization_permission>; apply exit code <apply_exit_code>; verify exit code <verify_exit_code> (plus <revert_exit_code> if the run was reverted); current severities before this run: <current_counts.error> error · <current_counts.warning> warning · <current_counts.recommendation> recommendation
---
```

List every non-applied, mismatched, and invalid row by id and code below the block. If the run stops at
classification or at the open checklist, report the counts and the proposal link and say the
decision is still open. For an empty workspace the Outcome line says the export found 0 active
rules and there is nothing to calibrate. Do not render the block when the CLI is missing or too
old, when the user is not logged in, when the admin gate fails, when the catalog check fails after
one refresh, when the rubric is invalid, or when a script exits non-zero for a reason other than a
non-applied row — those stops get the plain message for that step instead.

## Error Handling

Preflight, rubric, export, and classification stops are below. Propose/approve stops are in
`references/proposal-format.md`; apply, verify, and revert stops are in `references/receipt-format.md`.

- **Permission denied (admin required)** — say plainly: *"This requires admin permission in your
  workspace — ask an admin to make the change or grant you access."* Don't retry.
- **Not installed** — both `qodo` and `${QODO_HOME:-$HOME/.qodo}/bin/qodo` are missing. Point the
  user to a checksum-pinned installer from Qodo or their administrator and stop.
- **Runtime too old or unparseable version** — the compatibility gate owns this: explain, offer
  `qodo update` once, re-probe on accept, stop otherwise. Never run `whoami` on an old one.
- **Not logged in** — after the single sandbox diagnostic retry when applicable, tell the user to
  run `qodo login` and stop.
- **Stale catalog** — `unknown command`/`unknown option` on `rules`, or a required tool missing
  from `qodo tools --json`, while `whoami` works: `qodo tools --refresh` once and retry; if it
  still fails, report the exact failure and stop.
- **Invalid rubric** (`rubric.mjs` exit 2 with a quoted line) — quote the message and stop before
  export; never "fix" the admin's rubric yourself. Exit 2 saying the snapshot exists means a
  resumed run: skip the rubric step.
- **Node.js too old** — every script checks for Node 20+ and prints one line; ask the user to
  install a current Node.js.
- **Short or failed export** (`export-rules.mjs` exit 2) — report the counts from stderr and stop;
  no classification. A `totalCount` that changed mid-run means rules were edited during export —
  re-run the script in the same run folder.
- **Rate limited (`MT-RATE-LIMITED`) or upstream down (`MT-UPSTREAM-DOWN`)** — export and verify
  wait 5 s and retry the page once; apply and revert retry the row with backoff, then defer it. For
  any other command, wait and retry by hand once; if still failing, report it and stop.
- **Batch refused** (`record-batch.mjs` exit 2) — the message lists every missing rule or invalid
  tag; the classifier completes the decisions file and records the batch again.
- **A classifier subagent fails or returns without recording** — check `--status`; the batches it
  owned are still in `batches_remaining`. Spawn a fresh classifier for exactly those batches. Never
  read the batch yourself to "finish it quickly" unless no subagent facility exists.

## Guardrails

- **`severity` is the only field written.** Never state, scope, content, examples, name, or
  category; never `rules-bulk`, `rules-set-state`, `rules-set-scope`, or `rules-create`. Every
  phase before Apply is read-only. Under `${QODO_HOME:-$HOME/.qodo}/calibrate/` it writes
  `rubric.yaml` (first run only), `decisions.jsonl` (the ledger), and `runs/<run-id>/`
  (`export.json`, `batches/`, `rubric-snapshot.yaml`,
  `classification.jsonl`, `proposal.md`, `review.html` (the staged browser page), `receipt.md`,
  `apply.sh`, `revert.sh`, `apply-results.jsonl`) — plus the CLI's own catalog cache. Write nothing into the skill install
  directory or a repository.
- **Nothing is written before the admin's explicit yes.** The readback writes nothing, and no
  `apply.sh` is generated or run before the confirmation. Never edit their `proposal.md`,
  `receipt.md`, or `apply.sh`, and never `--replace` a proposal without asking.
- **The apply and revert loops are one Bash invocation each.** `sh "<run-dir>/apply.sh"` or `sh
  "<run-dir>/revert.sh"` and nothing else — never `apply.mjs --row` by hand, never a per-row tool
  call, never `qodo rules update` directly. Verify is one invocation too, and never per rule.
- **Revert only on request.** Generating `revert.sh` is harmless; running it writes to every
  candidate row, so ask first — a mismatch is to report, not a reason to undo the admin's run.
- **Never fabricate a rule id, scope, or example.** Resolve or ask; an empty result from `list`
  is a valid outcome, not an error.
- **Classify from the full content, in a fresh context.** Classifiers tag from the whole rule
  text, never from the name alone, never skipping a batch because it is long. The
  orchestrator never loads rule text; it reads status lines.
- **Hand-off paths are clickable links.** Every file the admin has to open or find —
  `proposal.md`, `review.html`, `receipt.md`, the run folder, the rubric, the ledger — is
  presented as a markdown link with the **absolute** path resolved (`$HOME` expanded, never `~`,
  never `$RUN` or `<run-dir>` left literal): `[proposal.md](file:///home/user/.qodo/calibrate/runs/20260101-120000/proposal.md)`.
  Terminals and editors render `file://` links as clickable; a tilde path or a bare code span is
  not. Put the plain absolute path in a code block beneath the link only when the admin also
  needs to paste it into a shell.
- **Tell the user which outcome actually happened** — active rule vs. pending suggestion,
  matched vs. succeeded count from a bulk call — don't assume success from a 200 response alone.
- **Documented departure.** The admin's edited checklist plus a confirmed readback of its counts
  authorize the whole apply loop, instead of a confirmation before every write. This is a
  deliberate, documented departure from `qodo-manage-standards`'s confirm-before-every-write
  guardrail. It is limited to the apply step, writes exactly one field, and records a per-row
  receipt that a verify checks and a revert undoes.

Lead with the bottom line — what was applied, what the admin decided, or what stopped the run and
why — then the specifics. A short, accurate status beats a wall of JSON.
