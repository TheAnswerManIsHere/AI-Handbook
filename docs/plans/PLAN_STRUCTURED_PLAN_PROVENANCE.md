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
| `git grep -lni "approved[- ]plan[- ]source\|approved-plan oracle\|fix tier\|no-plan form\|\[PLAN REVIEW\]\|Review mode" -- core docs scripts .github` | 16 files (excluding this plan, tests, and committed receipts) |
| `node scripts/check-manifest.mjs` | `0 ready, 13 staged` — nothing has synced to any consumer |

**The producer oracle was wrong once, and the corrected one is above.** Its
first form searched `"Approved-plan source"` — space-separated and
capitalised — and found 6 files. `pr-docs/SKILL.md:120` writes
*approved-plan-source line*, hyphenated and lowercase, and was missed; so were
the plan-review selector's own tokens. That is #40 §2.2's class — a matcher
written from a remembered format — committed in the very plan that exists to
end it. Recording the failure rather than only the corrected result, because
the corrected result alone would teach the wrong lesson. (Codex, round 1.)

The 16 hits classify into three sets, and only the first is this plan's scope:

- **Teaches a form an author writes** (must change): `claude-core.md` (the
  contract's three provenance forms), `pr-docs/SKILL.md` (the phase-PR
  oracle line), `bugfix/SKILL.md` (the tier oracle block), `working-modes.md`
  (that block's field list), `plan-review-loop/SKILL.md` (the plan-review body
  template).
- **Selects or consumes** (must change): `review-loop-record.mjs`,
  `review-loop-adjudicator.md`'s description of what it reads, and
  `code-review.md:45-52` — which is a *reviewer contract*, not a mention: it
  tells a reviewer the oracle carries an **Approved-plan source** and that a
  source naming only a title or a mutable branch is itself a finding. Left
  unchanged while producers move, it would have reviewers enforcing the
  superseded presentation. (Codex, round 2 — my first classification put it in
  the set below.)
- **Mentions without instructing** (unchanged, listed so the next reader need
  not re-derive the split): `maintenance/SKILL.md`,
  `status/SKILL.md`, `status-all/SKILL.md`, `uat/SKILL.md`, `agents-core.md`,
  `plan-review-contract.md`, `pr-watch/SKILL.md`, and one memory note.

The first two sets are the scope. Nothing outside them reads or writes a
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
which of the two paths produced its oracle — a diagnostic that shows the prose
path being used, not a proof that it is unused.

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
- **The tier-completeness refusal**: a bugfix body missing a required oracle
  field is refused, not passed to the judge as `sections: null`.
- **Title/body agreement for plan-review mode**, in both mismatch directions.

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

3. **The declaration is read only from the generator's existing live-text
   boundary, extended by one construct.** `outsideFences` already defines what
   counts as the author's own assertion: it drops fenced blocks, blockquotes
   and indented code, each added because a declaration-shaped string appeared
   there and was wrongly believed. This plan reuses that function rather than
   restating what it covers, and adds the one construct it does not know
   about — an HTML comment, which is invisible in the rendered body and is
   exactly what a PR-template placeholder is made of.

   **Reuse the boundary, not the stripper.** `outsideFences` *removes* fenced
   lines, the fence markers included, so a parser that literally called it
   could never see a `plan-provenance` block at all — and changing what it
   returns would alter prose-path behavior, which Must Not Change forbids.
   What the two paths share is the computation of **which lines are inert**,
   not what is done with them. That computation is extracted so it has one
   definition and two consumers: the prose path drops the inert lines as it
   does today, and the declaration scan asks whether a given fence *opener*
   sits at a live position and reads the region it delimits. Adding HTML
   comments is then one edit to the extracted boundary, inherited by both.
   (Codex, round 4.)

3a. **The enumeration is the defect; the reference is the fix.** Round 1 of
   this loop named one inert construct, round 2 named two, and round 3 pointed
   out that the generator had known four since #38's round 11 — a set I had
   read in this same session and then wrote down from memory anyway. That is
   three consecutive rounds of the same failure, inside the plan whose purpose
   is to end it, and the honest reading is that any list of inert regions I
   maintain by hand will be wrong again. So the plan does not keep one. The
   parser asks the single existing construct what is live, and the only
   standing claim is the delta: `outsideFences` plus HTML comments. Adding a
   fifth construct later is then one edit in one function that every consumer
   of live text inherits at once, rather than a list to re-audit.
   (Codex, round 3.)

3b. **What survives of the closure argument, stated smaller.** The prose path
   matched a *phrase* that live prose can legitimately contain, so its problem
   was unbounded in a second dimension: even correct live-text detection left
   every sentence containing the label a candidate. This path matches a *fence
   with a unique info string*, so live-text detection is the whole problem, and
   it is one this repository already owns an answer to. That is a narrower and
   more defensible claim than round 2's "there are exactly two", and it is the
   one the plan makes.

4. **A present-but-malformed declaration refuses, and never falls through to
   the prose path.** Fall-through would mean a typo silently re-enters the
   class this plan closes, which is the failure mode that would make the whole
   change worthless. *Enforced by construct:* the refusal is a runtime
   condition in the generator, not a checked property.

5. **The block selects which oracle governs; every completeness check the
   generator performs today survives, unchanged, beside it.** In particular a
   body declaring `kind: bugfix` still has its tier's required oracle fields
   checked, and an incomplete one still refuses rather than reaching the judge
   as `sections: null` — the refusal `permittedNoPlanForm` performs today.
   An earlier revision of this decision deferred that check to the PR-body
   lint (#40 §2.8) and so contradicted decision 6 in the same list: a reviewer
   *would* have lost a check, for however long that lint took to ship. The
   split is between *selection* (the block's job) and *completeness* (a check
   that keeps running); it is not a licence to drop the second.
   (Codex, round 1.)

6. **A declaration is the author's word, and always was.** Prose saying "n/a —
   trivial change" was equally self-asserted. This plan makes the assertion
   legible and machine-checkable; it grants no authority that did not exist,
   and no reviewer loses a check they had.

7. **The kinds are exactly the cases the generator must already distinguish**:
   an approved plan, its split-loop variant, the private path, a bugfix with
   its tier, a trivial change, and a plan-review loop. One parser answers "what
   governs this PR", where six prose forms answer it today.

7a. **`kind: plan-review` must agree with the `[PLAN REVIEW]` title, and
   disagreement in either direction refuses.** This is the invariant
   `planReviewSignals` enforces today, and it is a safety property, not a
   formatting one: without it an ordinary PR can declare itself a plan-review
   loop and take the *mutable head plan* as its oracle, and a real plan-review
   PR can be judged against an approved-plan or no-plan oracle instead. Both
   mismatch directions are refusals. Moving the signal from prose to a
   declared key changes where the body half is read, never whether the
   agreement is required. (Codex, round 1.)

8. **`approved_by` must name David** for every approved-plan kind. The contract
   already requires it (`claude-core.md:453-457`); today it is a phrase inside
   a regex, and after this it is a key comparison.

8b. **The private kind names a file, not a path.** A private plan is handed
   to David directly and never committed, so `docs/plans/PLAN_….md` is a path
   it will never have; requiring the public key would refuse every valid
   private-plan PR by construct. It carries `plan_filename` — the artifact's
   real name — beside the `shasum -a 256` that pins its contents, which is the
   pairing the contract's private form already specifies. (Codex, round 4.)

8a. **`plan_file` is required on every approved-plan kind, not optional.**
   The existing resolver accepts an explicit plan path and uses it to pick one
   plan when the cited commit introduced several, validating that the path was
   actually introduced there. Forbidding the key would turn a body the current
   resolver handles into an unavoidable refusal; making it *optional* would
   contradict decision 9's no-optional-keys rule and reintroduce the
   present-or-absent ambiguity the block exists to remove. Required is the only
   form that keeps both: the author always names the plan, and the resolver
   keeps its introduced-at-that-commit check as the thing that makes the name
   trustworthy. (Codex, round 3.)

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

11a. **A body carrying both a declaration and a legacy prose *selector*
    refuses, as a contradiction — and a selector is not the same thing as
    oracle prose.** The distinction is load-bearing and round 1's wording
    missed it: `permittedNoPlanForm` reads the `**Fix tier:**` line as the
    legacy *selector* for a bugfix body, while the tier's other fields
    (reported symptom, intended behavior, must not change, root cause, blast
    radius) are the human-readable *oracle* that decision 5 keeps requiring.
    Refusing on "both formats" without that split would reject every complete
    declared bugfix, because a complete one necessarily carries both the block
    and the prose. So: `fix_tier` in the block replaces the `Fix tier:` line; a
    declared body carrying that line as well is the refused
    contradiction, and every other tier field stays required exactly as today.
    **The tier's rationale survives as oracle prose, not as a block key**:
    today it rides the same line (`Fix tier: B — Q1 fired …`), and reviewers
    use it to challenge a mis-tiering, so it becomes a named required field
    for tiers A, B and C under the completeness check decision 5 preserves.
    `fix_tier` carries the letter; the reason it is that letter stays where a
    reviewer reads it. Without this the block would parse as complete while a
    required reviewer check had quietly gone. (Codex, round 3.)
    The same split applies to the approved-plan kinds: the block replaces the
    provenance *sentence*, and the plan's quoted oracle sections are untouched
    prose. (Codex, round 2.)

    **And to plan-review mode, where the distinction is safety-critical.**
    `## Review mode` / *Plan review only* is simultaneously the selector
    `planReviewSignals` reads and the human instruction never to merge or
    implement. The selector is the **phrase** `Plan review only`, and that
    phrase alone is what `kind: plan-review` replaces; the rest of the section
    — never merge, do not implement, apply the plan-review contract — is
    safety copy that stays exactly as it is and is not a selector. Without
    this, an implementation reading 11a literally either refuses every
    declared plan-review body as mixed-format or deletes the never-merge
    instruction to avoid that. The revised template, and a test proving the
    template it emits actually parses, are part of the producer step.
    (Codex, round 3.)

    **Why a refusal, and why in the parser.** Decision 11 states the
    replacement; without this, nothing enforces it. "Declaration, else prose" would silently ignore
    the prose whenever a block exists, so a stale producer or a half-edited
    body could name one commit in the block and a different one in the
    sentence — the judge following the first while a human following the
    contract reads the second. Enforcement belongs in the parser, not in
    producer instructions, because a stale producer is precisely one that has
    already failed to follow instructions. *Enforced by construct.*
    (Codex, round 1.)

12. **The prose path stays, unchanged, for bodies with no declaration**, and
    the record carries a discriminator naming which of the two answered.
    Deleting 361 lines is correct eventually and reckless now. **That
    discriminator is sampled diagnostics, not migration proof:** a record
    exists only where the judge was dispatched, and a clean or all-declined
    round ends with no dispatch and so no record — an absence of
    prose-selected records therefore observes only the PRs that reached
    adjudication. Removing the fallback requires an exhaustive pass over PR
    bodies; this field cannot authorise it. An earlier revision called the
    field a demonstration, which was a completeness claim resting on sampled
    evidence — the precise thing the claim-oracle rule forbids.
    (Codex, round 1.)

12a. **The machinery is not enabled in a consumer until that consumer's own
    template emits the declaration.** `docs/consuming-repos.md:101-124` makes
    each consuming repository the owner of its
    `.github/pull_request_template.md`, and `bugfix/SKILL.md` sends authors to
    it. Those files are outside this repository, so **no grep run here can
    establish that the producer inventory is exhaustive** — under the
    claim-oracle rule that is an uncertainty, not a settled fact, and this
    decision is what bounds it. The sequencing invariant: syncing the parser
    to a consumer whose template still emits a legacy selector would refuse
    that consumer's PRs, so the template migration precedes the machinery, per
    consumer, and the enabling step checks it rather than assuming it. Nothing
    has synced yet (`0 ready, 13 staged`), so this is a gate to build before
    the first unstaging, not a repair. (Codex, round 3.)

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
runs only when no declaration is present, and the record carries a
discriminator naming which answered.

### The declaration, normatively

This section is the wire format. It is here rather than left to
implementation because a format shared by *producers* (five skills and
contracts that tell an author what to write) and one *parser* is the case the
specification test keeps: both sides can be self-consistently wrong, and no
compiler, test or diff review compares a skill's template against a parser's
key set. #40 §2.2 requires a matcher's fixture to be copied from the document
that defines the format; this plan is that document. (Codex, round 1.)

The block is a fenced region whose info string is exactly `plan-provenance`:

````markdown
```plan-provenance
kind: approved-plan
plan_review_pr: 37
plan_commit: 972b60d
approved_by: David
approved_on: 2026-09-06
```
````

**Kinds and their keys.** Every key not required for a kind is forbidden for
that kind; there are no optional keys.

| `kind` | Required keys |
|---|---|
| `approved-plan` | `plan_review_pr`, `plan_commit`, `plan_file`, `approved_by`, `approved_on` |
| `approved-plan-split` | `plan_review_prs`, `combined_plan_commit`, `combined_branch`, `plan_file`, `approved_by`, `approved_on` |
| `private-plan` | `plan_filename`, `plan_sha256`, `approved_by`, `approved_on` |
| `bugfix` | `fix_tier` |
| `trivial` | *(none)* |
| `plan-review` | *(none)* |

**Value grammars.**

| Key | Grammar |
|---|---|
| `plan_review_pr` | a positive integer, written without `#` |
| `plan_review_prs` | two or more positive integers, comma-separated |
| `plan_commit`, `combined_plan_commit` | 7–40 lowercase hexadecimal characters |
| `combined_branch` | `plan-review/`, then 1–100 characters from `[A-Za-z0-9._-]`, then `-combined`. The slug may not be empty, may not begin or end with `.`, `_` or `-`, and may not contain two adjacent separators. |
| `plan_file` | a repository-relative path matching `docs/plans/PLAN_[A-Z0-9_]{1,100}\.md` |
| `plan_filename` | a bare filename matching `PLAN_[A-Z0-9_]{1,100}\.md`, no path separators — the private artifact is handed to David as a file and never committed, so it has a name but no repository path |
| `plan_sha256` | exactly 64 lowercase hexadecimal characters |
| `approved_by` | exactly `David` |
| `approved_on` | `YYYY-MM-DD` |
| `fix_tier` | one of `A`, `B`, `C` |

**Syntax.** One `key: value` per line, surrounding whitespace trimmed; blank
lines ignored. `kind` comes first. No comments, no nesting, no quoting, no
multi-line values, no repeated keys. A repeated key, an unknown key, a missing
required key, a forbidden key, or a value failing its grammar is a refusal
naming the key.

### The record's discriminator

The record gains `planOracle.declaredBy`, whose value is `"declaration"` or
`"prose"`. It is deliberately **not** called `path`: `planOracle.path` already
exists and holds the resolved `docs/plans/PLAN_*.md` filename, so reusing the
word would either collide with a source-of-truth field or leave two readers
disagreeing about which one they were reading. Absent on every record
committed before this ships, and absence means `"prose"` — which is what every
existing record used. (Codex, round 1.)

## Data Model and Migration Impact

No database, no migration. The record gains `planOracle.declaredBy`, specified
above. Committed records lack it, and its absence means `"prose"` — what every
existing record used. No key is added to `.agents/machinery.json`.

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
kind's happy path; a missing required key; a forbidden key for that kind; an
unknown key; a repeated key; a malformed value of every grammar above; two
blocks; a block nested inside another fence, a blockquote, or an indented
code block; a block inside an HTML comment; each of those four alone and
alongside a live declaration; a `combined_branch` failing each clause of its
grammar; a missing `plan_file`; a `private-plan` block naming a bare filename
and one wrongly naming a repository path; a declaration whose fence opener
sits inside each inert context, proving the extracted boundary is shared; a `kind: bugfix` body carrying a legacy
`Fix tier:` selector line as well as the block; a body with no block falling back
to prose unchanged; `declaredBy` under both paths and absent on a legacy
record; a body carrying both a declaration and a prose provenance form; a
`kind: plan-review` block under an ordinary title and a `[PLAN REVIEW]` title
with no such block; and a `kind: bugfix` block whose tier oracle is
incomplete. Fixtures are copied from real bodies — #38's, the merged bugfix
#611's, and plan-review #37's — per #40 §2.2, not invented from a remembered
format.

## Implementation Steps

1. Tests first, failing.
2. The parser and its refusals.
3. Resolution order: declaration, else prose; refuse a body carrying both;
   record `declaredBy`.
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

Two fixtures built from #38's real body, because one body cannot legally
exercise both paths — decision 11a refuses a body carrying a declaration and a
legacy selector together, so "the real body *plus* a block" is the state the
plan forbids rather than its acceptance case (Codex, round 3):

1. **Declaration path.** #38's body with its `Approved-plan source` sentence
   *replaced* by the equivalent declaration. `review-loop-record.mjs`
   regenerates the record, `planOracle.sections` are byte-identical to the
   ones the prose path produced at `972b60d`, and `declaredBy` is
   `"declaration"`.
2. **Fallback path.** #38's body untouched. The record is the one the
   generator produces today, and `declaredBy` is `"prose"`.

Plus: a malformed declaration refuses naming the key; the two bodies above
concatenated refuse as the mixed state; and the plan-review template the
producer step emits parses as `kind: plan-review` with its never-merge copy
intact.

## Now / Next / Never

**Now:** the declared form, its parser, the record's path field, the contract
and producer text.

**Next:** deleting the prose path — gated on the exhaustive PR-body pass
named in decision 12, never on `declaredBy` observations, which cannot see a
PR that closed without an adjudication (Codex, round 2); the
PR-body completeness lint (#40 §2.8); the conformance rubric that first
consumes `planOracle` (phase 1c); the plan-review oracle fork (#39 gap 3);
the patch-cap amendment (#40 §2.4).

**Never in this plan:** a YAML dependency; any change to what the oracle
contains; any change to the verdicts, budgets, or gates.
