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

**This PR changes no running guard's behaviour on the day it merges.** The
guard that fires is Overhype.me's, and Overhype.me's copy is pre-#7. The
deliverable is that unstaging `machinery` stops being blocked — stated
plainly because it is the most likely reason to re-scope.

## Must Not Change

1. **The comparison itself.** Stamped on mint, compared on consume. A
   receipt's repository comes from the durable ref; the target comes from
   the tool input; nothing sits between them.
2. **The review-request path reads no configuration for identity.** Rounds
   3, 4 and 5 of #7 each found a new way for a declared identity to be
   wrong. That deletion stays deleted.
3. **Refusal, never skip.** An unanswerable question blocks. There is no
   path on which "I could not tell" becomes "allowed".
4. **The guard path stays total.** An escaping exception exits 1, which the
   harness reads as a hook error and lets the tool call through. Everything
   fallible is wrapped and returns a blocking verdict.
5. **The local-repo path is unchanged**, byte-for-byte in behaviour: when
   the target is the project root's own repository, this change is not on
   the path at all.
6. **Fork PRs stay out of scope on the readiness path.** That refusal is the
   fork gate; #8 is a different question at a different layer.
7. **Budgets stay non-transferable.** A budget authorizes rounds in the
   repository it was declared for and no other.

## Settled Decisions

1. **Locating is not trusting, and that is the whole safety argument.** The
   resolution mechanism only says *where to look*. Every gram of authority
   still comes from the located checkout's durable receipts, compared to the
   tool's target exactly as today. A wrong location can therefore only
   produce a refusal — it can never manufacture an allow, because a receipt
   that does not name the target is rejected by the comparison that already
   exists. This is what keeps the change compatible with Must Not Change 2:
   the identity answer still comes from the receipt, never from a config.
2. **`nodeIo(root)` is already the right seam.** `cwd: root` is threaded
   through every `execFileSync` in `nodeIo`, so `nodeIo(foreignRoot)` reads
   the foreign checkout's durable ref, not the local one. Verified by
   reading `durableRef` rather than assumed. This is why the change is a
   root-resolution change and not a rewrite of the decision matrix.
3. **The registry is environment-provided, not committed.** An attached
   checkout's absolute path is a property of the container, not of the
   repository, so committing it into `.agents/machinery.json` would put a
   container fact in a synced file. `process.env` is also the only read
   available on the guard path that cannot throw.
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
| Which repository a loop belongs to | The receipt's stamped `repo`, read from the durable ref | No |
| Which repository this checkout is | `.agents/machinery.json`, read by `machineryConfig` alone | No |
| Required-checks policy | Same config read, stamped into the readiness receipt on mint | No |
| **Where a given repository's checkout lives** | **New — the registry** | New concept, no existing owner |

The registry answers a question nothing answers today: *given a repository
slug, which directory on this machine holds its checkout?* It is
deliberately not an answer to "which repository is this?" — that stays with
`machineryConfig` for the local repo and with the receipt for a loop. No
existing source of truth gains a second voice.

## Proposed Design

**The invariant.** A call naming a repository target is judged against
evidence belonging to *that* repository, or it is refused. There is no third
outcome.

**Resolution order**, applied where `nodeIo()` is defaulted today:

1. If the target equals the project root's own repository, use the project
   root. This is the existing path, unchanged and not merely
   behaviour-compatible — the foreign branch is not entered at all.
2. Otherwise, consult the registry for candidate roots. For each candidate,
   read the evidence with `nodeIo(candidate)` and accept it only if the
   receipt it yields is stamped with the target.
3. If no candidate yields matching evidence, refuse, naming the target and
   what would make it resolvable.

**Ambiguity refuses.** Two candidates both yielding evidence stamped with
the target is a mistake — two checkouts of one repository, one of them
stale — and picking either is picking one at random. Refuse and say both.

**Failure direction is uniform.** Registry unset, registry naming a
directory that does not exist, candidate with no receipts, candidate whose
receipts name another repository, foreign checkout sitting on a branch whose
upstream lacks the loop's receipts: every one of these refuses. The change
adds no path on which an unanswerable question resolves to "allowed".

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

| Situation | Outcome |
|---|---|
| Target is the project root's repo | Existing path; foreign branch never entered |
| Registry unset, foreign target | Refuse; message names the variable and the target |
| Registry names a missing directory | Refuse |
| Candidate has no `.agents/machinery.json` | Refuse — an unconfigured checkout is not a witness |
| Candidate's receipt names another repository | Refuse, on the existing comparison |
| Candidate on a branch whose upstream lacks the receipts | Refuse — fail-closed, and the same condition that already applies to local work |
| Two candidates match the target | Refuse as ambiguous, naming both |

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
   refusal.
2. Every new failure mode listed in Runtime Behavior resolves to blocked.
3. The new code adds no unwrapped fallible call to the guard path.

**What this change does not do:** it does not make cross-repo work guarded
in a session running the stale Overhype.me copy. That arrives with the
`machinery` unstaging, and #27 stays open until it does.

## Testing Plan

Runner: `node --test core/scripts/__tests__/` for the payload suite, plus the
repo checks (`check-manifest`, `check-identity-sources`, `check-root-wiring`,
`check-settings-fields`, `check-contract-consistency`).

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
- Foreign target, candidate's receipt stamped for a third repository →
  blocked.
- Two candidates matching the target → blocked, naming both.
- A throw raised from inside the resolution path surfaces as a blocking
  verdict, not as an escape — the totality property, asserted rather than
  argued.

## Implementation Steps

1. Add the registry read and the target-to-root resolver in
   `review-budget.mjs`, beside `nodeIo`, injectable for tests.
2. Route `judgeReviewRequest` through it, leaving the local path untaken.
3. Route `checkMerge`'s receipt read and config read through it, via
   `guard-decision.mjs`'s injection points.
4. Tests, in the order above, negative cases first.
5. Documentation: the registry in `docs/consuming-repos.md`, and the
   cross-repo session step the handbook currently omits.

Each step is the smallest change that keeps the suite green.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| The registry becomes a second identity source by drift | It is consulted only for location; the receipt comparison is what admits evidence, and a test asserts a mismatched receipt refuses |
| A stale second checkout answers for a repository | Ambiguity refuses rather than picks; a single stale checkout still has to produce a receipt stamped for the target from its durable ref |
| The guard path gains a way to throw | Registry read is `process.env`; a test asserts a throw inside resolution surfaces as blocked |
| Scope creep into #8 or the unstaging audit | Both named out of scope in Settled Decisions |

## Questions for David

None. The one genuine fork — whether the merge gate rides along — was the
scope gate, and it is answered: option 1.

## Definition of Done

- [ ] Both judgements resolve their evidence root from the call's target.
- [ ] Every situation in the Runtime Behavior table refuses, asserted by test.
- [ ] The local path is unchanged, asserted by test for both judgements.
- [ ] Payload and handbook suites green; all five repo checks green.
- [ ] The behaviour is exercised from a real cross-repo session: a review
      request aimed at an AI-Handbook PR is judged against the handbook's
      own budget, from an Overhype-rooted session running the payload copy.
- [ ] PR flagged David-merge-only at open, with the `internal` budget
      declared and the receipt committed and pushed.
