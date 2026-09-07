# Plan: the adjudication record's oracle comes from a declared block, not from prose

Workstream: #36, phase 1b. Inputs: #40 §2.9 (the adjudicator's own
recommendation, twice), #40 Part 1b's two parsing items, #39 gap 2.

**Public-disclosure check.** Passed. No unpatched vulnerability, no
auth-bypass specifics, no secrets, no payment-fraud path, no customer data,
nothing embargoed. This plan is on the public path.

**Scope of work,** agreed with David at the SOW gate (2026-09-07): structured
provenance alone. Conformance triage, the measurement counters and the
phase-scope selector are phase 1c.

**Ceremony tier:** `sensitive`, 5 rounds, criticality 90. The artifact decides
what every future loop's judge believes is the approved oracle, which is
fleet-wide blast radius — #40 §2.1's reasoning applied to this PR rather than
waited for as a contract change. **David-merge-only**: it changes a gate
script's input.

---

## Preflight

**Increment test.** Passes. No universal quantifier; one shippable increment
with no *Phases* section. Phase 1's remainder was split at the SOW gate and
the rest is recorded as *next* below, not carried here.

**Affected-surface inventory.** This plan changes a *pattern* — how a PR body
declares which oracle governs it — so the scope is drawn from mechanical
oracles, run against `main` at `25c1df8` on 2026-09-07:

| Oracle | Result |
|---|---|
| `git grep -n "planOracle" -- core/scripts core/.claude core/.agents docs scripts` (minus tests) | 13 hits: the producer, its two cap sites, and **one consumer — the judge's contract prose** at `review-loop-adjudicator.md:133`. No code consumes it. |
| `git grep -n "PLAN_COMMIT_FORMS\|TEXTUAL_NO_PLAN_FORMS\|approvedPlanSourceText\|permittedNoPlanForm\|planReviewSignals\|BUGFIX_ORACLE_FIELDS\|FIX_TIER_RE\|approvedPlanCommit"` | 19 hits, all inside `review-loop-record.mjs` lines 770–1130 — a 361-line block |
| `git grep -ln "Approved-plan source\|Approved-plan oracle\|Fix tier\|no-plan form" -- core docs scripts .github` | 6 files: `claude-core.md`, `code-review.md`, `bugfix/SKILL.md`, `maintenance/SKILL.md`, `plan-review-loop/SKILL.md`, the generator |
| `node scripts/check-manifest.mjs` | `0 ready, 13 staged` — nothing has synced to any consumer |

The hit list is the scope. Nothing outside those files reads or writes a
provenance form.

**Claim-oracle rule.** Every completeness claim below either names the oracle
above that established it, or is written as an uncertainty. Two properties are
enforced by *construct* (a runtime refusal) and are marked as such; nothing
here rests on a test alone.

**Specification test.** Applied line by line. Call sites, function names,
regexes and test assertions are deliberately absent: a compiler, the suite, or
diff review would catch those. What remains is the four uncatchable
categories — the declared form's shape, the refusal boundaries, the sequencing
against phase 1c, and the semantics of a self-declaration.

---

## Problem

The record's `planOracle` — the approved plan's sections, the field the judge
is told to weigh findings against — is derived by 361 lines of regular
expressions over free-form Markdown. Across #38's fourteen rounds that block
produced roughly twenty of fifty-five findings, each one a Markdown topology
the previous round had not masked: fenced examples, indented code, blockquotes,
a heading whose section held a quoted sample, and finally ordinary prose
containing the label before the real declaration. The trend never declined, and
the adjudicator named the shape at two separate gates: the class does not
converge by review rounds, because the space of ways a provenance-shaped string
can appear in prose without being the declaration is open.

It has also mis-parsed this repository's own bodies. #39 gap 2: the generator
refused #38 because its sha was in backticks, the house style.

## Direction

Workstream #36 — the strongest available model as a third set of eyes, both in
the review loop and at the decisions David otherwise makes blind. This phase
serves the prerequisite that workstream states for itself: *intelligence on top
of a lying field is a confident wrong verdict*. The judge's oracle must be
trustworthy before phase 1c's rubric consumes it.

## Product Intent

After this increment, a pull request **declares** which oracle governs it, in
one block whose form is fixed and whose keys are named. The record reads that
declaration; it does not infer one from prose. A declaration that is present
and malformed is a refusal that names the key at fault, never a silent
fall-back. A body written before this exists keeps working, and the record says
which of the two paths produced its oracle, so the prose path's disuse becomes
a measurement rather than an assumption.

## Must Not Change

- The four verdicts, their meaning, the write-gate rule, the tier budgets, the
  self-serve leash, and the David gate.
- The adjudicator reads only the script-generated record. This plan adds no
  channel by which the dispatching session's prose reaches it.
- What the oracle *contains*: the same sections, resolved at the same commit,
  under the same caps. This plan changes how the record learns which plan is
  authoritative, not what it then reads from it.
- The record's refusal discipline: a fact it cannot establish is a stated
  refusal or a stated `null` with a reason, never a zero.
- Every committed record and receipt stays loadable; `loadLoop` on every PR
  that has receipts today still returns a usable state.
- `.agents/machinery.json`'s required shape. No key is added, so every enrolled
  consumer's file stays valid unchanged.
- The prose path's behavior for bodies that carry no declaration.

## Settled Decisions

1. **The declaration is a fenced block with a dedicated info string**, holding
   `key: value` lines. Fenced, because every prose matcher in the generator
   masks fenced regions *out* — so the declaration lives exactly where prose
   cannot be mistaken for it, and the ambiguity runs out rather than being
   chased. A dedicated info string rather than `yaml`, because a `yaml` block
   is ordinary content in a PR body and a sentinel must not be.

2. **One block per body; two is a refusal.** First-wins is the precise defect
   #40 Part 1b recorded — a sample declaration ahead of the real one silently
   became the oracle. A second block is a contradiction, and a contradiction
   the author can see is better than a winner they cannot predict.

3. **The declaration is read only at the top level of the body.** A block
   nested inside another fence is an example — this plan's own text and the PR
   that ships it both contain one. This is the single Markdown-topology rule
   that survives, and the honest statement of the change is that the class
   shrinks from an open set of topologies to this one nesting rule, not that it
   disappears. It reuses the fence-region computation the generator already
   has; it adds no second notion of what a fence is.

4. **A present-but-malformed declaration refuses, and never falls through to
   the prose path.** Fall-through would mean a typo silently re-enters the
   class this plan closes, which is the failure mode that would make the whole
   change worthless. *Enforced by construct:* the refusal is a runtime
   condition in the generator, not a checked property.

5. **The block declares identity, not completeness.** It says which kind of
   oracle governs and carries the machine-checkable facts; whether the body
   *also* contains a complete human-readable oracle is a different question and
   belongs to the PR-body lint recorded as #40 §2.8. Conflating the two is what
   made the current function hard to reason about.

6. **A declaration is the author's word, and always was.** Prose saying "n/a —
   trivial change" was equally self-asserted. This plan makes the assertion
   legible and machine-checkable; it grants no authority that did not exist,
   and no reviewer loses a check they had.

7. **The kinds are exactly the cases the generator must already distinguish**:
   an approved plan, its split-loop variant, the private path, a bugfix with
   its tier, a trivial change, and a plan-review loop. One parser answers "what
   governs this PR", where six prose forms answer it today.

8. **`approved_by` must name David** for every approved-plan kind. The contract
   already requires it (`claude-core.md:453-457`); today it is a phrase inside
   a regex, and after this it is a key comparison.

9. **Values are validated by shape, and an unknown key refuses.** A permissive
   parser that ignores what it does not recognise would accept a misspelled key
   as an absent one — which is the fail-open direction, and the one this
   repository's own failure record returns to most often.

10. **No YAML parser.** The block is a fixed key set read line by line. A YAML
    dependency would widen the trust surface of a gate script's input for no
    gain, and YAML's implicit typing is its own bug class — `plan_commit:
    0123456` is a number in YAML.

11. **The block replaces the prose line rather than accompanying it.** Two
    statements of the same fact in one body is the duplicate-source-of-truth
    pattern this repository names as a known failure: they drift, and nobody
    knows which is authoritative. `plan_commit: 972b60d` is legible to a human
    reading the PR, so nothing is lost by having one. **This is the decision
    most worth challenging** — see *Questions for David*.

12. **The prose path stays, unchanged, for bodies with no declaration**, and
    the record names which path produced the oracle. Deleting 361 lines is
    correct eventually and reckless now; the field is what turns "no PR needs
    the old path any more" into something a later pass can demonstrate instead
    of assume.

13. **The implementation PR carries its own declaration.** The first real
    exercise of the form is the change that introduces it; a form that cannot
    describe its own PR is not ready.

## Repo Context Inspected

`review-loop-record.mjs` (the 361-line parsing block and the record assembly),
`review-loop-adjudicator.md` (the one consumer), `claude-core.md`'s provenance
clause, `code-review.md`, the `bugfix`, `plan-review-loop` and `maintenance`
skills, `sync-manifest.yml`'s `mentions` entries for those files, and
`check-manifest.mjs`'s staged/ready counts.

## Current Behavior

The generator extracts a source region from the body by heading or by labelled
line, masks fenced, indented and quoted regions out of it, and tries a list of
regular expressions for each permitted form. Failing all of them, it tries a
second list for the no-plan forms. Failing those, it refuses. Every step
depends on Markdown topology, and each round of #38 added a mask for one more.

## Source-of-Truth Analysis

The single source of truth for "which plan governs this PR" is, and remains,
the author's declaration in the PR body. What changes is its representation:
from a sentence the generator must recognise, to a block the generator must
parse. The plan file at the cited commit remains the source of truth for the
oracle's *contents*, unchanged.

## Proposed Design

A declaration block whose kind selects a required key set, parsed once, with
refusals that name the offending key. The prose path becomes a fallback that
runs only when no declaration is present, and the record records which path
answered.

## Data Model and Migration Impact

No database, no migration. The record gains one field naming the path that
produced the oracle. Committed records lack it; readers must treat its absence
as "prose", which is what every existing record used.

## Runtime Behavior

The generator refuses earlier and more specifically than it does today. No
other command changes. A loop whose PR body carries no declaration behaves
exactly as it does now.

## Admin/User UX Impact

David sees a code block where a sentence used to be, in PR bodies he does not
routinely read. No product surface.

## Security, Permissions, and Validation

No privilege boundary moves. The relevant boundary is the trust surface of a
gate script's input: this narrows it, by replacing pattern-matching over
arbitrary author prose with a fixed key set that refuses what it does not
recognise. The parser reads no file the generator does not already read.

## Testing Plan

Regression tests written before the change and watched to fail, covering: each
kind's happy path; a missing required key; an unknown key; a malformed value of
each shape; two blocks; a block nested inside another fence; a body with no
block falling back to prose unchanged; and the record's path field under both.
Fixtures are copied from real bodies — #38's, the merged bugfix #611's, and
plan-review #37's — per #40 §2.2, not invented from a remembered format.

## Implementation Steps

1. Tests first, failing.
2. The parser and its refusals.
3. Resolution order: declaration, else prose; record the path.
4. The contract text and the producers that teach the form.
5. `sync-manifest.yml` `mentions` and `identity-sources.yml` where citations move.
6. This PR's own body carries the block.

## Risks and Mitigations

- **The form is wrong and must change again after consumers depend on it.**
  Mitigated by timing rather than by cleverness: `0 ready, 13 staged` means no
  consumer has this machinery yet, so the form is still ours to change without
  a migration. That window closes at the first unstaging.
- **The nesting rule is itself a topology bug in waiting.** Accepted and stated
  (decision 3) rather than claimed away. It is one rule over one construct,
  and it is exercised by this plan's own PR.
- **A silent behavior change for existing bodies.** Mitigated by the fallback
  being untouched and by the path field making any change visible.

## Questions for David

1. **Decision 11 — the block replaces the human-readable provenance line
   rather than sitting beside it.** My reasoning is the duplicate-source-of-truth
   rule: two statements of one fact drift, and this repository's own failure
   record says so. Keeping both would let a reviewer read one thing while the
   judge reads another. **Recommendation: replace it.** If you would rather
   keep a prose sentence for readability, say so and the plan states the block
   as authoritative with the sentence explicitly decorative.

## Definition of Done

`review-loop-record.mjs` regenerates #38's record from its real body plus a
declaration block, and the resulting `planOracle.sections` are byte-identical
to the ones the prose path produced at `972b60d`, with the record naming the
declared path. A malformed declaration refuses naming the key. A body with no
declaration produces the record it produces today.

## Now / Next / Never

**Now:** the declared form, its parser, the record's path field, the contract
and producer text.

**Next:** deleting the prose path once the path field shows it unused; the
PR-body completeness lint (#40 §2.8); the conformance rubric that first
consumes `planOracle` (phase 1c); the plan-review oracle fork (#39 gap 3);
the patch-cap amendment (#40 §2.4).

**Never in this plan:** a YAML dependency; any change to what the oracle
contains; any change to the verdicts, budgets, or gates.
