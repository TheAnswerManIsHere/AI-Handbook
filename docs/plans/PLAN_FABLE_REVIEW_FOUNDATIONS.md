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
4. **Every consumer that validates or honours an `adjudication`-kind
   receipt** — `git grep -nE 'kind (===|!==) "adjudication"'`, each hit
   classified *shape validator*, *state reader*, or *independent honourer*.
   Corrected at round 2: the round-1 oracle tested only `===` and so missed
   `pr-ready.mjs`'s `!==` guard, which independently accepts a terminal
   receipt on the merge gate without calling the review-budget validator.

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

1. **Artifact facts come from git, over the same range as the patch, and
   both endpoints are validated first.** `artifact.files/added/removed`, the
   file set `territory` classifies against, and `artifact.patch` are all
   derived from git over `base...head` (the snapshot's `pr.base.sha` and
   `pr.head.sha`). **Correcting a round-1 claim:** those shas are *not*
   already required — `assertAdjudicationSnapshot` validates the PR number,
   repository and capture metadata but neither sha; `changesSince` validates
   the head only, for its own separate range; and `artifactDiff` deliberately
   returns an "unavailable" marker rather than failing when an endpoint is
   missing. That tolerance was harmless while the file list came from the
   snapshot; it is not harmless once the same range is authoritative for
   size and territory. So both endpoints are explicitly validated as full,
   resolvable commits before the shared list is derived, with a refusal
   naming which one failed — never a silent empty list from an incidental
   git failure. One function yields the
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
   **Implementation-time verification, with a parameterized fallback:** the
   first step is an empirical check that this harness accepts `best` in
   subagent frontmatter. If it does not, the declared value is `fable`.
   (Round 2.) Everything downstream is written against **the empirically
   selected alias**, not against the literal `best`: the class-1 oracle
   asserts exactly one declarative pin naming *that* alias, the runtime
   fixture asserts `dispatch.model` equals *that* alias, and the Definition
   of Done reads the same way — so the fallback cannot produce an
   implementation that fails the plan's own acceptance checks. The fallback
   path gets its own test: with `best` unavailable, a `fable` declaration
   and its stamps are accepted. The mechanism under review is the
   frontmatter being the single declaration, not the particular alias in
   it.
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
   the definition file at the reviewed head, through a layout-aware
   resolver.** (Round 1; the resolver added round 2.)
   `dispatch: {model, effort, source, sha}` is parsed from the agent
   definition's frontmatter at `snapshot.pr.head.sha` — never from the
   working tree, never from anything the session types. The record is
   generated before the dispatch and is the input the verdict cites, so this
   is the same evidence chain every other record field uses.
   **The resolver is not a bare `git show <head>:<consumer path>`**, because
   the two layouts this machinery runs in disagree about where payload
   lives: in the handbook, `.claude/agents/review-loop-adjudicator.md` is a
   **symlink** (mode `120000`, whose blob is the target path text, not
   frontmatter) and the tracked source is `core/.claude/agents/…`; in an
   assembled consumer the same path is a regular file and no `core/` prefix
   exists. So every head-pinned payload read goes through one resolver that
   (a) reads the tree entry's **mode**, (b) follows a `120000` entry's
   target relative to the link's directory, refusing a target that escapes
   the repository or a chain deeper than one link, and (c) if the consumer
   path is absent entirely, retries once under the `core/` prefix. A path
   that resolves in neither layout is a refusal naming both attempts. This
   applies equally to `declineCitation` (decision 11), whose consumer path
   `.agents/memory/machinery-threat-model-is-my-own-mistakes.md` does not
   exist in the handbook at all — its tracked source is `core/.agents/…`.
8. **The receipt's stamps must equal the record's, and the validator
   compares them to the record — not to current configuration.** The
   adjudication receipt carries `modelRequested` and `effortRequested`; the
   validator resolves the `recordPath` the receipt already cites, reads
   that record's `dispatch`, and refuses on any mismatch. A typed, stale or
   invented value is therefore rejected without consulting anything mutable,
   which was the round-1 defect: a non-empty-string check accepts fiction.
   **Compatibility is decided by the cited record's schema, not by a date.**
   (Round 2, replacing a cutoff constant.) A receipt must carry the stamps
   **iff the record it cites carries `dispatch`**; a receipt citing a
   pre-`dispatch` record is legacy and passes without them. A date cannot
   work here: this plan-review PR never merges, so it has no merge date, and
   the implementation PR cannot know its own merge date in advance — every
   receipt written while that PR is itself under review would classify as
   legacy, which is precisely the window the validator most needs to cover.
   A date would also let a receipt with a copied-forward `decidedAt` bypass
   the comparison, which is the operator mistake this validator exists to
   catch. Keying on the record's schema is durable evidence and cannot be
   backdated.
8a. **The merge gate validates the stamps too.** (Round 2.)
   `pr-ready.mjs` recognises a terminal adjudication receipt through its own
   `receipt.kind !== "adjudication"` guard and honours it without calling
   `validateExtension`, so a receipt whose stamps disagree with its record
   could be refused by the review-budget guard and still produce readiness.
   The stamp comparison of decision 8 therefore belongs to **both**
   validators, with the merge gate performing the same record-derived check
   against the committed record the receipt cites.
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
    `combined plan commit <sha>`). The generator resolves **the plan file the cited
    commit itself introduced or modified** — `git diff-tree` against that
    commit's parent, restricted to `docs/plans/PLAN_*.md` — rather than
    every plan file present at that commit, because a repository may
    legitimately retain an older plan on `main` (the loop permits it when
    David asks), which would make an "exactly one file present" rule refuse
    every future plan. Zero or two *introduced* plan files is a refusal
    naming the commit; a pointer carrying an explicit path uses it directly.
    It then copies the *Direction*, *Product Intent*, *Must Not Change* and
    *Settled Decisions* sections verbatim, with the sha. The
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
10a. **A `[PLAN REVIEW]` loop is its own positive form, and its oracle is
    the plan file at the reviewed head.** (Round 2. Without this, decision
    10's refusal would deadlock every plan-review loop — including the one
    reviewing this plan — because a plan under review has no approved-plan
    source by definition: it is not approved yet, and the loop's own
    template has no such field.) The mode is detected from the PR body's
    `## Review mode` / "Plan review only" declaration, which that template
    makes mandatory. In that mode `planOracle` carries
    `{mode: "plan-review", sha, path, sections}` — the same four sections,
    read from the plan file the PR introduces, at `snapshot.pr.head.sha`,
    through the same layout-aware resolver. That is the right oracle for the
    mode: on a plan loop the plan file *is* the artifact, which the
    adjudicator contract already says when it classifies `docs/plans/` as
    its own behavioral class. A PR declaring plan review that introduces no
    plan file is a refusal.
11. **The record gains `declineCitation`, tier-selected and read at the
    reviewed head.** (Head-reading added round 1.) For `budget.tier:
    internal` it is the text of
    `.agents/memory/machinery-threat-model-is-my-own-mistakes.md` at
    `snapshot.pr.head.sha`, through decision 7's layout-aware resolver after
    the commit is validated — not from the working tree, because the generator deliberately runs from
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
    existing `REVIEWER_LOGINS` set. The budget that bounds this text is
    decision 12a's, not a per-field one, because the finding bodies are not
    the only variable-length content in the record.
12a. **Every variable-length field in the record is bounded, and any
    truncation is visible.** (Round 1. The finding bodies were the reported
    instance; the class is "content in the judge's single input whose size
    is set by something other than this plan".) That content is exactly
    `artifact.patch` (already capped), `findings.items[].body`, and
    `planOracle`'s four sections — a plan file has no size limit either, so
    capping only the finding text would move the same defect one field over.
    The caps are **numeric and stated here**, not left to the implementer:
    `artifact.patch` keeps its existing cap; `findings.items[].body` gets a
    **200,000-character total** across all findings; `planOracle`'s sections
    get **80,000 characters** in total; `declineCitation` gets **40,000**.
    Above those sits a **total serialized-record cap of 600,000 characters**
    — measured on the exact JSON that is written and handed to the judge,
    after every per-field cap has been applied, so no combination of fields
    (including the ones that are variable but not capped individually, such
    as `sinceLastReview.files` and per-finding path metadata) can exceed it.
    If the serialized record still exceeds the total, the same priority
    order sheds further finding text until it fits, and the record says so.
    The numbers are chosen to sit an order of magnitude under a 1M-token
    context at ~4 characters per token while leaving the judge's own
    reasoning room; they are constants in one place, so moving them is a
    one-line change with a test. The record carries one `truncation` object
    naming every field that was cut, by how much, and the total serialized
    size actually emitted. Within the finding text
    the cap is spent on unresolved findings first, then most-recent-first;
    within `planOracle` an over-long section is cut at its end with an
    explicit marker, never dropped silently. `declineCitation` is a fixed
    repository file, bounded by that file. Refusal was rejected in favour of
    visible degradation: refusing to build a record is refusing to
    adjudicate, which on a long loop is the worst moment to have no judge.
12b. **The phase-scope selector is *next*, with its reason.** (Round 2.)
    `pr-docs` requires a phase PR's oracle to name which parent-plan
    sections that phase delivers and which it defers, and `planOracle` as
    specified carries the whole approved plan without that selector — so a
    conformance judge could not tell a deliberately deferred requirement
    from a silently dropped one. The finding is correct and its fix needs a
    **new mechanical source** for phase scope (the parent issue's Phases
    checklist is the only candidate, and it is not in the snapshot), which
    is a scope addition: by the now/next/never rule it defaults to *next*,
    and it belongs with phase 1b, whose rubric is the first consumer of
    `planOracle` at all. Nothing in phase 1a reads the field, so deferring
    it costs no correctness here. Recorded so 1b starts from it rather than
    rediscovering it.
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
14a. **Every canonical receipt *producer* is updated, not just the
    validators.** (Round 2.) The affected-surface inventory covered
    validators and missed the places that teach an operator what to write:
    `core/.agents/receipts/README.md`'s canonical adjudication JSON and the
    two refusal recipes in `review-budget.mjs` that enumerate the fields to
    copy into a receipt. Making the stamps mandatory while those recipes
    still omit them would teach consumers to write receipts that fail
    validation. A fifth inventory class covers producers —
    `git grep -nE '"kind": ?"adjudication"|kind.*adjudication.*verdict'`
    over docs, READMEs and refusal strings — and every live recipe gains the
    stamps; an example that is deliberately historical is marked as such
    rather than silently updated.
15. **Inventory oracle results** (Preflight, run on `639266f`, re-run at
    round 1):
    - Class 1: 8 lines across 5 files. Post-change, exactly one declarative
      pin remains — the definition's own frontmatter — and it names `best`.
    - Class 2: `git grep -n -i 'fable' -- core/ .claude/` returns **111**
      hits; narrowed to the adjudicator-dispatch class (the same grep
      filtered to lines also naming *adjudicat*/*judge*, since a mention of
      the tier in a session-routing rule is a different subject) it returns
      **35**. The `model:` oracle of class 1 missed most of them, including
      the two live instructions Codex named — `plan-review-loop/SKILL.md:224`
      ("dispatch one `review-loop-adjudicator` on Fable") and
      `model-routing/SKILL.md:239-241` ("All adjudication subagents dispatch
      on Fable — no exceptions") — plus `pr-watch/SKILL.md:212`,
      `claude-core.md:650,665`, and the guard's two refusal messages at
      `review-budget.mjs:1575-1576,1607`. Every hit is classified at
      implementation time as **live routing** (an agent would act on it →
      rewritten to name the definition file rather than a tier),
      **historical record** (a dated decision entry explaining a past
      choice → left alone, because rewriting history to match present
      configuration is how a decision log stops being evidence), or
      **coupled assertion**. The third category is a round-1 discovery worth
      naming: `scripts/check-contract-consistency.mjs:141,150` asserts the
      literal phrase "internal: budget 3, Fable-adjudicated leash to 6"
      against the contract text, so a live-routing rewrite that ignored it
      would turn a passing CI check red for a reason unrelated to the
      change. It is in scope, and the implementation quotes the post-change
      classification of all 35 hits.
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

- Adjudication receipt: two new fields, required exactly when the record
  the receipt cites carries `dispatch`, and validated against that record.
  A receipt citing a pre-`dispatch` record is legacy and passes without
  them, so no committed receipt is invalidated and no rewrite is needed.
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
  none of the reply's text.
- Every variable-length field is bounded: a high-volume finding fixture and
  an oversized plan file each truncate deterministically, name themselves in
  the record's `truncation` object, and never exceed their cap.
- `dispatch` is parsed from the definition at the reviewed head, not the
  working tree, in **both layouts**: a handbook fixture where the consumer
  path is a `120000` symlink into `core/`, and an assembled-consumer fixture
  where it is a regular file; a link escaping the repository refuses.
- `declineCitation` resolves in both layouts, including the handbook case
  where the consumer path does not exist at all.
- `planOracle` on a `[PLAN REVIEW]` PR body: the record generates, carries
  `mode: "plan-review"`, and reads the plan file at head; a plan-review body
  introducing no plan file refuses.
- `planOracle` where the base already contains `PLAN_OLD.md` and the cited
  commit adds `PLAN_NEW.md`: resolves `PLAN_NEW.md`, does not refuse.
- Both artifact endpoints: missing, malformed, and unresolvable base/head
  each refuse by name rather than yielding an empty list.
- The serialized record never exceeds the total cap on a fixture that would
  otherwise blow it from three directions at once (many findings, an
  oversized plan, a large patch).
- Every live receipt-writing recipe in docs and refusal strings contains the
  stamps (a grep-based assertion, so a new recipe cannot omit them
  silently).
- Receipt validator: a stamp that disagrees with the cited record refuses,
  with no reference to current configuration; a receipt citing a record that
  carries `dispatch` refuses without stamps; a receipt citing a
  pre-`dispatch` record passes without them; a **backdated** receipt citing
  a new-format record is still refused.
- The merge gate refuses readiness on a terminal receipt whose stamps
  disagree with its record — the same check as the review-budget guard, in
  `pr-ready.mjs`.
- The definition's frontmatter declares a model and an effort, and the
  post-sweep class-1/class-2 oracles hold (exactly one declarative pin; no
  live routing instruction names a tier).

Manual QA: regenerate #33's record from a corrected snapshot at `703b230`
and confirm the numbers above.

## Implementation Steps

1. Verify empirically that this harness accepts `best` in subagent
   frontmatter; if not, use `fable` and note it (decision 5).
2. Endpoint validation, then the git-derived file list with decision 2's
   parsing rules; size/territory/patch consume it; refusal on
   empty-against-distinct; retire snapshot `files`.
3. The layout-aware head-pinned resolver, then `planOracle` (both modes),
   `declineCitation`, `body`, `dispatch`, and the caps of decision 12a — all
   read through that resolver.
4. Receipt stamps, the record-comparing validation in both the guard and
   the merge gate, and every canonical producer recipe.
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
  add perhaps 10–20k tokens; decision 12a bounds every variable-length
  field. The patch cap is unchanged.
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
- [ ] Every variable-length field's cap holds — finding text and plan
      oracle alike — with truncation named in the record.
- [ ] The definition declares the empirically selected alias and an effort;
      class-1, class-2 and class-5 oracles re-run and quoted in the PR body.
- [ ] New adjudication receipts refuse on a stamp that disagrees with the
      cited record, in the review-budget guard **and** at the merge gate;
      every pre-existing receipt still loads.
- [ ] A plan-review loop can generate a record and reach its judge.
- [ ] Both payload layouts resolve every head-pinned read.
- [ ] The serialized record's total cap holds on a worst-case fixture.
- [ ] Every live receipt-writing recipe carries the stamps.
- [ ] `.agents/machinery.json` and the enrolment docs are unchanged.
- [ ] All five mandated commands pass, with output recorded.
