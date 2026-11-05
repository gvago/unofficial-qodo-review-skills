# Behavioral contract review: evaluation and adoption

This is an unofficial, source-grounded review lens for four areas: lifecycle safety,
shared helper/API semantics, effective tests, and prose/code behavioral consistency.
It is not a new reviewer persona and does not guarantee detection of every defect.

## Install only the lens

Copy `SKILL.md` into `skills/behavioral-contract-review/SKILL.md` in the repository
being reviewed. Do not copy this evaluation folder into that repository: expected
findings and fixture answers are author-side test material, not review context.

Use your deployment's supported Review Standards skill controls to activate the
skill, scope it to the repository, and select review steering. A discovered row is
not proof that the reviewer consulted the skill. Verify a real changed-code case
and its skill evidence. Local discovery and platform catalog steering are separate
paths; the evaluation receipt must state which path was exercised.

Review-effort selection and excluded-file settings still apply. A skill cannot
review a change that the pipeline skips. No persona enablement is required.

## Evaluation design

The synthetic baseline lives in
[`gvago/behavioral-contract-review-eval`](https://github.com/gvago/behavioral-contract-review-eval),
pinned to `8f59c3879222e2a44e7595e083c6b9ee81c4f501`.
It contains clean implementations, tests, shared APIs and documented behavior.
Application changes are identical between the no-skill and skill-enabled main arms.
Only the skill is added to the treatment.

The main regression patch covers destructive archiving, cross-environment deletion,
stale plan preconditions, divergent account normalization, incorrect cache time units,
disabled coverage, sleep-based readiness, a tautological assertion, default drift,
prose retry/ordering/error guarantees, and a code change contradicting an unchanged
prose exception. Separate transfer cases cover shared-owner teardown, textual boolean
parsing, an uncalled mock assertion in a test of an application caller, and a prose
weekday qualifier. These are synthetic mechanism-transfer cases, not independently
sampled customer incidents.

Clean patches include legitimate permanent deletion, downstream environment scoping,
an atomic effect-time guard, equivalent helper logic, a supported absolute-deadline
call, an injected fake clock, framework-owned assertions, historical/versioned prose,
and a coordinated code-and-documentation update. They are counterexamples to broad
keyword-based flagging, not proof about all possible safe programs.

Expected labels, probes, scoring instructions and earlier model outputs stay outside
the review clone. Contracts already present in source and docs are legitimate input.
This is a contract-rich test; it does not establish discovery of undocumented business
invariants or customer deployment compatibility.

## Reproduce the review inputs

1. Clone the synthetic baseline outside this skills repository and check out the exact
   baseline SHA above. Create a separate branch/worktree for every arm and repetition.
2. Apply one patch from `patches/` to that clean baseline. Use `main-defect.patch` for
   the control and treatment, `main-clean.patch` for the clean control, and the two
   `holdout-*` patches for transfer and transfer-clean cases.
3. Copy only the lens `SKILL.md` into treatment worktrees. Leave the no-skill control
   without the lens. Do not copy expected labels, receipts or this evaluation directory.
4. Submit a fresh full Qodo review against the exact baseline SHA. The submitted eval
   uses the deep setting because it tests destructive multi-phase behavior. Use the
   same setting and neutral context across arms; preserve operation IDs and collect
   completed results before their retention expires. The baseline's configuration
   enables local skill discovery; platform steering needs its own adoption proof.
5. Preserve exact inputs and skill digest, completed run IDs, coverage and findings.
   Adjudicate every finding against its actual mechanism, not just its filename or rule
   ID. Only genuine skill citations establish skill-grounded findings.

Do not run repeated trials in the same review stream and call carried findings
independent detections. Do not count a reused result or a repeated generation ID as
a fresh trial. Keep development/tuning outcomes separate from the release suite.

## Publication gate

`score.py` consumes `receipts.json` and `cases.json`. Those files are evidence exports,
not live review execution. The gate requires:

- one no-skill main baseline; three independent main treatment, clean, transfer, and
  transfer-clean reviews;
- complete, fresh full reviews and one unchanged skill revision;
- every expected primary/transfer defect detected in every corresponding repetition;
- zero findings on each clean control and adjudication of every positive-arm finding;
- skill-grounded evidence for every expected case across the treatment trials.

Run the gate's own regression tests with:

```bash
python3 -m unittest discover -s evaluations/behavioral-contract-review -p test_score.py -v
```

Unit tests validate the scorer only. They are never review-performance evidence.

Run the saved-evidence gate with:

```bash
python3 evaluations/behavioral-contract-review/score.py \
  evaluations/behavioral-contract-review/receipts.json \
  evaluations/behavioral-contract-review/cases.json
```

Read the measured release result before recommending the lens. Passing this finite
suite is not a universal guarantee and does not demonstrate improvement over baseline
when baseline also detects the same defects. Actual customer misses require their own
same-revision replay, with permission to access the relevant source.
