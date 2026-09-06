# proposal.md, the readback, and the decisions ledger

The authoritative format for the proposal checklist the admin edits, how it is read back, and
how a decision is remembered. `scripts/lib/proposal-lib.mjs` and `scripts/lib/ledger-lib.mjs`
are the code encoding of this file; the scripts render and parse it so nothing here is written
or read by hand.

## Row grammar

```
- [x|space|?] <rule_id> · <name> · <current> → <target> · [guard: <terms> ·] <url>
```

- The fields are separated by ` · ` (space, U+00B7, space). ` → ` separates current from target.
- `[x]` means approve the row; `[ ]` means skip it; `[?]` means defer it — no decision this run,
  nothing recorded, proposed again next run. Editing the token after `→` is an override.
- `<target>` is the row's proposed severity: the rubric's severity for the rule's tag. On a
  needs-a-decision row it is `rubric_proposed` — the severity the veto took away — so checking
  the row approves that value.
- `guard: <terms>` appears only when the rule matched the keyword guard. Multiple hits are
  comma-joined (`guard: auth, personal data`).
- `<url>` is the rule's `url` from the export, or `https://app.qodo.ai/rules/<ruleId>`.

Parsing is right-anchored: only the checkbox state, the rule id, and the target are decisions, and the
name in the middle is opaque. An edited or odd name never shifts a field.

## Sections

One section per (direction, tag) pair that has rows — decreases first, then increases, taxonomy
order within a direction, rows by numeric id — then the needs-a-decision section. Headings are
fixed, and pre-checked and deferred rows never share a section:

```
## Decrease → <target> · <tag> (N) — pre-checked; uncheck to skip, [?] to defer
## Increase → <target> · <tag> (N) — pre-checked; uncheck to skip, [?] to defer
## Needs a decision — guard or category conflict (N) — deferred; check to approve, clear to skip
```

A rule whose severity the rubric leaves alone never appears: the proposal is a diff. The file
ends with `---` and the footer, always rendered:

```
Held by prior decision: N rules (say "reconsider rule <id>" to release one)
```

## Frontmatter

```
---
run_id: 20260101-120000
workspace_id: <uuid>
rule_count: 442          # rules classified in this run
proposed: 156            # pre-checked rows
held_by_prior_decision: 12
rubric: |                # the run's rubric snapshot, verbatim
  version: 1
  ...
---
```

## Readback

`approve.mjs --readback` parses the edited file and prints the decision for every row, the
invalid rows, and this line:

```
112 approve · 41 skip · 6 deferred · 3 override · 2 invalid override (rows 87, 140: "critical" is not a severity)
```

- `[x]` with the rendered target → `approve`; `[x]` with another valid severity → `override`;
  `[ ]` → `skip`; `[?]` → `defer`. On an unchecked or deferred row the target token is ignored
  entirely, however the value was edited. Needs-a-decision rows render as `[?]`, so a row the admin
  never touched is deferred, not skipped: a skip is always something the admin did on purpose.
  Deferred rows are excluded from every ledger write and from `apply.sh`, and the next run
  proposes them again.
- Invalid, listed by line number with the reason and excluded from every count of decisions:
  - a target that is not `error`/`warning`/`recommendation`;
  - a target equal to the rule's current severity (a no-op override);
  - an unparseable row (a separator or the checkbox is gone);
  - a duplicate rule id — every occurrence is excluded, because which one the admin meant is a
    guess;
  - a row for a rule this run did not propose — unchanged, held by a prior decision, or an id
    that is not in the run at all (`rule <id> was not proposed in this run`);
  - an edited `current` severity, which means the row no longer describes the rule it names.
  The readback line reports all of these under one `invalid override` count, with the rows and
  reasons in the parenthetical.
- Rows deleted from the file are reported separately as `removed`.
- The frontmatter must be present, terminated, and carry the run folder's `run_id`, or the
  readback refuses — a proposal is rendered, never hand-written.
- The rule's current severity is compared against the classification, not the grammar, so a rule
  sitting at a severity this skill does not know (recorded as needs-a-decision) still renders as
  `critical → warning` and can be approved.

## Decisions ledger

`${QODO_HOME:-$HOME/.qodo}/calibrate/decisions.jsonl`, one object per line, appended:

```json
{"rule_id":815399,"decision":"skip","severity_at_decision":"error","content_hash":"sha256:…","run_id":"20260101-120000","decided_at":"2026-01-01T12:31:02.000Z"}
```

- `decision` ∈ `approve | skip | override | released`. The latest entry for a rule wins. A
  deferred row never writes an entry.
- `content_hash` is `sha256:<hex>` of the rule's raw `content`.
- `severity_at_decision` is the severity the admin decided on: the target for an approve or
  override, the current severity for a skip.
- **Held out of the next proposal:** a `skip` or `override` while the rule's content hash still
  matches, and an `approve` while the rule still sits at `severity_at_decision`. A `released`
  entry never holds. The footer count is the number of rows that would otherwise have rendered.
- `ledger.mjs --reconsider <id> …` appends a `released` entry for each id that has one, so the
  next proposal includes the rule again. An id with no entry is reported, not written. Release
  before the admin edits the checklist, or on the next run: re-rendering mid-edit needs
  `--replace`, which discards their edits.
- Recording is per (run, rule): confirming again after the admin unchecks another row appends
  only the new row, and confirming an unchanged file appends nothing.
- **When each entry is written:** `skip` entries when the admin confirms the readback
  (`approve.mjs --record-skips`); `approve` and `override` entries only for rows that actually
  applied (`apply.mjs --write-receipt`), so a failed, deferred, or pending row is proposed again.
  See `receipt-format.md`.
- `ledger.mjs --show [<id> …]` prints the effective (latest) entry per rule.
- A blank or corrupt line is skipped with a warning: a half-written line never locks the admin
  out of their own decisions.

## Classification file

`<run-dir>/classification.jsonl` is append-only: one JSON object per line, one line per rule per
recording, with `rule_id`, `name`, `category`, `current`, `tag`, `rubric_proposed`, `proposed`,
`direction`, `guard_hits`, `needs_decision`, `batch`, and `recorded_at`. A batch is
appended in a single write, and every reader takes the **last** line per `rule_id`, so parallel
classifiers recording different batches never conflict and `--replace` is simply another append.
A blank or unreadable line is skipped with a warning; a line without a `rule_id` is refused. A
legacy `classification.json` (a JSON array, from 0.4.0 and earlier) is still read first when it
is present, so an older run folder resumes.

## Error handling — propose and approve

- **Render refused** (`proposal.mjs --render` exit 2) — an incomplete classification (finish the
  named batches) or an existing `proposal.md` (ask the admin before `--replace`). Nothing was written; never work
  around it by writing the file yourself.
- **Readback refused** (`approve.mjs` exit 2) — no `proposal.md` yet, or its frontmatter `run_id`
  belongs to another run. Point at the right run folder; never edit the frontmatter to match.
- **Invalid or removed rows in the readback** (exit 0) — not a failure: report them by line number
  with the reason, say they are excluded, and let the admin fix the file and read it back again.

## Browser hand-off — resolving the download folder

*Commit decisions* on `review.html` downloads one `proposal.md`. Poll for a `proposal*.md` newer
than the run's render time — the **glob**, not the bare name: a browser renames a repeat download
to `proposal (1).md`. `$HOME/Downloads` is only right on macOS and Linux:

| Shell | `$DL` |
|---|---|
| macOS / Linux | `$HOME/Downloads` |
| Git Bash | `$USERPROFILE/Downloads` (Git Bash's `$HOME` is not the Windows profile) |
| WSL | `$(wslpath "$(cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null \| tr -d '\r')")/Downloads` |
| PowerShell | the registry value below (honors a relocated Downloads folder) |

POSIX (macOS, Linux, Git Bash, WSL):

```
# find, not a glob: zsh aborts an unmatched glob with "no matches found" before ls runs, so 2>/dev/null can't silence it
newest() { find "$DL" -maxdepth 1 -name 'proposal*.md' -newer "$RUN/proposal.md" 2>/dev/null | head -1; }
until f=$(newest) && [ -n "$f" ]; do sleep 2; done
```

PowerShell:

```powershell
$DL = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders').'{374DE290-123F-4565-9164-39C4925E467B}'
$DL = [Environment]::ExpandEnvironmentVariables($DL)
$rendered = (Get-Item "$RUN\proposal.md").LastWriteTimeUtc
do { Start-Sleep 2; $f = Get-ChildItem "$DL\proposal*.md" -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1 } until ($f -and $f.LastWriteTimeUtc -gt $rendered)
```

Adopt the newest match as the run's `proposal.md` (`mv "$f" "$RUN/proposal.md"`; PowerShell
`Move-Item $f.FullName "$RUN\proposal.md" -Force`) and delete no other `proposal*.md` in the
download folder — an older one may belong to a different run.
