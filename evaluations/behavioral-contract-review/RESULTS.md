# Behavioral contract review: measured evaluation

**Local fixture gate: PASS.** This result is limited to the frozen synthetic inputs
below. It is not a claim of perfect reviews, statistical superiority, or compatibility
with every deployment.

## Measured result

| Arm | Independent executions | Result per execution |
| --- | ---: | --- |
| No-skill primary baseline | 1 | 12 of 13 seeded defects detected |
| Skill-enabled primary cases | 3 | 13 of 13 detected in each execution |
| Skill-enabled transfer cases | 3 | 4 of 4 detected in each execution |
| Corrected primary clean controls | 3 | 0 structured findings in each execution |
| Corrected transfer clean controls | 3 | 0 structured findings in each execution |

All 17 distinct defect cases were detected in each of their three treatment
repetitions. Fifty of the 51 treatment/transfer detections contain an explicit
`behavioral-contract-review` skill citation. The remaining protection/apply finding
is correct but has no skill citation in primary repetition 1; that same case is
skill-cited in repetitions 2 and 3. Attribution is therefore established for every
case across its trials, **not for every individual detection**. A citation is evidence
of skill-grounded output, not proof of a counterfactual discovery cause.

The single baseline missed the changed default versus current documentation case.
That is an observed difference on this fixture, not an estimated uplift or evidence
that the other 16 mechanisms require the skill. The baseline was not repeated or
run on the transfer and clean arms, so those arms cannot support comparative claims.

Three clean reviews also supplied optional prose commentary. Zero structured findings
must not be described as zero commentary or zero noise.

## Execution evidence

- Synthetic source baseline:
  [`8f59c3879222e2a44e7595e083c6b9ee81c4f501`](https://github.com/gvago/behavioral-contract-review-eval/tree/8f59c3879222e2a44e7595e083c6b9ee81c4f501).
- Frozen lens SHA-256:
  `705a77592dda51e5963de344ca5fbb1fa26db3d58e4d280225391a34557f7aae`.
- Qodo CLI version: `2.1.0`. Real full/deep local reviews, not direct prompt simulations.
- Thirteen distinct returned execution IDs, checkpoints, operation IDs and isolated
  branches. Returned Git tree IDs match independently reconstructed worktree trees.
  Submitted skill bytes match the frozen lens; no-skill control contains no lens.
- Results match the saved CLI collection outputs. Review/finding coverage is complete,
  no files were reported skipped, and treatment/clean executions report the actual
  skills component completed. Positive citations provide the skill-specific evidence;
  component completion alone is not a file-read trace.

See [receipts.json](receipts.json) for original finding text, citations and explicit
adjudications; [provenance.json](provenance.json) for source/input checks; and
[inputs.json](inputs.json) for frozen input hashes. Raw collection outputs are retained
by the maintainer. The public exports omit workspace credentials and internal routing
metadata. These are checked saved artifacts, not signed service attestations.

The scorer is an **adjudicated-receipt consistency gate**. It checks repeated detection,
clean findings, case/location mappings and actual skill citations; it does not contact
the service or prove that someone could not edit a saved artifact. The separate
provenance checks bind the selected results to the submitted source snapshots.

## Semantic and executable checks

The primary suite covers three lifecycle defects, two repository helper/API defects,
three ineffective-test defects, and five code/prose consistency defects. Transfer cases
use shared ownership, textual boolean parsing, a mock assertion against an application
caller, and a prose scheduling qualifier. These are mechanism-transfer cases, not
independently sampled production incidents.

Executable probes demonstrate the nine primary code/test failures and three transfer
code/test failures, then pass on their corrected counterparts. Test mutations verify
that broken arithmetic and an omitted notification are rejected by the clean tests
but accepted by the weakened tests. Documentation evidence records the implementation's
default, retry predicate, operation ordering, permission-error propagation and weekday
condition; prose contradictions were separately source-adjudicated.

The final primary clean fixture's nine executable tests pass, including protected
resource preservation, legitimate permanent deletion, downstream environment scoping,
fake-clock retry ordering and default expiration boundaries. The same safe lookalikes
are included in the transfer-clean patch. The scorer/provenance tests validate the
evidence checks themselves; they are not model-quality measurements.

### Explanatory error retained

Primary repetition 1's normalization finding correctly reports whitespace trimming
loss, but its secondary `STRASSE` versus normalized `straße` illustration is not a
failing input for the supplied helper. That example is an explanatory error and gets
no separate credit. The finding text is preserved, with this caveat in its adjudication.
The other two repetitions supply valid Unicode counterexamples. Detection success
must not be described as every sentence being correct.

## Development history and scope

Earlier development runs were not counted as release repetitions. They exposed an
addition-only baseline, a mock-only test, a missing expiration consumer, incomplete
clean-test oracles, a default change without a consumer, and permanent-purge controls
that violated protection invariants. Those fixtures were corrected rather than their
findings being ignored. Final primary/transfer positive inputs are from the frozen
third fixture revision; clean inputs are from the sixth revision. They use the same
baseline and identical lens bytes. Fresh run identities prevent carried findings from
being counted as independent detections.

The contract-rich source documentation is legitimate reviewer input, but makes this
a favorable synthetic evaluation. It does not establish discovery of undocumented
business invariants, effectiveness on unrelated languages or repositories, or behavior
in the recipient's deployed version. It also does not validate a docs-only review when
review effort skips that change.

## Adoption status

This evaluation proves the **local skill-discovery path** exercised by the frozen
baseline configuration. Portal ingestion, active steering configuration and Git-PR
publication are separate acceptance checks. Do not present them as verified from the
local results alone. See the release/PR evidence for those checks when available.
