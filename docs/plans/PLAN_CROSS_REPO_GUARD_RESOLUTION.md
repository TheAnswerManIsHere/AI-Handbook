# Resolve a guard judgement's evidence by the call's target, not by the project root

Issue: [#27](https://github.com/TheAnswerManIsHere/AI-Handbook/issues/27).
Workstream: [#9](https://github.com/TheAnswerManIsHere/AI-Handbook/issues/9).

**Ceremony:** `internal` tier, budget 3 rounds, criticality 85.
**🛑 DAVID-MERGE-ONLY** — the implementation PR changes gate scripts on the
guard path, which is a named carve-out. Flagged at open, not at close.

**Scope authorized by David, 2026-09-05**, option 1 of three: both
target-taking judgements in one increment, one mechanism.

---

## Preflight

**Increment test.** No universal quantifier: the scope is the two judgements
the oracle below finds, not "every guard judgement". No *Phases* section —
the two judgements share one root-resolution mechanism, and shipping either
alone leaves `machinery` unstageable, so they are not independently
shippable in any useful sense. One plan.

**Affected-surface inventory.** The class is *a guard judgement that takes a
repository target but reads its evidence from the project root.* Mechanical
oracle, run against `6feabb6`:

```
$ git grep -n 'toolInput?\.owner\|toolInput?\.repo' -- core/scripts/*.mjs
core/scripts/guard-decision.mjs:1675:  const target = `${toolInput?.owner ?? ""}/${toolInput?.repo ?? ""}`;
core/scripts/guard-decision.mjs:1676:  if (!toolInput?.owner || !toolInput?.repo) {
core/scripts/review-budget.mjs:1609:  const target = `${toolInput?.owner ?? "?"}/${toolInput?.repo ?? "?"}`;

$ git grep -n 'tool_name ===\|REVIEW_REQUEST_TOOLS.has(payload' -- core/scripts/guard-decision.mjs
core/scripts/guard-decision.mjs:1781:  if (payload?.tool_name === MERGE_TOOL) {
core/scripts/guard-decision.mjs:1795:  if (typeof payload?.tool_name === "string" && REVIEW_REQUEST_TOOLS.has(payload.tool_name)) {
```

Two judgements — `checkMerge` and `judgeReviewRequest` — and both are in
scope. The third `decide()` branch is the Bash path, which judges a command
string against the current working directory and takes no repository target;
it is out of scope for that reason, not by omission.

**How the oracle maps to the claim.** A tool input can name a repository
only through `owner`/`repo`; there is no other channel. So a grep for those
two reads over the payload scripts is the complete set of places a target
can enter a judgement, and the hit list is the scope.

**That oracle is necessary and was not sufficient** (Codex round 1, P1). It
finds the judgements that *take* a target; it says nothing about what each
one *consults* to answer. The scope is the dependency closure, so a second
oracle enumerates every evidence dependency injected at the `decide()` call
sites (`core/scripts/guard-decision.mjs:1783-1801`):

```
readReceipt   -> readReceiptFromDisk        -> join(REPO_ROOT, …)   working tree
resolveSha    -> remoteTip                  -> NO cwd, inherited    <-- missed by oracle 1
resolveConfig -> machineryConfig(nodeIo())  -> REPO_ROOT
options.io    -> nodeIo()                   -> REPO_ROOT
```

Four dependencies, not two. `remoteTip` is the one the first oracle could
not see: it takes a branch name and no root
(`core/scripts/pr-ready.mjs:1881`), so it resolves against whatever `origin`
the hook process inherited. Routing only the receipt and config reads
through a foreign root would leave a cross-repo merge resolving the
**primary** repository's origin — blocking a valid merge when no same-named
branch exists there, and, worse, authorizing a stale foreign head when one
coincidentally does. The lesson generalizes past this plan: for a
judgement, the affected surface is everything it consults, never only the
inputs it names.

**Claim-oracle rule.** Two completeness claims are made in this plan, and
each names what enforces it:

| Claim | Enforced by |
|---|---|
| Exactly two judgements take a repository target | The oracle above, executed and transcribed |
| `nodeIo(root)` carries `root` into git reads, not only file reads | **Construct** — `cwd: root` is passed to every `execFileSync` in `nodeIo`; verified by reading `durableRef` at `core/scripts/review-budget.mjs:655-740` |

**Specification test.** Call-site lists and test assertions are left out —
the diff and the suite catch those. What is kept is the resolution rule, the
refusal semantics, the failure direction, and the source-of-truth boundary,
none of which a compiler or a test would catch if this document never said
them.

## Problem

Every guard judgement decides from evidence rooted at the **project root**,
because the `PreToolUse` hook that fires belongs to the session's primary
repo. This workstream is worked with Overhype.me as the project root and
AI-Handbook attached, so a call aimed at AI-Handbook is judged against
Overhype.me's receipts.

Two symptoms, on opposite sides of the `machinery` unstaging:

- **Today**, the deployed Overhype.me copy is pre-#7 and carries a
  `targetsThisRepo` early return that *allows* a foreign target
  (`scripts/review-budget.mjs:1324`). Measured: every review request posted
  on an AI-Handbook PR in this workstream ran unguarded. The budget
  discipline held because the contract was followed by hand.
- **After the unstaging**, the payload has no such skip — #7 deleted it — so
  both judgements refuse a foreign target outright:

```
$ judgeReviewRequest, payload at 6feabb6, from the handbook checkout
own repo, undeclared PR       -> BLOCKED | no round budget declared for PR #999 …
FOREIGN repo, undeclared PR   -> BLOCKED | no round budget declared for PR #611 …
```

That refusal is correct in isolation and unusable in practice: there is no
AI-Handbook environment, so "post the request from a checkout of the target"
— which is what the existing refusal text tells the operator to do — cannot
be satisfied.

So the `machinery` group cannot unstage without making the handbook's own
review loops unrunnable, and cannot stay staged without leaving cross-repo
work unguarded. This plan removes that dilemma.

## Direction

[#9](https://github.com/TheAnswerManIsHere/AI-Handbook/issues/9) — make the
handbook payload portable, then unstage it group by group.

**What this increment makes true that was not true before:** a guard
judgement resolves whose loop it is from the **target of the call**, so a
session can hold more than one repository without either losing the guard or
being refused by it — which is the precondition for unstaging `machinery`.

## Product Intent

The guard protects the same things it protects today, from a session that
has more than one repository attached. Nothing about the merge bar, the
round budget, or the receipt discipline changes; only *which checkout's
evidence answers the question* changes.

**In an Overhype-rooted session, this PR changes no running guard's
behaviour on the day it merges.** That session's guard is Overhype.me's, and
Overhype.me's copy is pre-#7. The deliverable is that unstaging `machinery`
stops being blocked — stated plainly because it is the most likely reason to
re-scope.

**The claim is narrower than the first draft asserted** (Codex round 1, P1).
This repository's own `.claude/settings.json` invokes
`${CLAUDE_PROJECT_DIR}/core/.claude/guard.sh`, which executes the adjacent
`core/scripts/guard-decision.mjs` — the payload copy itself, not a vendored
duplicate. So **in an AI-Handbook-rooted session the edits are live the
moment they merge.** No such session runs today (the account has no
AI-Handbook environment), which is why the effect is invisible in practice —
but "invisible in practice" is not "no running guard changes", and the
handbook-rooted guard therefore gets its own verification rather than being
assumed inert.

## Must Not Change

1. **The comparison itself.** Stamped on mint, compared on consume. A
   receipt's repository comes from the receipt — the durable ref for a
   budget, the working tree for a readiness receipt (Settled Decision 2) —
   and the target comes from the tool input; nothing sits between them.
2. **The review-request path reads no configuration for identity.** Rounds
   3, 4 and 5 of #7 each found a new way for a declared identity to be
   wrong. That deletion stays deleted.

   **This is per-path, and the plan must not blur it.** `judgeReviewRequest`
   reads no configuration at all. `checkMerge` *does* read one — the
   required-checks policy, through `resolveConfig` — deliberately and by
   existing design, stamped on mint and compared on consume. The invariant
   is "no configuration read to establish **identity**", not "no
   configuration read".
3. **Refusal, never skip.** An unanswerable question blocks. There is no
   path on which "I could not tell" becomes "allowed".
4. **The guard path stays total.** An escaping exception exits 1, which the
   harness reads as a hook error and lets the tool call through. Everything
   fallible is wrapped and returns a blocking verdict.
5. **The local-repo path is unchanged**, byte-for-byte in behaviour —
   including the `no-budget` and `no readiness receipt` refusals for a local
   PR that has neither. The project root is always tried *first*, so a local
   call reaches exactly the decision it reaches today; nothing detects that
   it is local.
6. **Fork PRs stay out of scope on the readiness path.** That refusal is the
   fork gate; #8 is a different question at a different layer.
7. **Budgets stay non-transferable.** A budget authorizes rounds in the
   repository it was declared for and no other.

## Settled Decisions

1. **Locating is not trusting, and that is the whole safety argument.** The
   resolution mechanism only says *where to look*. Every gram of authority
   still comes from the located checkout's own receipts, compared to the
   tool's target exactly as today. A wrong location can therefore only
   produce a refusal — it can never manufacture an allow, because a receipt
   that does not name the target is rejected by the comparison that already
   exists. This is what keeps the change compatible with Must Not Change 2:
   the identity answer still comes from the receipt, never from a config.
2. **`nodeIo(root)` is the right seam for the reads that go through it.**
   `cwd: root` is threaded through every `execFileSync` in `nodeIo`, so
   `nodeIo(foreignRoot)` reads the foreign checkout's durable ref, not the
   local one. Verified by reading `durableRef` rather than assumed. It is
   not, however, the *only* seam — see Settled Decision 8 for the two
   dependencies that do not flow through it.

   **Receipts are not uniformly durable, and the implementation must not
   treat them as one kind** (Codex round 1, P1). The two judgements read
   two different sorts of evidence:

   | Receipt | Where it lives | Why |
   |---|---|---|
   | Budget, extension decisions | Durable ref (`origin/<branch>`) | They authorize rounds, so they must survive the container |
   | **Round-check (`loop-round-check-*.json`, `.claim`)** | **Working tree, gitignored** | Evidence of a count just taken; it is generated and consumed inside one request |
   | **Readiness (`pr-*.json`)** | **Working tree, gitignored** | Minted and consumed inside one close-out; committing it would make a stale one authoritative |

   The draft put the round-check on the durable side (Codex round 2, P1).
   `.agents/receipts/.gitignore` lists `loop-round-check-*.json` and
   `loop-round-check-*.claim` alongside `pr-*.json`, and
   `judgeReviewRequest` reads and writes it through `io.read`/`io.write`.
   **Only budgets and extension decisions come from the durable ref.**
   Implementing the draft's table literally would make a freshly generated
   round check invisible and refuse every guarded review request.

   `.agents/receipts/.gitignore` lists `pr-*.json`, and
   `readReceiptFromDisk` reads it with `readFileSync` from `REPO_ROOT` — so
   a readiness receipt is *never* in a durable ref by design. Rooting it at
   a resolved checkout must preserve working-tree semantics; reading it
   from a durable ref instead would make a freshly minted receipt invisible
   and could substitute stale committed evidence.
3. **The registry is a slug-keyed map, environment-provided, not committed**
   (revised, Codex round 2 P2 — the draft named no variable and defined no
   representation, which left ambiguity, duplicates and malformed values
   undefined and put an unspecified parse on the guard path).

   **Contract:**

   | | |
   |---|---|
   | Variable | `HANDBOOK_ATTACHED_ROOTS` |
   | Serialization | `owner/name=/abs/path`, entries separated by the platform path delimiter (`:` on POSIX) — no JSON, so a malformed value cannot throw a parser |
   | Keys | A repository slug, matched case-insensitively, exactly as the receipt comparison matches |
   | Values | Must be **absolute**; normalized before use. A relative path is invalid, not resolved against cwd — the hook's cwd is the thing this plan exists to stop depending on |
   | Duplicate keys | The entry is **invalid**, not last-wins: a duplicate means the operator holds two beliefs and the machinery must not pick one |
   | Malformed entry | The **whole variable** is treated as unusable and every foreign target refuses. Not "skip the bad entry" — a partly-parsed registry silently resolves some targets and not others |
   | Unset | Every foreign target refuses; local work is unaffected |

   **Keying by slug, rather than scanning a list of roots, dissolves the
   ambiguity problem by construction**: a target resolves to at most one
   root, so there is never a set of candidates to disambiguate. This is why
   the draft's "two candidates match → refuse as ambiguous" rule is gone
   rather than refined — the state it adjudicated cannot arise.

   Parsing stays total: splitting a string on two delimiters and rejecting
   anything that does not match cannot throw, and every rejection is a
   refusal.

   **Why environment and not committed:** an attached checkout's absolute
   path is a property of the container, not of the repository, so committing
   it into `.agents/machinery.json` would put a container fact in a synced
   file. `process.env` is also the only read available on the guard path
   that cannot throw.
4. **Rejected: scanning the filesystem for candidate roots.** It replaces an
   explicit declaration with a guess over an arbitrary domain ("siblings of
   the project root"), puts a directory walk on the hook path, and can match
   a stale clone. Explicitness costs one environment variable and buys a
   refusal message that names exactly what is missing.
5. **Rejected: carrying a receipt into the local tree.** Minting a portable
   cross-repo receipt in the foreign checkout and consuming it locally
   needs no discovery, but it gives up the property that makes receipts
   worth anything — a working-tree copy is not the durable ref, and its
   authority would rest on the mint rather than on what survives the
   container.
6. **Rejected: widening to #8.** Adjacency, not dependency; it would reopen
   the settled fork-PR boundary.
7. **#13 is not folded in.** `node scripts/…` is *correct* for a consumer,
   where the sync lands the payload at `<repo>/scripts/`; it is wrong only
   in the handbook, where the scripts are payload at `core/scripts/`. The
   honest fix is root wiring — the mechanism `check-root-wiring.mjs`
   already polices for skills and agents — not editing payload text that is
   right for its destination. Separate PR, sequenced **next**.
8. **Two dependencies do not flow through `nodeIo`, and both must be
   rooted explicitly** (Codex round 1, P1). `readReceiptFromDisk` joins
   `REPO_ROOT` directly, and `remoteTip` takes no root at all. Routing only
   the `nodeIo`-mediated reads would leave the readiness receipt and the
   remote-tip lookup answering from the primary repository while the rest of
   the judgement answers from the resolved one — a split-brain that fails
   *open* in the `remoteTip` case, since a coincidentally same-named branch
   in the primary repo resolves a tip that then authorizes a stale foreign
   head. All four dependencies in oracle 3 are routed, or none is.

## Repo Context Inspected

- `core/scripts/review-budget.mjs` — `findRepoRoot`/`REPO_ROOT` (120–177),
  `machineryConfig` (217), `nodeIo` including `durableRef` (587–740),
  `loadLoop` (1121), `judgeReviewRequest` and its early returns and identity
  comparison (1516–1680).
- `core/scripts/guard-decision.mjs` — `checkMerge` (1651–1700),
  `readReceiptFromDisk` (1761), `decide` (1772–1808).
- `core/scripts/pr-ready.mjs` — `localConfig`/`requiredChecks` (137–150), the
  `cwd` adapter over `machineryConfig`.
- `core/.agents/PLANS.md` (Preflight and template), `.agents/machinery.json`,
  `sync-manifest.yml` (13 groups, 0 ready).
- Issues #27, #8, #13, #16; the 2026-09-05 handoff comment and its addendum
  on #9.
- `core/.agents/memory/machinery-threat-model-is-my-own-mistakes.md`.

## Current Behavior

`decide()` routes a hook payload to one of three judgements. Two take a
repository target and read evidence via `nodeIo()` — defaulted to
`REPO_ROOT`, the nearest enclosing directory declaring
`.agents/machinery.json`:

| Judgement | Evidence | Foreign target today (payload) |
|---|---|---|
| `judgeReviewRequest` | budget + round-check receipts, durable ref | refuses: "no round budget declared for PR #N" |
| `checkMerge` | readiness receipt on disk, `requiredChecks` from config | refuses: "no readiness receipt for PR #N" |

Both already compare the receipt's stamped repository against the target and
refuse on mismatch. Neither can reach the target repository's evidence.

## Source-of-Truth Analysis

| Concept | Source of truth | Changed? |
|---|---|---|
| Which repository a loop belongs to | The receipt's stamped `repo` — durable ref for the budget, working tree for the readiness receipt | No |
| Which repository this checkout is | `.agents/machinery.json`, read by `machineryConfig` alone | No |
| Required-checks policy | Same config read, stamped into the readiness receipt on mint | No |
| **Where a given repository's checkout lives** | **New — the registry** | New concept, no existing owner |

The registry answers a question nothing answers today: *given a repository
slug, which directory on this machine holds its checkout?* It is
deliberately not an answer to "which repository is this?" — that stays with
`machineryConfig` for the local repo and with the receipt for a loop. No
existing source of truth gains a second voice.

**No guard-path step consults `machinery.json` to establish identity**, and
the revised resolution order is what guarantees it: there is no local/foreign
discriminator to need one. `machineryConfig` keeps its existing roles — the
mint paths, and `checkMerge`'s required-checks policy — and gains none.

## Proposed Design

**The invariant.** A call naming a repository target is judged against
evidence belonging to *that* repository, or it is refused. There is no third
outcome.

**Resolution order — try-local-first, with no local/foreign discriminator
at all** (revised, Codex round 1 P1):

1. **Always try the project root first**, exactly as today, and take its
   answer whenever it yields evidence stamped with the target.
2. **Only if that produces no matching evidence**, look the target up in the
   registry — a single keyed lookup, not a scan. If it resolves, read the
   evidence with `nodeIo(thatRoot)` and accept it only if the receipt it
   yields is stamped with the target.
3. **If no candidate yields matching evidence, return the project root's own
   refusal** — the existing message, not a foreign-flavoured one.

**Why there is no "is this my repository?" step.** The first draft opened
with one, and it was a real defect: answering it needs an identity read,
which Must Not Change 2 forbids on the review-request path, and which no
receipt can supply for a *local* PR that has no budget yet — precisely the
case whose refusal must not change. Trying the local root unconditionally
dissolves the question. The local path is not "detected", it is simply
first, so:

- A local target with a valid budget is answered at step 1, as today.
- A local target with **no** budget falls through step 2 (no foreign
  candidate is stamped for it either) and returns the existing local
  `no-budget` refusal at step 3 — byte-identical to today's behaviour.
- A foreign target is answered at step 2 only because a registered checkout
  holds a receipt stamped for it.

No step reads a configuration to decide *whose* call this is. This is
strictly simpler than the draft it replaces, which is the tell that the
draft was wrong rather than merely under-specified.

**Ambiguity cannot arise** (revised, Codex round 2 P1). The registry is
keyed by slug, so a target resolves to at most one root; there is never a
set of candidates to pick between. The draft's "refuse as ambiguous" rule is
deleted rather than refined, because the state it adjudicated is
unrepresentable.

**One residual case, stated rather than claimed away.** A registry key naming
the *project root's own* repository is out of contract — the registry is for
attached checkouts — but the plan cannot **prevent** it, because detecting it
requires knowing the project root's identity, which Must Not Change 2
forbids on this path. Its effect is bounded and worth naming exactly: such a
key is consulted only when the project root yielded no evidence, and what it
then supplies is the *same repository's* durable budget from another
checkout. That is not a privilege escalation — it is the same loop's real
budget — but it **is** a departure from Must Not Change 5, since the local
call would have refused with `no-budget`. So this is written as *checked*,
not as *cannot*: a test asserts the behaviour, and `docs/consuming-repos.md`
states the key is invalid, rather than the plan pretending the state is
unreachable.

**Failure direction is uniform.** Registry unset, registry naming a
directory that does not exist, candidate with no receipts, candidate whose
receipts name another repository, foreign checkout sitting on a branch whose
upstream lacks the loop's budget receipt, candidate whose working tree holds
no readiness receipt: every one of these refuses. The change adds no path on
which an unanswerable question resolves to "allowed".

**Totality.** The registry read is `process.env`, which cannot throw. Every
filesystem and git touch reached through `nodeIo` is already ENOENT-tolerant
or wrapped; the new resolution code adds no unwrapped fallible call, and the
guard's existing catch-and-block posture covers what remains.

## Data Model and Migration Impact

None. No schema, no stored data, no backfill. Receipts keep their current
shape and location; nothing already minted is reinterpreted.

## Runtime Behavior

Local-repo work is untouched — same judgements, same messages, same
receipts. Cross-repo work becomes possible and guarded: a review request or
merge aimed at an attached repository is judged against that repository's
own budget, round count and readiness receipt.

Edge cases and their outcomes:

The first row is the **allow-capable** case and is deliberately not a
negative: a local target reaches today's decision, which may legitimately be
*allowed*. Every row below it is a negative case and refuses.

| Situation | Outcome |
|---|---|
| Target is the project root's repo | **Today's decision, unchanged — allow or refuse exactly as now** |
| Registry unset, foreign target | Refuse; message names the variable and the target |
| Registry names a missing directory | Refuse |
| Registry value malformed, relative, or a duplicate key | Refuse — the whole variable is unusable, never partly parsed |
| Target absent from the registry | Refuse |
| Candidate's receipt names another repository | Refuse, on the existing comparison |
| Candidate on a branch whose upstream lacks the receipts | Refuse — fail-closed, and the same condition that already applies to local work |
| Registry key names the project root's own repository | Out of contract; consulted only if the project root yielded nothing. Behaviour asserted by test, not prevented — see Proposed Design |

## Admin/User UX Impact

None — the observable surface is a hook refusal message in my own session.
No product UI, no async status surface. **No UAT doc is owed** for that
reason; the exercise-in-the-product criterion is met by the guard behaving
as specified from a real cross-repo session.

## Security, Permissions, and Validation

This *is* the security surface, so the analysis is the point rather than a
section to fill.

**The threat model is my own mistakes, not an adversary** — settled, and not
reopened here. The person who can edit these files is the person running the
guard; the controls against deliberate action are David's merge and the
server-side ruleset.

**The fail-open question, asked directly.** The class this workstream keeps
meeting is *a guard that cannot launch does not refuse, it waves the call
through.* Three properties keep this change out of that class:

1. The only new input is a location. Authority stays with the receipt
   comparison that already exists, so a wrong location degrades to a
   refusal — **provided every dependency in oracle 3 is routed to the same
   resolved root.** That proviso is load-bearing, not decorative: leave
   `remoteTip` inheriting the hook's cwd and a coincidentally same-named
   branch in the primary repository resolves a tip that authorizes a stale
   foreign head. It is the one place in this plan where a wrong root
   produces an *allow*, which is why Settled Decision 8 makes the routing
   all-or-nothing and the Testing Plan asserts it with distinct origins.
2. Every **negative** case in Runtime Behavior resolves to blocked. The
   table's first row is the local target, which reaches today's decision and
   is legitimately allow-capable; it is unchanged behaviour rather than a
   new failure mode.
3. The new code adds no unwrapped fallible call to the guard path.

**What this change does not do:** it does not make cross-repo work guarded
in a session running the stale Overhype.me copy. That arrives with the
`machinery` unstaging, and #27 stays open until it does.

## Testing Plan

**Runners, transcribed from `.github/workflows/check.yml` rather than
recalled** (Codex round 1, P2 — the draft named
`node --test core/scripts/__tests__/`, which Node resolves as a *module*
path and kills with `MODULE_NOT_FOUND` before running anything, reported as
"1 test, 1 failed" so it reads like a real failure):

```sh
# 1. This repo's own suite — omitted entirely from the draft
node --test scripts/__tests__/*.test.mjs

# 2. The payload suite. The glob is required, and one file is excluded BY NAME:
#    check-contract-consistency.test.mjs asserts the corpus contains CLAUDE.md
#    at its root — true in a consumer, false in the handbook's split layout.
node --test $(ls core/scripts/__tests__/*.test.mjs \
  | grep -v 'check-contract-consistency.test.mjs')

# 3. The exclusion's expiry oracle: assert it still fails for the documented
#    reason, so a temporary carve-out cannot become permanent.
node --test core/scripts/__tests__/check-contract-consistency.test.mjs

# 4. The repo checks, at their real paths — the first four at the root,
#    check-contract-consistency under core/.
node scripts/check-manifest.mjs
node scripts/check-identity-sources.mjs
node scripts/check-root-wiring.mjs
node scripts/check-settings-fields.mjs
node core/scripts/check-contract-consistency.mjs
```

Runner 3 is an **expected failure**, not a green check: the Definition of
Done is "runners 1, 2 and 4 green, and runner 3 still failing on exactly the
documented corpus-layout assertion." A plan whose Definition of Done demands
all-green would be unsatisfiable here by construction.

Tests prove the general invariant, not the reported example, and every
negative case asserts **blocked**:

- Local target resolves to the project root and behaves identically to
  today — the regression guard on Must Not Change 5, asserted for both
  judgements.
- Foreign target with a registered checkout whose receipts are stamped for
  it: allowed when the loop genuinely authorizes it, refused when it does
  not — proving the foreign path runs the *same* decision matrix rather than
  a permissive copy of it.
- Foreign target, registry unset → blocked.
- Foreign target, registry names a nonexistent directory → blocked.
- Registry malformed, relative-path, or duplicate-key values → blocked, and
  blocked for **every** target, proving the variable is not partly parsed.
- A registry key for the project root's own repository, asserted in **both**
  local-root states: with a local budget present (step 1 answers, the key is
  never consulted) and absent (the key answers, departing from local parity
  as documented).
- Foreign target, candidate's receipt stamped for a third repository →
  blocked.
- Two candidates matching the target → blocked, naming both.
- A throw raised from inside the resolution path surfaces as a blocking
  verdict, not as an escape — the totality property, asserted rather than
  argued.
- **Distinct local and foreign origins**: a cross-repo merge whose foreign
  branch name also exists in the primary repository resolves the *foreign*
  tip. The test fails if the local tip is used — which is the fail-open case
  in Settled Decision 8, and the only one in this plan where a wrong root
  produces an allow rather than a refusal.
- **No machinery-config identity read on either path**: asserted for both a
  local and a foreign review request, so the discriminator cannot creep back
  in as an implementation convenience.

## Implementation Steps

1. Add the registry read and the target-to-root resolver in
   `review-budget.mjs`, beside `nodeIo`, injectable for tests.
2. Route `judgeReviewRequest` through it, project root tried first.
3. Give `remoteTip` an explicit root parameter — it has none today, and it
   is the dependency that fails *open* if left inheriting the hook's cwd.
4. Route all four of oracle 3's dependencies for `checkMerge` through the
   resolved root, via `guard-decision.mjs`'s injection points, preserving
   the readiness receipt's **working-tree** semantics.
5. Tests, negative cases first, including one with **distinct local and
   foreign origins** that fails unless the foreign tip is used.
6. Documentation: the registry in `docs/consuming-repos.md`, and the
   cross-repo session step the handbook currently omits.

Each step is the smallest change that keeps the suite green.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| The registry becomes a second identity source by drift | It is consulted only for location; the receipt comparison is what admits evidence, and a test asserts a mismatched receipt refuses |
| **A stale registered checkout answers for a repository** | **NOT MITIGATED — open scope question, escalated to David.** `durableRef` reads the candidate's remote-tracking ref without fetching, and `terminalVerdictStanding` returns `false` on an empty extension list — so a checkout that has not fetched a terminal or David-stop extension sees an *open* loop and allows a round the remote has closed. Staleness pre-exists for the project root; this plan widens exposure to it. A freshness proof is a new mechanism on the guard path, so it is a now/next/never call, not the loop's to add (Codex round 2, P1) |
| The guard path gains a way to throw | Registry read is `process.env`; a test asserts a throw inside resolution surfaces as blocked |
| Scope creep into #8 or the unstaging audit | Both named out of scope in Settled Decisions |

## Questions for David

None. The one genuine fork — whether the merge gate rides along — was the
scope gate, and it is answered: option 1.

## Definition of Done

- [ ] Both judgements resolve their evidence root from the call's target,
      and all four dependencies in oracle 3 are routed through it.
- [ ] Every **negative** case in the Runtime Behavior table refuses,
      asserted by test. (Not the first row, which is allow-capable —
      requiring it to refuse would contradict Must Not Change 5.)
- [ ] **Local allow/refuse parity**: the local path returns the same verdict
      and the same message it returns today, on both an authorized call and
      an unauthorized one, asserted by test for both judgements.
- [ ] Payload and handbook suites green; all five repo checks green.
- [ ] The behaviour is exercised against **this repository's own live
      guard**, which runs the payload directly — the only guard this
      increment actually changes.
- [ ] **Deferred to the `machinery` unstaging, not owed here:** the
      Overhype-rooted end-to-end check. That session runs the pre-#7
      consumer copy and no step in this plan syncs or rewires it, so
      requiring it would make this PR unable to satisfy its own Definition
      of Done (Codex round 2, P2).
- [ ] PR flagged David-merge-only at open, with the `internal` budget
      declared and the receipt committed and pushed.
