# Behavioral contract review: evaluation

The skill was evaluated on synthetic Python fixtures covering lifecycle safety,
shared helper/API semantics, test effectiveness, and prose/code consistency.

## Results

| Arm | Executions | Result per execution |
| --- | ---: | --- |
| No-skill primary baseline | 1 | 12 of 13 seeded defects detected |
| Skill-enabled primary cases | 3 | 13 of 13 detected |
| Skill-enabled transfer cases | 3 | 4 of 4 detected |
| Primary clean controls | 3 | 0 structured findings |
| Transfer clean controls | 3 | 0 structured findings |

All 17 distinct cases were detected in each of their three repetitions. Actual
skill citations accompany 50 of 51 positive detections and cover every distinct
case across its repetitions. Three clean reviews also returned optional commentary.

The baseline was run once on the primary cases only. It missed the changed-default
versus documentation case. This is a scoped observation, not a general improvement
estimate or a comparison for the transfer and clean populations.

## Reproducible evidence

- Synthetic baseline: [`8f59c3879222e2a44e7595e083c6b9ee81c4f501`](https://github.com/gvago/behavioral-contract-review-eval/tree/8f59c3879222e2a44e7595e083c6b9ee81c4f501).
- Lens SHA-256: `705a77592dda51e5963de344ca5fbb1fa26db3d58e4d280225391a34557f7aae`.
- Local reviews used Qodo CLI `2.1.0`, full analysis and deep effort.
- Thirteen distinct executions used isolated branches. Returned Git trees were
  matched to reconstructed inputs and submitted skill bytes.

[Inputs](inputs.json) record file and patch hashes; [receipts](receipts.json) retain
finding text, citations and adjudications; [provenance](provenance.json) records the
input checks. The scorer checks saved evidence consistency and is complemented by
source-snapshot validation.

Executable probes reproduce the code/test defects and pass their safe counterparts.
The clean controls include protected-resource preservation, legitimate permanent
deletion, downstream environment scoping, fake-clock retry ordering, and default
expiration boundaries. Mutation checks confirm that clean assertions reject wrong
arithmetic and omitted notifications. The scorer/provenance regression suite has
30 passing tests.

For the first normalization finding, credit is based on its valid whitespace
counterexample, not its secondary Unicode illustration. Original finding text and
adjudication remain available in the receipts.

## Native steering example

The [Git-PR example](https://github.com/gvago/behavioral-contract-review-eval/pull/1)
verifies an active imported skill in steering mode with legacy discovery disabled.
It contains 12 fresh skill-cited findings and one carried finding, which is excluded
from fresh-discovery counts. This is adoption evidence, not another independent
repetition of the local evaluation.

[Release notes and native evidence](https://github.com/gvago/unofficial-qodo-review-skills/releases/tag/behavioral-contract-review-v1.0.0)
provide setup instructions and the structured Git-PR result.

## Tested scope

The fixtures provide explicit repository contracts. These measurements do not
establish discovery of undocumented invariants or equivalent coverage on unrelated
repositories and languages. Review-effort and exclusion settings still apply.
Validate against previously missed PRs in the target deployment before relying on
the same coverage.
