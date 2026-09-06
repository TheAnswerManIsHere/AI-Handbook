# Plan: Fable review foundations — a record that cannot lie about the artifact, a judge whose model is named in one place and stamped on every verdict, and a record wide enough to check conformance

Workstream: #36, phase 1a (foundations). Prerequisite for phase 1b (B1
conformance triage) and every later phase. Fixes #34 gap 2.

## Preflight

**Increment test.** #36 is the direction ("every judgement that would
otherwise rest on one actor's word gets a Fable dispatch" — a universal
quantifier). This plan is one increment: it changes what the existing
adjudicator *reads* and how its model is *chosen and recorded*. It adds no
role, no rubric, no new dispatch point. B1 (a rubric change) is the next
increment and is not in this document.

**Affected-surface inventory.** Three classes, each with a mechanical oracle,
results recorded under *Settled Decisions*:

1. Every place the judge's model is named in prose or code:
   `git grep -n -i 'model: *"\?fable' -- core/ .claude/` — the agent
   definition frontmatter, the guard's refusal text in `review-budget.mjs`
   and its test, the `pr-watch` skill, and the synced `claude-core.md`
   contract.
2. Every consumer of `artifact.files/added/removed` and `territory`:
   `git grep -n 'artifactSize\|findingsByTerritory\|derived.files'` —
   `review-loop-record.mjs` (two call sites), `review-counting.mjs`
   (definition), their tests.
3. Every validator of an `adjudication`-kind extension receipt:
   `git grep -n 'kind === "adjudication"'` — `review-budget.mjs` only.

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
2. **The judge's model is asserted, not established.** The agent definition
   says `model: fable`, the guard's refusal text says to pass
   `model: "fable"`, and no verdict receipt records what was requested.
   "It is using 5.1" is probably true and provable nowhere.
3. **The record is too narrow to check conformance.** Each finding is a
   400-character excerpt; the approved plan's oracle sections, the tier's
   decline citation (the machinery threat model), and the finding's full
   text are absent. Phase 1b needs all three, and the issue's *Never*
   list forbids sourcing any of them from the builder's prose.

## Direction

#36 — Fable as a third set of eyes. This increment makes true: **the
adjudicator's only input is derived from one source per fact, names the
model requested for the verdict, and carries the artifacts a conformance
judgement needs.**

## Product Intent

After this increment, an adjudication record's artifact size, file set,
territory and patch agree by construction; every adjudication receipt
states which model was requested; and the record carries the approved
plan's oracle sections at their approved commit, the tier's decline
citation, and each finding's full reviewer-authored text. No rubric, role,
or dispatch point changes.

## Must Not Change

- The adjudicator reads only the script-generated record. Nothing in this
  plan adds a channel by which the dispatching session's prose reaches it.
- The four verdicts, their meaning, the write-gate rule, the tier budgets,
  the self-serve leash and the David gate.
- The guard's hook path reads no configuration (threat-model rule 5). The
  model alias is resolved off the hook path only.
- Existing committed receipts and records remain loadable: `loadLoop` on
  every PR that has receipts today must still return a usable state.
- `artifact.patch`'s cap and its record-file exclusion.
- The record's refusal discipline: a fact it cannot establish is a stated
  refusal or a stated `null` with a reason, never a zero.

## Settled Decisions

1. **Artifact facts come from git, over the same range as the patch.**
   `artifact.files/added/removed`, the file set `territory` classifies
   against, and `artifact.patch` are all derived from `git` over
   `base...head` (the snapshot's `pr.base.sha` and `pr.head.sha`, both
   already required to be present in the clone). One function yields the
   file list; the three consumers read it. Disagreement is then
   unconstructible, not merely tested for.
2. **The snapshot's `files` array is retired from the contract.** It is
   neither required nor read. `complete.files` is no longer required.
   Rationale: the MCP channel cannot supply it faithfully (Problem 1), and
   the git range supersedes it. `reviews`, `reviewThreads`,
   `issueComments` and their `complete` flags are unchanged.
3. **An empty artifact against distinct base and head is a refusal.** If
   `base !== head` and the git-derived file set is empty, the generator
   refuses and names the two shas. A PR under review with no diff is not a
   state this machinery meets; the shape signals a wrong base or head.
4. **Size counts exclude the machinery's own record files; territory does
   not.** `files/added/removed` describe the artifact under review, so they
   apply the same exclusion the patch applies. A finding anchored on a
   receipt or record file is nonetheless *inside this PR's diff*, so
   `territory` classifies against the full changed set. The record's
   `territory.note` states this.
5. **The judge's model is named once, as a harness tier alias, in
   `.agents/machinery.json` (`models.adjudicator`), and the dispatch
   passes that value per invocation.** Verified against the Claude Code
   documentation (see *External-claim verification*): a per-invocation
   `model` outranks frontmatter; the Agent tool's `model` parameter
   accepts tier aliases only (`sonnet | opus | haiku | fable`); frontmatter
   accepts aliases or full ids. So the alias is the only shape that can
   travel from config through the dispatch. This is David's stated
   preference (2026-09-06): the strongest available tier, tracked without a
   PR when the tier's current release moves. What the alias does **not**
   do: cross a tier boundary. A new tier above Fable is a one-line config
   change plus a frontmatter change, and this plan makes that the whole
   cost. The frontmatter keeps `model: fable` as the fallback for a
   dispatch that passes nothing; a test asserts the frontmatter alias
   equals the template's `models.adjudicator`.
5a. **The judge's reasoning effort is declared in its frontmatter, not
   inherited.** Verified against the Claude Code documentation (see
   *External-claim verification*): a subagent definition accepts
   `effort: low | medium | high | xhigh | max`, which overrides the session
   level; omitted, it inherits the session's; the Agent tool call has no
   per-invocation effort parameter. Today the adjudicator inherits, so its
   depth silently tracks whatever effort the dispatching session happens
   to run at — an unpinned variable in a judge whose verdicts are audited.
   This plan declares `effort: xhigh`. Rationale: the judge's measured
   failure was applying a rule to a situation nobody read, a depth
   failure; a verdict is ~0.1% of a loop's tokens, so doubling its
   thinking is cheap where it pays; and `max` is documented as prone to
   overthinking, which on a default-stop rubric would read as
   manufactured reasons to continue. The frontmatter is the single source
   (the dispatch cannot override it), so no config key duplicates it.
6. **Every adjudication receipt carries `modelRequested` and
   `effortRequested`.** `modelRequested` is the alias read from config at
   dispatch time; `effortRequested` is the frontmatter's `effort` value,
   read by the `check` CLI from the definition file and printed beside the
   model. The validator applies the same cutoff rule to both. The receipt validator
   refuses an adjudication receipt without a non-empty string
   `modelRequested` and `effortRequested` when its `decidedAt` is on or after a named cutoff
   constant beside the validator (the date this plan's PR merges); earlier
   receipts read as `modelRequested: null`. The validator does not compare
   the stamp to current config, because config may legitimately change
   between dispatch and a later read.
7. **The served model is not observable from the harness, and the plan
   says so rather than pretending.** The Agent tool result carries no model
   id; `get_session` reports the main session's model, not a subagent's.
   `modelRequested` records the request. The adjudicator's existing
   instruction to self-report a mismatch stays as best-effort. This is a
   recorded gap, not a solved property.
8. **The hook path names the config key, never the value.** The guard's
   refusal text currently hardcodes `model: "fable"`; after this plan it
   says to pass the alias named by `.agents/machinery.json`
   `models.adjudicator`. The `check` CLI and the record generator, which
   already read config for `repo`, resolve and print the actual value.
   Missing `models.adjudicator` fails closed there with a message naming
   the key, matching how `repo` and `requiredChecks` fail.
9. **The record gains `planOracle`, sourced from the approved commit.** The
   PR body's *Approved-plan source* line is parsed for a commit sha (the
   single-PR form `final plan commit <sha>`, or the combined form
   `combined plan commit <sha>`). The generator resolves the one
   `docs/plans/PLAN_*.md` at that commit (two or zero is a refusal naming
   the commit) and copies the *Direction*, *Product Intent*, *Must Not
   Change* and *Settled Decisions* sections verbatim, with the sha. The
   body supplies only the pointer; the text comes from the pinned commit,
   which David's approval fixed and the builder cannot revise mid-loop.
   A body stating `n/a — no plan`, a bugfix-tier oracle, or no such line
   yields `planOracle: null` with the reason stated. A sha absent from
   the clone is a refusal ("fetch the plan-review branch"). The private
   path's filename-plus-checksum form yields `null` with reason `private
   path`.
10. **The record gains `declineCitation`, tier-selected.** For
    `budget.tier: internal` it is the verbatim text of
    `.agents/memory/machinery-threat-model-is-my-own-mistakes.md`, read
    from the working tree at the record's own commit. For `product` and
    `sensitive` it is `null` with reason `no tier citation in phase 1a` —
    `decisions.md` is consumer-owned and large; including it is a *next*
    for the phase that defines product-tier declines.
11. **Each finding item carries `body`: the full text of the finding's
    root comment, reviewer-authored only.** The existing `excerpt` field is
    replaced. Thread replies are excluded whoever wrote them — the builder's
    replies are prose the issue's *Never* list forbids, and the reviewer's
    follow-ups add nothing a triage needs. Reviewer identity is the
    existing `REVIEWER_LOGINS` set. Bodies are not truncated; the record's
    only cap remains the patch cap.
12. **Measurement counters are *next*, not now.** #36 asks for counters of
    findings pre-empted by B1, defects caught by B2, checks synthesized by
    B3, David decisions changed by a D-role. None of those roles exists
    after this increment, so there is nothing to count. They ship with the
    role they measure, starting with B1 in phase 1b.
13. **`machinery.template.json` seeds `models.adjudicator: "fable"`.** The
    template is seed-mode; an enrolled consumer edits its own
    `machinery.json`. Overhype.me's copy gains the key as a one-line
    consumer follow-up, noted in the implementation PR body.
14. **Inventory oracle results** (Preflight, run on `639266f`): class 1
    found 8 lines across 5 files (`claude-core.md`,
    `review-loop-adjudicator.md`, `pr-watch/SKILL.md`, `review-budget.mjs`,
    `review-budget.test.mjs`); class 2 found 6 lines across 2 files (one
    definition, one comment, one import, two call sites, one territory
    definition); class 3 found 6 lines across 2 files, of which exactly one
    (`review-budget.mjs`, the extension-receipt validator) validates a
    receipt's shape — the other five read `kind`/`verdict` only and are
    unaffected by an additive field. The implementation sweeps class 1 to a
    post-change count of exactly one (the frontmatter fallback) and quotes
    the re-run in its PR body.

## External-claim verification

Checked 2026-09-06 against the current Claude Code documentation
(`code.claude.com/docs/en/sub-agents`, `/model-config`, `/settings`):

- Subagent frontmatter `model` accepts the aliases `sonnet`, `opus`,
  `haiku`, `fable`, a full model id, or `inherit`; omitted, resolution is
  per-invocation parameter, then `CLAUDE_CODE_SUBAGENT_MODEL`, then the
  main conversation's model. The per-invocation parameter outranks the
  frontmatter. In this harness the Agent tool's `model` parameter is an
  enum of the four aliases (read from the tool schema, not the docs).
- Subagent frontmatter `effort` accepts `low`, `medium`, `high`, `xhigh`,
  `max`, overrides the session level, and inherits it when omitted. There
  is no per-invocation effort parameter and no per-subagent thinking
  setting. Default effort is `high` on Fable 5.1; `max` "may show
  diminishing returns and is prone to overthinking".
- Anthropic model facts (claude-api skill reference, cached 2026-06-24, and
  the session's own model context): `claude-fable-5-1` is the most capable
  generally available model; `claude-mythos-5-1` is the same underlying
  model with restricted access; no "latest" or "strongest" alias exists
  in the Messages API.

## Repo Context Inspected

`core/scripts/review-loop-record.mjs` (`changesSince`, `artifactDiff`,
`buildRecord`, `main`), `core/scripts/review-counting.mjs` (`artifactSize`,
`assertMcpSnapshotShape`, `fromMcp`, `REVIEWER_LOGINS`),
`core/scripts/review-budget.mjs` (`machineryConfig`, extension-receipt
validation, `refusal`), `core/.claude/agents/review-loop-adjudicator.md`,
`core/.agents/machinery.template.json`,
`core/.agents/memory/machinery-threat-model-is-my-own-mistakes.md`,
`.agents/adjudications/10-7.json`, `23-1.json`, `33-1.json`,
`.agents/receipts/loop-extension-33-1.json`, the two live snapshots that
produced #28's and #33's records, `core/.agents/PLANS.md`,
`core/.claude/skills/plan-review-loop/SKILL.md`, `sync-manifest.yml` and
`identity-sources.yml` (adjudicator touchpoints), issues #34 and #36.

## Current Behavior

- `artifact.files/added/removed` come from `artifactSize(snapshot.files)`;
  `territory` from `findingsByTerritory(findings, snapshot.files)`;
  `artifact.patch` from `git diff base...head`. Records 10-7 and 23-1 show
  real sizes (their snapshots carried files); 28 and 33 show zeros.
- `assertMcpSnapshotShape` requires numeric `deletions` per file and accepts
  an empty array.
- The adjudicator's frontmatter says `model: fable`; the guard's refusal
  text says to pass `model: "fable"`; receipts carry no model field.
- Finding items carry a 400-character `excerpt` of the root comment.
- The record has no plan, threat-model, or decisions content.

## Source-of-Truth Analysis

| Concept | Source of truth after this plan | Duplicate removed |
|---|---|---|
| Artifact size and file set | git, `base...head` | snapshot `files` |
| Artifact patch | git, `base...head` (unchanged) | — |
| Judge's model alias | `.agents/machinery.json` `models.adjudicator` | hardcoded strings in refusal text and skills |
| Model actually requested for a verdict | the receipt's `modelRequested` | — |
| Plan oracle | the plan file at the approved commit | — (the PR body carries only the pointer) |
| Internal-tier decline citation | the threat-model memory note | — |
| Finding text | the reviewer's root comment, in full | the 400-char excerpt |

No new source of truth is created. The frontmatter alias is a fallback, not
a second source: the test in decision 5 pins it to the template.

## Proposed Design

**Record generator.** One git-derived file list over `base...head`
(numstat, with the record-file exclusion applied for size, unapplied for
territory) feeds size, territory and patch. Empty-against-distinct-shas
refuses. The snapshot's `files` is ignored and its shape assertion removed.
New top-level fields `planOracle`, `declineCitation`; `findings.items[].body`
replaces `excerpt`. Every new field is either populated from its named
source or `null` with a stated reason; a source that should resolve but
cannot (sha absent, ambiguous plan file) refuses the whole record, matching
the generator's existing discipline.

**Model naming.** `machineryConfig` exposes `models.adjudicator`; the
`check` CLI's dispatch instruction and the record's `provenance` print it.
The hook-path refusal names the key. The adjudicator definition's "You run
on Fable" section is rewritten to say the model is the alias config names,
the dispatch passes it, and the receipt records it.

**Receipt stamp.** `modelRequested` joins the adjudication receipt; the
validator enforces it past the cutoff. `pr-ready`'s two-file allowance at
exhaustion is unaffected (the receipt is still one file).

## Data Model and Migration Impact

Two JSON shapes change, both append-only for readers:

- Adjudication receipt: new required field past a cutoff; pre-cutoff
  receipts unchanged and read as `null`. No rewrite of committed receipts.
- Adjudication record: new fields; `excerpt` → `body`. Records are one-shot
  inputs; committed records are never re-read by the machinery, so no
  migration.

Snapshot contract: `files` and `complete.files` become optional-and-ignored.
An old snapshot that carries them still passes.

## Runtime Behavior

- A record built on a correct snapshot for #33's head at `703b230` shows
  `files: 9` (records excluded), non-zero added/removed, `inDiff: 7 /
  outsideDiff: 0`.
- A snapshot whose `pr.base.sha` equals `pr.head.sha`: `artifact` empty and
  allowed (no refusal) — the PR has no diff, which is true. Distinct shas
  with an empty set: refusal.
- An implementation PR whose body cites a plan sha: `planOracle` populated
  with four sections and the sha. A bugfix PR: `planOracle: null`, reason
  `bugfix oracle`.
- An adjudication dispatch after this merges: the `check` CLI prints
  `pass model: "<alias from config>"`; the receipt I write carries
  `modelRequested: "<alias>"`; a receipt without it is refused by the guard
  on the next review request with a message naming the field.
- A consumer whose `machinery.json` lacks `models`: the record generator
  and `check` refuse with the key named; the hook is unaffected.

## Admin/User UX Impact

None. Agent-facing machinery only.

## Security, Permissions, and Validation

No authority widens. The record gains read-only content from the clone. The
threat model governs: these are mistake-catchers for the single operator,
not boundaries. This is a gate-script change and therefore
**David-merge-only**.

## Testing Plan

`node --test core/scripts/__tests__/` (the repo's runner). Tests prove the
invariants, with negatives:

- Size/territory/patch derive from one git list: a fixture PR with a record
  file and two code files yields size that excludes the record, territory
  that includes it, and a patch that excludes it.
- Empty set with distinct shas refuses; equal shas do not.
- A snapshot with `files: []`, with `files` absent, and with old-shape
  files all produce identical records.
- `planOracle`: sha with one plan file → four sections verbatim; two plan
  files → refusal; sha absent → refusal; `n/a — no plan` → `null`.
- `declineCitation`: `internal` → the note's text; `product` → `null`.
- `body` is the root comment in full; a thread with a builder reply carries
  none of the reply's text.
- Receipt validator: missing `modelRequested` or `effortRequested` after
  the cutoff refuses; before it passes; empty string refuses.
- Frontmatter `effort` is `xhigh` (a test reads the definition file).
- Frontmatter alias equals the template's `models.adjudicator`.
- `check-identity-sources` and `check-manifest` pass with the new
  touchpoints classified.

Manual QA: regenerate #33's record from a corrected snapshot at `703b230`
and confirm the numbers above.

## Implementation Steps

1. Git-derived file list; size/territory/patch consume it; refusal on
   empty-against-distinct; retire snapshot `files`.
2. `planOracle`, `declineCitation`, `body`.
3. `models.adjudicator` in config, template, `check` output, record
   provenance, hook-path key naming; sweep class 1.
4. `modelRequested` in the receipt and its validator with the cutoff.
5. Adjudicator definition and the skills' dispatch text; consuming-repos
   enrolment step; manifest and identity-source classification.
6. Tests; regenerate #33's record as the manual check.

## Risks and Mitigations

- **A wider record costs tokens.** Plan oracle sections and the threat
  model add perhaps 10–20k tokens. Accepted per #36's cost arithmetic; the
  patch cap is unchanged.
- **`xhigh` costs more per verdict.** Perhaps 1.5–2x the judge's own
  tokens, on a dispatch that is ~0.1% of the loop. Accepted; measured at
  `/maintenance` alongside verdict counts.
- **The alias silently moves within a tier.** A future `fable` release
  changes the judge without a PR. `modelRequested` records the alias, not
  the resolved id, so an audit cannot tell 5.1 from 5.2 verdicts apart.
  Accepted by David's stated preference; noted as a gap.
- **Parsing the PR body for the plan sha depends on the body's format.** The
  format is contract-fixed in `CLAUDE.md` PR rule 4; a body that does not
  match yields `null` with reason, never a wrong plan.

## Questions for David

None. The one product-shaped choice — alias tracking versus a pinned id —
was settled by David on 2026-09-06 and is decision 5.

## Definition of Done

- [ ] A record built for #33's head shows non-zero size and `inDiff: 7`.
- [ ] A snapshot with empty `files` no longer yields zeros; distinct shas
      with an empty git set refuses.
- [ ] `planOracle`, `declineCitation`, `findings.items[].body` present with
      the stated null reasons where applicable.
- [ ] `models.adjudicator` in config and template; no hardcoded `fable`
      remains in class-1 sites except the frontmatter fallback (oracle
      re-run quoted in the PR).
- [ ] New adjudication receipts refuse without `modelRequested` and
      `effortRequested`; every pre-existing receipt still loads.
- [ ] The adjudicator definition declares `effort: xhigh`.
- [ ] Tests pass; manifest and identity-source checks pass.
- [ ] The consumer follow-up (Overhype.me `machinery.json` key) is named
      in the PR body's post-merge section.
