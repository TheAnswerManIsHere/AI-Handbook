# Plan: Fable review foundations — a record that cannot lie about the artifact, a judge whose model tracks the strongest available tier and is stamped on every verdict, and a record wide enough to check conformance

Workstream: #36, phase 1a (foundations). Prerequisite for phase 1b (B1
conformance triage) and every later phase. Fixes #34 gap 2.

## Preflight

**Increment test.** #36 is the direction ("every judgement that would
otherwise rest on one actor's word gets a dispatch to the strongest
available model" — a universal quantifier). This plan is one increment: it
changes what the existing adjudicator *reads* and how its model and effort
are *chosen and recorded*. It adds no role, no rubric, no new dispatch
point. B1 (a rubric change) is the next increment and is not in this
document.

**Affected-surface inventory.** Four classes, each with a mechanical oracle,
results recorded under *Settled Decisions*:

1. **Declarative model pins** — `git grep -n -i 'model: *"\?fable'`
   over `core/` and `.claude/`.
2. **Semantic routing instructions that name the model tier in prose** —
   `git grep -n -i 'fable'` over the same roots, each hit classified *live
   routing instruction* (an agent would act on it) or *historical record* (a
   dated decision entry describing why something is as it is). Added at
   round 1: the `model:` spelling alone misses executable instructions like
   "dispatch one `review-loop-adjudicator` on Fable", which would keep a
   dispatch pinned to a tier the definition no longer names.
3. **Consumers of `artifact.files/added/removed` and `territory`** —
   `git grep -n 'artifactSize\|findingsByTerritory\|derived.files'`.
4. **Validators of an `adjudication`-kind extension receipt** —
   `git grep -n 'kind === "adjudication"'`, each hit classified *shape
   validator* or *state reader*.

**Specification test applied throughout:** what follows names invariants and
the constructs that hold them. Call sites, field renames, and test
assertions are left to the diff and the suite.

## Problem

Three defects in the adjudication machinery, each confirmed on a live loop:

1. **The record reports the artifact's size as zero against a non-empty
   patch.** On #28 and #33 the adjudication record carried
   `artifact: {files: 0, added: 0, removed: 0}` beside a 50 KB
   `artifact.patch`, so `territory` said `inDiff: 0 / outsideDiff: 7` for a
   loop in which every finding path was in the diff. Two independent judges
   flagged it (#34 gap 2). Root cause, measured this session: the snapshot's
   `files` array was empty on both loops (`files: []` with
   `complete.files: true`), and the generator accepts an empty array. The
   MCP `get_files` result is unfit as this channel: each item omits
   `deletions` when it is zero (measured on #33: `{filename, status,
   additions, changes, patch}`), which the generator's own shape check
   refuses, and each item carries the file's whole patch, which makes a
   full-PR capture too large to hand through. Meanwhile the record already
   derives `artifact.patch` from git over `base...head`. Two sources for
   one fact, and the weaker one won.
2. **The judge's model and effort are asserted, not established, and pinned
   to a named tier rather than to the strongest one.** The agent definition
   says `model: fable`; the guard's refusal text says to pass
   `model: "fable"`; the effort is not declared at all, so the judge
   silently inherits whatever the dispatching session runs at; and no
   verdict receipt records either. "It ran at the strongest tier, thinking
   hard" is probably true and provable nowhere.
3. **The record is too narrow to check conformance.** Each finding is a
   400-character excerpt; the approved plan's oracle sections, the tier's
   decline citation (the machinery threat model), and the finding's full
   text are absent. Phase 1b needs all three, and the issue's *Never*
   list forbids sourcing any of them from the builder's prose.

## Direction

#36 — the strongest available model as a third set of eyes. This increment
makes true: **the adjudicator's only input is derived from one source per
fact, names the model and effort the dispatch actually declared, and carries
the artifacts a conformance judgement needs.**

## Product Intent

After this increment, an adjudication record's artifact size, file set,
territory and patch agree by construction; the judge's model tracks the
strongest tier available to this account without a code change, its
reasoning effort is declared rather than inherited, and both are stamped on
every verdict receipt from a mechanically-derived source; and the record
carries the approved plan's oracle sections at their approved commit, the
tier's decline citation, and each finding's full reviewer-authored text,
under a stated input budget. No rubric, role, or dispatch point changes.

## Must Not Change

- The adjudicator reads only the script-generated record. Nothing in this
  plan adds a channel by which the dispatching session's prose reaches it.
- The four verdicts, their meaning, the write-gate rule, the tier budgets,
  the self-serve leash and the David gate.
- The guard's hook path reads no configuration (threat-model rule 5).
- Existing committed receipts and records remain loadable: `loadLoop` on
  every PR that has receipts today must still return a usable state.
- `.agents/machinery.json`'s required shape. This plan adds no key to it, so
  every enrolled consumer's existing file stays valid unchanged.
- `artifact.patch`'s cap and its record-file exclusion.
- The record's refusal discipline: a fact it cannot establish is a stated
  refusal or a stated `null` with a reason, never a zero.

## Settled Decisions

1. **Artifact facts come from git, over the same range as the patch.**
   `artifact.files/added/removed`, the file set `territory` classifies
   against, and `artifact.patch` are all derived from git over
   `base...head` (the snapshot's `pr.base.sha` and `pr.head.sha`, both
   already required to be present in the clone). One function yields the
   file list; the three consumers read it. Disagreement is then
   unconstructible, not merely tested for.
2. **That file list is lossless, and its parsing rules are stated.**
   (Round 1.) It is read with `--numstat -z --no-renames`: `-z` because a
   path with a space, a quote or a non-ASCII byte is otherwise C-quoted and
   silently mis-compared against a finding's path; `--no-renames` because
   rename detection reports only a rename's destination, which the record's
   existing discovery already disables for the same reason, so a rename
   appears as its add and its delete and both paths are in the set. Binary
   files report `-` for both counts: they carry `added: null, removed:
   null`, are counted in `files`, and are surfaced as `binaryFiles: <n>`
   beside the totals, so a non-zero artifact can never present as zero
   lines without saying why. A count that is neither numeric nor `-` is a
   refusal, not a coerced zero.
3. **An empty artifact against distinct base and head is a refusal.** If
   `base !== head` and the git-derived file set is empty, the generator
   refuses and names the two shas. A PR under review with no diff is not a
   state this machinery meets; the shape signals a wrong base or head.
4. **Size counts exclude the machinery's own record files; territory does
   not.** `files/added/removed` describe the artifact under review, so they
   apply the same exclusion the patch applies. A finding anchored on a
   receipt or record file is nonetheless *inside this PR's diff*, so
   `territory` classifies against the full changed set, including both
   sides of a rename. The record's `territory.note` states this, and the
   size fields state the exclusion, so a reader cannot mistake one for the
   other.
5. **The judge's model is declared once, in its own definition's
   frontmatter, as `best` — the alias that resolves to the strongest model
   available to this account.** Verified against the Claude Code
   documentation (see *External-claim verification*): `best` "uses the
   latest Fable model where it's available to you, otherwise the same model
   as `opus`", and subagent frontmatter accepts the same values as the
   `--model` flag. This is what David asked for on 2026-09-06 — the
   strongest model, tracked without a PR when that changes — and it is
   strictly better than the alias-in-config design this plan carried at
   round 1, because it needs no configuration key at all, tracks *across*
   tiers rather than within one, and degrades to Opus rather than failing
   if Fable is ever unavailable. Consequently **the dispatch passes no
   per-invocation `model`**: this harness's Agent tool exposes `model` as a
   four-alias enum that does not include `best`, so passing anything there
   would override the frontmatter and pin the tier — the exact defect being
   removed. The guard's refusal text and every routing instruction change
   from naming a tier to naming the definition file.
   **Implementation-time verification, with a stated fallback:** the first
   step is an empirical check that this harness accepts `best` in subagent
   frontmatter. If it does not, the value is `fable` and everything else in
   this plan is unchanged — the mechanism is the frontmatter being the
   single declaration, not the particular alias in it.
6. **The judge's reasoning effort is declared in the same frontmatter, not
   inherited.** `effort: xhigh`. Verified: subagent frontmatter accepts
   `low | medium | high | xhigh | max`, overrides the session level,
   inherits it when omitted, and has no per-invocation equivalent. Today
   the adjudicator inherits, so its depth silently tracks the dispatching
   session — an unpinned variable in a judge whose verdicts are audited.
   `xhigh` rather than `max`: the judge's measured failure was applying a
   rule to a situation nobody read, which is a depth failure, and a verdict
   is ~0.1% of a loop's tokens; but `max` is documented as prone to
   overthinking, and on a default-stop rubric overthinking reads as
   manufactured reasons to continue.
7. **The record carries the dispatch declaration, read mechanically from
   the definition file at the reviewed head.** (Round 1, replacing a
   free-text stamp.) `dispatch: {model, effort, source, sha}` is parsed from
   `git show <snapshot head sha>:<definition path>`'s frontmatter — never
   from the working tree, never from anything the session types. The record
   is generated before the dispatch and is the input the verdict cites, so
   this is the same evidence chain every other record field uses.
8. **The receipt's stamps must equal the record's, and the validator
   compares them to the record — not to current configuration.** The
   adjudication receipt carries `modelRequested` and `effortRequested`; the
   validator resolves the `recordPath` the receipt already cites, reads
   that record's `dispatch`, and refuses on any mismatch. A typed, stale or
   invented value is therefore rejected without consulting anything mutable,
   which was the round-1 defect: a non-empty-string check accepts fiction.
   Receipts whose `decidedAt` precedes a cutoff constant named beside the
   validator (the date this plan's PR merges) are read as `null` and pass,
   so no committed receipt is invalidated.
9. **What remains an assertion is named as one.** Nothing observable from
   the harness proves the Agent tool actually served the declared model and
   effort: the tool result carries no model id, and `get_session` describes
   the main session, not a subagent. Decisions 5–8 establish *what the
   dispatch declared*, verifiably and mechanically; they do not establish
   *what ran*. The adjudicator's existing instruction to self-report a
   mismatch stays as best-effort, and this residue is recorded as a known
   gap rather than papered over.
10. **The record gains `planOracle`, sourced from the approved commit, and
    absence is a refusal rather than a null.** (Refusal added round 1.) The
    PR body's *Approved-plan source* line is parsed for a commit sha (the
    single-PR form `final plan commit <sha>`, or the combined form
    `combined plan commit <sha>`). The generator resolves the one
    `docs/plans/PLAN_*.md` at that commit — two or zero is a refusal naming
    the commit — and copies the *Direction*, *Product Intent*, *Must Not
    Change* and *Settled Decisions* sections verbatim, with the sha. The
    body supplies only the pointer; the text comes from the pinned commit,
    which David's approval fixed and the builder cannot revise mid-loop.
    `planOracle: null` is produced **only** when the body positively matches
    one of the permitted no-plan forms — the bugfix tier oracle, the
    verbatim trivial-change form, or the private-path form (a filename plus
    a checksum) — and the reason is stated. A body with no such line, or
    with a line the parser cannot resolve, is a **refusal**: the contract
    treats a missing approved-plan source as a finding in its own right, so
    a record that silently proceeded without the oracle would hide exactly
    the defect phase 1b exists to catch.
11. **The record gains `declineCitation`, tier-selected and read at the
    reviewed head.** (Head-reading added round 1.) For `budget.tier:
    internal` it is the text of
    `.agents/memory/machinery-threat-model-is-my-own-mistakes.md` at
    `snapshot.pr.head.sha`, via `git show` after the commit is validated —
    not from the working tree, because the generator deliberately runs from
    `main` or a stale checkout and would otherwise hand the judge the base
    branch's text while the PR under review changes that very note. For
    `product` and `sensitive` it is `null` with reason `no tier citation in
    phase 1a`.
12. **Each finding item carries `body`: the full text of the finding's root
    comment, reviewer-authored only, under a stated record budget.**
    (Budget added round 1.) The existing `excerpt` field is replaced.
    Thread replies are excluded whoever wrote them — the builder's replies
    are prose the issue's *Never* list forbids, and the reviewer's
    follow-ups add nothing a triage needs. Reviewer identity is the
    existing `REVIEWER_LOGINS` set. Because a long loop can carry many
    findings, the finding text has a **total** budget: bodies are emitted in
    full while the budget lasts, spending it on unresolved findings first
    and then most-recent-first, and any body that does not fit is truncated
    with an explicit per-item marker and counted in a record-level
    `findingsTextTruncated` field. Truncation is therefore always visible
    to the judge and never silent. A refusal was rejected in favour of
    degradation: refusing to build a record is refusing to adjudicate, which
    on a long loop is the worst moment to have no judge.
13. **Measurement counters are *next*, not now.** #36 asks for counters of
    findings pre-empted by B1, defects caught by B2, checks synthesized by
    B3, David decisions changed by a D-role. None of those roles exists
    after this increment, so there is nothing to count. They ship with the
    role they measure, starting with B1 in phase 1b.
14. **No consumer configuration changes.** (Round 1, superseding the
    round-1 `models.adjudicator` config key.) Since the model and effort are
    declared in the agent definition — which is synced payload, not
    consumer-owned configuration — `.agents/machinery.json` keeps its two
    keys, `machinery.template.json` is untouched, `docs/consuming-repos.md`'s
    enrolment example stays correct, and no already-enrolled consumer can be
    left with a permanently-refusing config. The class of defect Codex named
    is dissolved rather than mitigated.
15. **Inventory oracle results** (Preflight, run on `639266f`, re-run at
    round 1):
    - Class 1: 8 lines across 5 files. Post-change, exactly one declarative
      pin remains — the definition's own frontmatter — and it names `best`.
    - Class 2: the broadened case-insensitive sweep adds live routing
      instructions the `model:` oracle missed, confirmed at
      `plan-review-loop/SKILL.md:224` ("dispatch one
      `review-loop-adjudicator` on Fable") and `model-routing/SKILL.md:239`
      ("All adjudication subagents dispatch on Fable — no exceptions"), plus
      the guard's two refusal messages. Every *live routing* hit is rewritten
      to name the definition file rather than a tier; every *historical
      record* hit (a dated decision entry explaining a past choice) is left
      alone, since rewriting history to match present configuration is how a
      decision log stops being evidence. The implementation quotes the
      post-change classification of every hit.
    - Class 3: 6 lines across 2 files (one definition, one comment, one
      import, two call sites, one territory definition).
    - Class 4: 6 lines across 2 files, of which exactly one
      (`review-budget.mjs`'s extension-receipt validator) validates shape;
      the other five read `kind`/`verdict` only and are unaffected by
      additive fields.

## External-claim verification

Checked 2026-09-06 against the current Claude Code documentation
(`code.claude.com/docs/en/sub-agents`, `/model-config`):

- **Model aliases.** `best` "uses the latest Fable model where it's
  available to you, otherwise the same model as `opus`"; `fable` resolves to
  the latest Fable model; `opus`, `sonnet`, `haiku` resolve within their
  tiers; `default` varies by account type. There is no Messages-API-level
  "strongest" alias — this resolution is a Claude Code feature.
- **Subagent `model`.** Frontmatter accepts the same values as the
  `--model` flag (an alias, a full model id, or `inherit`); a per-invocation
  model outranks frontmatter; omitted, resolution is per-invocation, then
  `CLAUDE_CODE_SUBAGENT_MODEL`, then the main conversation's model. In this
  harness the Agent tool's `model` parameter is an enum of four tier aliases
  (`sonnet | opus | haiku | fable`) — read from the live tool schema, not
  the docs — which is why decision 5 passes no per-invocation model.
- **Subagent `effort`.** Frontmatter accepts `low | medium | high | xhigh |
  max`, overrides the session effort level, and inherits it when omitted.
  There is no per-invocation effort parameter and no per-subagent thinking
  setting. The documented default is `high` on every model except Opus 4.7;
  `max` "can improve performance on demanding tasks but may show diminishing
  returns and is prone to overthinking."
- **Model facts** (bundled `claude-api` reference, cached 2026-06-24):
  `claude-fable-5-1` is the most capable generally-available model;
  `claude-mythos-5-1` is the same underlying model behind restricted access.

## Repo Context Inspected

`core/scripts/review-loop-record.mjs` (`changesSince`, `artifactDiff`,
`buildRecord`, `main`, the `--no-renames` discovery rule),
`core/scripts/review-counting.mjs` (`artifactSize`,
`assertMcpSnapshotShape`, `fromMcp`, `REVIEWER_LOGINS`),
`core/scripts/review-budget.mjs` (`machineryConfig`, extension-receipt
validation, the two dispatch refusal messages),
`core/scripts/__tests__/review-loop-record.test.mjs` (the rename
regression), `core/.claude/agents/review-loop-adjudicator.md`,
`core/.claude/skills/model-routing/SKILL.md`,
`core/.claude/skills/plan-review-loop/SKILL.md`,
`core/.agents/machinery.template.json`, `docs/consuming-repos.md`,
`core/.agents/memory/machinery-threat-model-is-my-own-mistakes.md`,
`AGENTS.md` (the five mandated commands), `.agents/adjudications/10-7.json`,
`23-1.json`, `33-1.json`, `.agents/receipts/loop-extension-33-1.json`, the
two live snapshots that produced #28's and #33's records,
`core/.agents/PLANS.md`, `sync-manifest.yml`, `identity-sources.yml`,
issues #34 and #36.

## Current Behavior

- `artifact.files/added/removed` come from `artifactSize(snapshot.files)`;
  `territory` from `findingsByTerritory(findings, snapshot.files)`;
  `artifact.patch` from `git diff base...head`. Records 10-7 and 23-1 show
  real sizes (their snapshots carried files); 28 and 33 show zeros.
- `assertMcpSnapshotShape` requires numeric `deletions` per file and accepts
  an empty array.
- The adjudicator's frontmatter says `model: fable` and declares no effort;
  the guard's refusal text says to pass `model: "fable"`; receipts carry
  neither field.
- Finding items carry a 400-character `excerpt` of the root comment.
- The record has no plan, threat-model, or dispatch content.

## Source-of-Truth Analysis

| Concept | Source of truth after this plan | Duplicate removed |
|---|---|---|
| Artifact size and file set | git, `base...head` | snapshot `files` |
| Artifact patch | git, `base...head` (unchanged) | — |
| Judge's model and effort | the agent definition's frontmatter | hardcoded tier names in refusal text and routing prose |
| What a verdict's dispatch declared | the record's `dispatch`, read from that definition at the reviewed head | — |
| Plan oracle | the plan file at the approved commit | — (the PR body carries only the pointer) |
| Internal-tier decline citation | the threat-model note at the reviewed head | — |
| Finding text | the reviewer's root comment | the 400-char excerpt |

No new source of truth is created, and one configuration surface that the
round-1 draft would have created is not created either (decision 14).

## Proposed Design

**Record generator.** One git-derived file list over `base...head`, parsed
per decision 2, feeds size, territory and patch. Empty-against-distinct-shas
refuses. The snapshot's `files` is ignored and its shape assertion removed.
New top-level fields `dispatch`, `planOracle`, `declineCitation`;
`findings.items[].body` replaces `excerpt`, under the budget of decision 12.
Everything read from the repository is read at `snapshot.pr.head.sha` via
`git show`, never from the working tree. Every new field is either populated
from its named source, or `null` with a stated reason where a decision
permits, or a refusal.

**Model and effort.** The definition declares both. The guard's refusal
text and every live routing instruction name the definition file instead of
a tier. No configuration key is added.

**Receipt stamps.** `modelRequested` and `effortRequested` join the
adjudication receipt and must equal the cited record's `dispatch`.
`pr-ready`'s two-file allowance at exhaustion is unaffected.

## Data Model and Migration Impact

Two JSON shapes change, both append-only for readers:

- Adjudication receipt: two new fields, required past a cutoff and
  validated against the cited record; pre-cutoff receipts unchanged and read
  as `null`. No rewrite of committed receipts.
- Adjudication record: new fields; `excerpt` → `body`. Records are one-shot
  inputs; committed records are never re-read by the machinery, so no
  migration.

Snapshot contract: `files` and `complete.files` become optional-and-ignored.
An old snapshot that carries them still passes. `.agents/machinery.json` is
untouched, so no consumer migration exists.

## Runtime Behavior

- A record built on a correct snapshot for #33's head at `703b230` shows
  `files: 9` (records excluded), non-zero added/removed, `inDiff: 7 /
  outsideDiff: 0`.
- A snapshot whose `pr.base.sha` equals `pr.head.sha`: `artifact` empty and
  allowed — the PR has no diff, which is true. Distinct shas with an empty
  git set: refusal.
- A PR containing a binary file: that file counts in `files`, contributes
  `null` line counts, and appears in `binaryFiles`.
- A PR containing a rename with a finding anchored on the destination: both
  paths are in the set, so the finding classifies `inDiff`.
- An implementation PR whose body cites a plan sha: `planOracle` populated
  with four sections and the sha. A bugfix PR: `planOracle: null`, reason
  `bugfix oracle`. A feature PR whose body omits the line: refusal.
- A record generated from a `main` checkout while the PR edits the
  threat-model note: `declineCitation` carries the PR's version.
- An adjudication dispatch after this merges: no `model` parameter is
  passed; the record's `dispatch` reads `{model: "best", effort: "xhigh"}`
  from the definition at the reviewed head; the receipt repeats both and is
  refused by the guard on any mismatch.

## Admin/User UX Impact

None. Agent-facing machinery only.

## Security, Permissions, and Validation

No authority widens. The record gains read-only content from the clone at a
validated commit. The threat model governs: these are mistake-catchers for
the single operator, not boundaries. This is a gate-script change and
therefore **David-merge-only**.

## Testing Plan

All five mandated repository commands (`AGENTS.md`), run and their results
recorded by the implementation:

```
node --test scripts/__tests__/*.test.mjs
node scripts/check-manifest.mjs
node scripts/check-identity-sources.mjs
node scripts/check-root-wiring.mjs
node scripts/check-settings-fields.mjs
```

Tests prove the invariants, with negatives:

- Size/territory/patch derive from one git list: a fixture PR with a record
  file and two code files yields size that excludes the record, territory
  that includes it, and a patch that excludes it.
- A binary change reports `null` counts and a `binaryFiles` count, never a
  false zero; a non-numeric, non-`-` count refuses.
- A rename with a finding anchored on the destination classifies `inDiff`;
  a path containing a space and a non-ASCII byte round-trips.
- Empty set with distinct shas refuses; equal shas do not.
- A snapshot with `files: []`, with `files` absent, and with old-shape
  files all produce identical records.
- `planOracle`: sha with one plan file → four sections verbatim; two plan
  files → refusal; sha absent → refusal; each permitted no-plan form →
  `null` with its reason; **a feature body with the line omitted or
  malformed → refusal**.
- `declineCitation`: generated from an unrelated checkout while the PR
  changes the note → the PR's text, not the base branch's; `product` tier →
  `null`.
- `body` is the root comment in full; a thread with a builder reply carries
  none of the reply's text; a high-volume fixture (findings whose combined
  text exceeds the budget) truncates deterministically, marks every
  truncated item, sets `findingsTextTruncated`, and never exceeds the
  budget.
- `dispatch` is parsed from the definition at the reviewed head, not the
  working tree.
- Receipt validator: a stamp that disagrees with the cited record refuses,
  with no reference to current configuration; a missing stamp after the
  cutoff refuses; before the cutoff passes.
- The definition's frontmatter declares a model and an effort, and the
  post-sweep class-1/class-2 oracles hold (exactly one declarative pin; no
  live routing instruction names a tier).

Manual QA: regenerate #33's record from a corrected snapshot at `703b230`
and confirm the numbers above.

## Implementation Steps

1. Verify empirically that this harness accepts `best` in subagent
   frontmatter; if not, use `fable` and note it (decision 5).
2. Git-derived file list with decision 2's parsing rules; size/territory/
   patch consume it; refusal on empty-against-distinct; retire snapshot
   `files`.
3. `planOracle`, `declineCitation`, `body` + budget, `dispatch` — all read
   at the reviewed head.
4. Receipt stamps and the record-comparing validator with its cutoff.
5. Definition frontmatter; sweep classes 1 and 2 with their classification.
6. Tests; the five mandated commands; regenerate #33's record.

## Risks and Mitigations

- **`best` may not be accepted in subagent frontmatter.** Step 1 checks it
  before anything depends on it; the fallback keeps the mechanism.
- **`best` could resolve to a *cheaper* model if Fable became unavailable.**
  That is the documented fallback to Opus, and it is the correct failure:
  the judge still runs, at the best tier that exists. `dispatch` records
  what was declared, so an audit can see which alias was in force.
- **A wider record costs tokens.** Plan oracle sections and the threat model
  add perhaps 10–20k tokens; decision 12's budget bounds the finding text.
  The patch cap is unchanged.
- **`xhigh` costs more per verdict.** Perhaps 1.5–2x the judge's own tokens,
  on a dispatch that is ~0.1% of the loop. Accepted; visible at
  `/maintenance` alongside verdict counts.
- **The alias hides which release actually ran.** `dispatch` records the
  alias, not a resolved model id, and nothing observable reports the served
  model (decision 9). Accepted, and recorded as a gap rather than claimed
  as solved.
- **Parsing the PR body for the plan sha depends on the body's format.** The
  format is contract-fixed; a body that does not match refuses rather than
  guessing (decision 10).

## Questions for David

None. The one product-shaped choice — tracking the strongest tier versus
pinning a model id — was settled by David on 2026-09-06, and round 1 found a
mechanism (`best`) that serves it better than the one this plan first
proposed.

## Definition of Done

- [ ] A record built for #33's head shows non-zero size and `inDiff: 7`.
- [ ] A snapshot with empty `files` no longer yields zeros; distinct shas
      with an empty git set refuses; binary and rename cases behave per
      decision 2.
- [ ] `planOracle`, `declineCitation`, `dispatch`, `findings.items[].body`
      present, with refusals where a decision requires one.
- [ ] The finding-text budget holds on a high-volume fixture, with
      truncation marked.
- [ ] The definition declares model and effort; class-1 and class-2 oracles
      re-run and quoted in the PR body.
- [ ] New adjudication receipts refuse on a stamp that disagrees with the
      cited record; every pre-existing receipt still loads.
- [ ] `.agents/machinery.json` and the enrolment docs are unchanged.
- [ ] All five mandated commands pass, with output recorded.
