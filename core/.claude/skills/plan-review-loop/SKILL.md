---
name: plan-review-loop
description: Use in feature-building mode once the pre-plan conversation has settled intent, or whenever a plan needs to be delivered to David for approval. Runs the reviewer in-session with the plan-review script — no PR, no branch, no GitHub. NOT for bugfix mode, which skips plan review entirely.
---

<!-- SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead. -->

# The in-session plan-review loop

The reviewer runs **here**, in this container: the plan-review script spawns
Codex CLI with `gpt-6-astra` at `xhigh` in a read-only sandbox, and the output
is constrained by JSON schema to the plan-review contract's full-assessment
shape. The plan is a file in my working tree that is never pushed. David reads
it on one private Artifact page.

**The script's path differs by repository, so resolve it once per session**
rather than typing either form. The sync routes `core/X -> X`, so the file is
`core/scripts/plan-review.mjs` in the handbook and `scripts/plan-review.mjs`
in every consumer — a hardcoded path is wrong in one of the two, and wrong
loudly (`MODULE_NOT_FOUND`) only if I am lucky:

```
P=core/scripts/plan-review.mjs; [ -f "$P" ] || P=scripts/plan-review.mjs
```

Every command below uses `$P`. Run it from the repository root; the script
itself finds the root by walking up to `.git`, so its output lands inside the
repository whichever layout it is in.

**This replaces the plan loop only. The Codex GitHub review of CODE is
untouched and remains David's safety net** — every implementation PR still gets
it, unchanged.

## Why the transport changed, in one paragraph

Everything expensive about the old loop was a consequence of reviewing through
GitHub, not of reviewing. The connector could post only diff-anchored defects,
so the contract's status label, lens and reconciliation had to be derived by me
and kept in a ledger in the PR body — and the three-round minimum existed
because a defect-only reviewer has no way to say *done*. Round state lived on
GitHub, so rounds were counted from it, receipts were committed and pushed to
exist, and two scripts existed to make GitHub state legible again. The channel
was public, so every plan passed a disclosure gate. And a round was a trigger,
a queue, a webhook that might not arrive, and a fetch. A reviewer that returns
one whole structured document into a local file has none of those problems.

## The reading surface: one private Artifact page

**The plan-review PR is retired as the plan's delivery surface** (David,
2026-09-09, superseding 2026-07-28). There is no `[PLAN REVIEW]` PR, no
`plan-review/<slug>` branch, and no plan file on any pushed branch.

David reads the plan on **one private Artifact page, redeployed in place every
round** — same URL for the life of the loop, so a link he saved on round 1 is
still current on round 5. The page carries, top to bottom:

1. **What changed this round** — the first thing on the page, every round after
   the first: what the reviewer said, what I did about it, what is still open.
   On round 1 this section says "first version".
2. The plan itself.
3. The oracle it is being reviewed against.

He can interject at any point; nothing waits on him between the scope gate and
the approval ask.

**This also dissolves the disclosure gate rather than passing it.** The old
check existed because a closed-unmerged PR stays in public history forever. A
plan that is never committed and never pushed is not published, so there is
nothing to screen for publication. What survives is narrower and still real:
`.agents/reviews/` is gitignored by a `.gitignore` the script writes, the plan
file is never committed unless David asks for it, and an Artifact page is
private by default and stays that way.

## What the reviewer gets, and who writes it

**I never write the reviewer's prompt.** `plan-review.mjs` assembles every
instruction it receives. This is workstream #36's rule applied to a new
reviewer: if the session driving the loop composes the reviewer's brief, the
session can steer the reviewer, and the review stops being independent. What I
supply is data — which plan, which round, which findings were disposed of how —
plus one capped `--lens` the script frames as emphasis and never as scope.

**Fresh context every round.** Not a resumed thread. Prior findings cross as
ids, titles and dispositions — never their bodies — so the reviewer reconciles
against the *current whole plan* rather than against its own memory of what it
argued last time. Same principle as the adjudicator, and the same reason.

## The loop

### Before anything: the scope-of-work gate

Unchanged, and still the thing that authorizes the loop to run autonomously:
the direction served, this increment's product intent, must-not-change, settled
decisions, the now/next/never calls already made, the ceremony tier and the
1–100 criticality, as a 🛑 NEED YOU banner with its push notification. See
[`working-modes.md`](../../../docs/ai-context/working-modes.md#the-scope-of-work-gate-david-2026-08-15).

That agreed scope **is the oracle**. Write it to a file — the plan's fenced
`plan-oracle` block, or a standalone file for round 0 — because the script
refuses to run without one. A plan reviewed only against itself can be
perfectly coherent and still have dropped a requirement the intent called for,
and catching exactly that is what the oracle is for.

### Round 0 — the scope gate's second opinion

**Before the plan is written**, the reviewer gets the oracle alone and answers
one question: should this exist, and is the boundary in the right place.

```
node "$P" --round 0 --slug <slug> --oracle <file>
```

Round 0 is the one round short enough to run in the foreground — it reads a
page, not a plan. Every later round is detached; see below.

David sees its answer **beside mine** before he says go — my own view first, in
my own words, then the reviewer's, then where we differ. This is the cheapest
place in the whole system to catch "we are about to build the wrong thing", and
it costs one round against a document that is a page long.

If it says *No* or *Not yet*, that is a product question for David, not a
finding for me to absorb. Its `scope_concerns` carry ids and cross into round 1
as prior findings like anything else.

### Round 1 — v1 is shown, and the loop does not wait

Write the plan to `docs/plans/PLAN_<SLUG>.md` in the working tree, with the
oracle as a fenced `plan-oracle` block at its head. Publish the Artifact
page. Tell David it is up, and **keep going** — v1 will change anyway, and
waiting for him to read it buys nothing. He interjects whenever he likes.

**Run it detached. A round outlives the tool call that starts it.**

```
S=.agents/reviews/<slug>
setsid nohup bash -c "cd $PWD && node $PWD/$P \
  --round 1 --tier <product|sensitive|internal> \
  --plan docs/plans/PLAN_<SLUG>.md --prior priors.json \
  --lens '<the angle this round attacks from>' > $S/run.log 2>&1; echo \$? > $S/run.exit" &
```

Then wait on `run.exit` appearing — its existence is the completion signal and
its contents are the status. **This is measured, not cautious**: a round is
~9–10 minutes at `xhigh` (522 s hand-run, 576 s scripted), which is longer than
a comfortable foreground Bash call, and a foreground run that gets cut off
loses the whole round — the reviewer's work included. Absolute paths inside the
`bash -c`; the working directory does not survive into the detached child the
way you expect. The rest of the traps are in
[`codex-cli-in-container.md`](../../../.agents/memory/codex-cli-in-container.md).

`--prior` carries round 0's `scope_concerns` with what the plan did about each.
The script refuses round 1 without it whenever round 0 ran — a scope concern is
a finding like any other, and the first plan review is exactly where it has to
be answered. `--no-prior` if round 0 genuinely raised none.

**The oracle is pinned on the first round and checked on every one after.**
Without that, the oracle is read from the plan file I rewrite each round, so
deleting a requirement from the plan *and* from its oracle block would make the
next reviewer measure the plan against my rewritten intent — the builder
steering the reviewer, coming back in through the one input nobody was
watching. A deliberate change is still possible, with
`--oracle-changed "<what David agreed to change>"`, and it is stamped on the
round. Silence is what is refused.

### Every round after: relay, triage, revise

Four things happen every round, in this order, and none of them is optional.

1. **Relay the reviewer's summary to David, in plain English.** A round with
   findings gets: what the reviewer disagrees with, and how it thinks each
   thing should be handled. **A clean round still relays the reviewer's
   `summary_for_david` paragraph** — that is the independent plan opinion
   workstream #36 wanted for the decision points where David is otherwise
   reading blind, and it arrives free with every round.

2. **Say what I am doing with each finding, before I do it.** One line each:
   **fix**, **decline with the reason**, or **bring to David**. In product
   English — the outcome, not the mechanism. This is the moment David can stop
   a revision he disagrees with, and he cannot use it if it arrives after the
   revision.

3. **Revise, and redeploy the Artifact page in place** with the "what changed
   this round" section rewritten.

4. **Run the next round, handing over the dispositions.**

   Detached, like every round — same shape as round 1 above:

   ```
   node "$P" --round N --tier <tier> --plan <file> \
        --prior priors.json --lens "<a fresh angle>"
   ```

   `priors.json` is a JSON array of `{id, title, disposition, note}` with
   disposition one of `fixed | declined | to-david | deferred`. The script
   **refuses any round with an earlier round on disk without it** — `--no-prior`
   is the explicit escape for a round that genuinely returned none.

   Two refusals hold this together, and both close the same hole from opposite
   ends. The script will not run a round that was not handed the prior findings,
   **and it will not accept an assessment that failed to reconcile them** — a
   returned `previous_findings` missing an id, inventing one, or naming one
   twice is rejected on the same footing as a schema violation, and the re-ask
   names exactly what went missing. The stop rule reads that reconciliation, so
   without both, convergence could be faked by omission rather than argued.

**Revisions are still class-level.** A finding names an instance; the fix owes
the class. Name the class in the disposition note and sweep for siblings before
pushing the revision — a plan-file finding almost always has them (a term used
inconsistently, a section pattern repeated).

### The stop rule

**Stop when `required_revisions` is empty, every prior finding comes back
`Resolved` or `Superseded`, and the status is not a blocking one.**

The script computes this — `convergence` in the round's `.meta.json`, and a
`CONVERGED` / `not converged: <why>` line in its output. It is not a judgement
I make about the round afterwards.

The third condition is the one that is easy to leave out. **`Repo context
required` and `Human clarification required` mean the reviewer could not do the
job** — and such a round naturally carries no required revisions, because the
reviewer never got far enough to have any. Reading that as convergence takes "I
could not see enough of the repository to judge this" for "this is fine". Both
route to their own escalation instead: repo context is mine to supply and
re-run; human clarification is a numbered question for David.

- **`recommended_improvements` never hold a round open.** The reviewer knows
  the difference and is told that anything it files as required is something it
  is willing to spend another whole round on.
- **The three-round minimum is retired** (David, 2026-09-09). It compensated
  for a reviewer that could not signal completion. This one can, in a field.
- **New ground after round 2 on an unchanged section is a recommendation**
  unless the reviewer shows why it is required — the script puts that rule in
  the prompt itself from round 3 onward, so it binds the reviewer rather than
  being something I apply afterwards.

### What never gets settled inside the loop

- **Product-level findings.** The reviewer may critique the idea itself, and
  when it does, that finding goes to David as a **numbered question carrying
  the reviewer's view and mine side by side** — never absorbed into a
  revision. Its `product_decisions_for_david` section is the feed, and my own
  reading of a finding as product-shaped is the other. Technical findings are
  the loop's; product findings are David's.
- **A disagreement that will not resolve.** *(The two-round rule, David,
  2026-09-09.)* A finding I declined that the reviewer marks `Still open` on
  **two** consecutive rounds goes to David with both positions stated plainly.
  It is never ground through a third time. Two rounds of the same disagreement
  is evidence the disagreement is real, not evidence I explained it badly.
- **A scope addition.** Any fix that would introduce a new mechanism — a table,
  a role, a config domain, an endpoint — is a now/next/never question for
  David, defaulting to *next*, exactly as before.

## Budget, and the adjudicator's much smaller job

The **round budget and the David gate are unchanged in substance, and enforced
somewhere new.** The loop takes the tier of what it plans, that tier is the
budget, and the David gate stands at budget + 3.

`review-budget.mjs` cannot enforce it: it is keyed to a PR number and reads
receipts from a remote-tracking ref, and there is no longer either. Left there,
the budget would have been prose. **`plan-review.mjs` enforces it directly**:
`--tier` is required from round 1, and a round past the allowance is refused.
The round count is **counted from the round files on disk**, never stored —
same principle as counting rounds fresh from GitHub, and for the same reason: a
stored count is a cache of something already true somewhere else, and it drifts.

An extension is `extensions.json` in the loop's directory, one entry per grant:

```json
[{ "grant": 3, "asOf": 3, "kind": "adjudicator", "reason": "<the unaddressed behavioral risk it covers>" }]
```

A grant opens exactly `asOf + grant` rounds, so a mid-stage grant discards the
interrupted stage's unspent remainder rather than stacking on it — the same
arithmetic as the committed receipts. An `adjudicator` grant is refused past
budget + 3; beyond there the grant is David's, `kind: "david"`, and a `grant`
of 0 endorses stopping. A grant with no stated risk is refused outright: a
grant that names nothing is a rubber stamp.

**The round-3-onward adjudicator dispatch is retired for plan loops** (David,
2026-09-09). It existed because no one in the old loop could tell a required
revision from a nice-to-have: the connector marked everything "Required
Revision" because that is its job, so a judge was needed to decide whether a
finding was worth writing for. This reviewer performs that triage itself, in a
schema field, and the stop rule reads it directly. Keeping a per-round judge on
top would be a second opinion on a judgement that has already been made
mechanically.

**The adjudicator still runs in exactly two places** — at the budget cap,
where it owns the extension decision, and on an `escalate`, at any round.
**What changed is where its input comes from and where its verdict goes**, and
saying "unchanged" here was wrong in a way that made the cap's escape hatch
undefined for every consumer (Codex, #69 round 7):

- **Its input is this loop's round files**, `.agents/reviews/<slug>/round-*.json`
  and their `.meta.json` siblings. They are script-generated, complete, and
  carry the trend the judge needs: findings per round, dispositions, statuses,
  convergence. `review-loop-record.mjs` is **not** available here — it requires
  `--pr` and a PR snapshot, and a plan loop has neither. The rule those two
  share is the one that matters and it is unchanged: **the judge reads what the
  script wrote, never my prose and never a case for continuing written by me.**
- **Its verdict is recorded as a grant in `extensions.json`**, `kind:
  "adjudicator"`, with the specific unaddressed behavioural risk in `reason`.
  That is the file the budget gate actually reads, so a verdict written
  anywhere else changes nothing — and the old text sent it to a
  `loop-extension-<pr>-<n>.json` receipt that no plan loop can key. A `stop`
  verdict writes no grant: the allowance already refuses, and the loop ends
  there.

`allowanceFor` enforces the leash on that grant mechanically — an `adjudicator`
grant cannot open a round past budget + 3, and past there the grant is David's,
`kind: "david"`. So the judge cannot extend itself indefinitely even if a
verdict tried to.

Everything else about dispatch is unchanged: agent type
`review-loop-adjudicator`, no per-invocation model or effort, and its verdict
decides.

**This does not touch code loops.** Their round-3 dispatch stands exactly as
[`claude-core.md`](../../../.agents/core/claude-core.md) states it.

## The reviewer's identity is pinned

`gpt-6-astra`, `xhigh`, read-only. `--model`, `--effort` and `--sandbox` are
**refused** unless `--unpinned "<why>"` is given, and the reason is stamped on
the round — so a loop run against a weaker reviewer says so on its own record.
`danger-full-access` is refused with or without it: the reviewer reads, and
nothing it does needs to escape a sandbox. If it genuinely must run the suite,
that is `workspace-write` on a **scratch checkout**, never the live tree.

The point is not that the flags are dangerous to type. It is that the two
things this design exists for — an independent reviewer, and one that cannot
edit what it is judging — were both one unnoticed flag away from being lost.

## When the reviewer cannot run

**Sign-in is per session and never stored.** The script exits **2** when there
is none, with the device-code instructions and without running anything. Get
one before the loop starts, not mid-round:

1. `npm install @openai/codex` in a scratch directory; set `CODEX_BIN`.
2. `codex login --device-auth </dev/null`, detached — the poller must stay
   alive to collect the token when David approves.
3. Hand David the URL and code as a 🛑 with a push notification, **in the same
   turn**: the code expires in about 15 minutes, so preparing other work first
   wastes it.

The bundle stays in `$CODEX_HOME` for the life of the container. It is never
written to the environment block, never sent through chat, and never handed
over in a file. The classifier refuses that write, and **that refusal is the
rule working, not an obstacle to route around.**

**A round that returns no schema-valid document did not happen.** The script
re-asks once and then writes no JSON at all. Do not count it, and never
summarise an unvalidated document to David as a review.

**If Astra is unreachable or the allowance is exhausted**, say so as a 🛑 and
stop — do not silently fall back to reviewing my own plan. The manual
paste-into-ChatGPT path remains available as the human fallback, and I say
plainly when I am on it.

Other gotchas — closed stdin, the read-only sandbox blocking `/tmp`, detaching
a long run, and why `pkill -f 'codex exec'` kills the calling shell — are in
[`codex-cli-in-container.md`](../../../.agents/memory/codex-cli-in-container.md).

## Close-out

Two ways a loop ends: the stop rule above, or an adjudicated stop at the budget
cap. Both close the same way.

1. **Redeploy the Artifact page one last time**, with the final "what changed"
   section and any remaining open items named.
2. **Ask David for approval**, linking that page. The ask carries the
   loop-close trail in product English: rounds run, the finding trend, what the
   reviewer still disagrees with and why I declined it, any adjudication that
   fired. **Rounds run also goes in the workstream issue's harvest comment**,
   and that is not bookkeeping for its own sake: with no PR, the harvest
   comment is the only place `/maintenance` can read plan-loop cost from. Leave
   it out and the process-health numbers silently omit every plan loop.
   **A private-path workstream has no public issue**, deliberately — its
   tracking is the draft Project item
   ([`workstream-tracking.md`](../../../docs/ai-context/workstream-tracking.md)).
   The same trail goes in that item's note instead, and never on any public
   surface; `/maintenance` reads it from there. If there is no item either,
   the trail goes in the approval ask and `/maintenance` is told the loop is
   uncounted, rather than a public issue being created to hold it. This is the first moment he re-enters a loop that ran without him, so
   the trail is what he audits before approving.
3. **Plan approval is explicit only.** Reviewer convergence is not approval.
   The scope gate authorized the loop to *review* without check-ins, never to
   build.
4. **The plan file reaches `main` only if David asks.** Otherwise it stays in
   the working tree and the Artifact page is the record. What survives a loop
   by default is the approved plan's oracle, quoted verbatim into the
   implementation PR body, plus the harvest comment on the workstream issue.

**Provenance for the implementation PR declares `private-plan`.** Not
`approved-plan`, which requires a `plan_review_pr` this loop does not produce —
and there are no optional keys, so a block missing it is refused rather than
accepted with a gap. `private-plan`'s keys already describe exactly what an
in-session plan is: a file that was never committed, identified by name and
digest.

````markdown
```plan-provenance
kind: private-plan
plan_filename: PLAN_<SLUG>.md
plan_sha256: <sha256sum docs/plans/PLAN_<SLUG>.md — the 64-char digest>
approved_by: David
approved_on: <YYYY-MM-DD>
```
````

The digest is in the round's `.meta.json` as `planSha256`, so it is copied
rather than recomputed — and it pins **which text** David approved, which
matters more here than it used to: there is no commit and no PR page holding
the approved revision. Keys, grammars and what the block does not replace:
[`plan-provenance.md`](../../../docs/ai-context/plan-provenance.md).

## The workstream issue

### First: make sure it exists

**A label transition needs an issue to carry it.** The loop no longer opens a
PR, so the issue is the *only* spine this work has until an implementation PR
exists — and a plan loop that runs without one is invisible to the Project, to
`/status-all` and to `/maintenance` for its whole life. Do this at the scope
gate, before the first label below is touched:

0. **First ask whether this work may have a public issue at all.** Sensitive
   and disclosure-carve-out work — an unpatched vulnerability, auth-bypass
   specifics, payment-fraud paths, private customer data, embargoed work —
   **never becomes a public issue**, per
   [`agents-core.md`](../../../.agents/core/agents-core.md)'s *Workstream
   tracking*. It is a **private draft Project item** instead: create or reuse
   that, and skip steps 2 and 3 entirely. Step 1 still applies if a public
   issue legitimately already exists for non-sensitive work.

   **This step is numbered zero because it has to run before the others, not
   alongside them.** Steps 2 and 3 both end in a public issue, so a carve-out
   that reaches them has already lost — the title alone can carry the thing
   the carve-out exists to protect. This is also the one step in the recipe
   whose failure mode is disclosure rather than bad bookkeeping, so when it is
   unclear whether a plan is sensitive, treat it as sensitive and ask David;
   an unnecessary draft item costs nothing and is trivially promoted, while a
   public issue cannot be unpublished.

1. **The issue may already exist** at `stage:planning` — a workstream that was
   already being tracked. Nothing to do.
2. **Otherwise check the backlog first**, per
   [`workstream-tracking.md`](../../../docs/ai-context/workstream-tracking.md)'s
   *The backlog* section. This plan may be exactly a `queue:`-labeled item
   David is now starting rather than a brand-new workstream. If a matching
   backlog issue exists, **promote it** — drop `queue:`, add the full label
   set — rather than opening a second issue for the same work. Skipping this
   search duplicates the issue and orphans the backlog one open forever.
3. **Only when no backlog match exists** — a Discovery conversation that went
   straight to a plan without ever getting an issue — open a genuinely new
   one, with the full initial label set (`stage:planning`, `waiting:claude`,
   `mode:feature`) **and** a State of Play block, not just the issue itself.
   An issue without those labels is invisible to `/status-all`, which filters
   on `stage:`, and to the board's sync Action — so skipping them is not a
   lighter kind of tracking, it is none.

### Then: keep its labels current

Per [`workstream-tracking.md`](../../../docs/ai-context/workstream-tracking.md),
for a workstream at `stage:planning`:

- **The SOW banner posts** (and at round 0's hand-over) → `waiting:david`.
- **David agrees the SOW** → `waiting:claude`, and it stays there for the whole
  loop. There is no `waiting:codex` state any more: a round is a local process
  I am waiting on, not a remote reviewer, so I am the holder throughout.
- **The approval ask posts** → `waiting:david`.
- **David approves** → `stage:coding`, `waiting:claude`.

### And at approval, if the plan ships in phases: write the checklist

**This is this loop's one phase obligation, and nothing else performs it.**
`workstream-tracking.md`'s ownership table assigns the Phases checklist to
this skill by name, at exactly this moment; there is no second trigger
anywhere that would catch a miss.

At David's approval of a **phased** plan, write the **Phases checklist** into
the parent workstream issue's body, with *every* phase listed and each marked
`not yet opened`. Writing only the phases that start immediately defeats the
point: the checklist is the sole durable record of what the feature still
owes, and a phase absent from it is a phase `/next` cannot see and nobody will
remember.

**This loop never opens a phase sub-issue itself, for any phase, including the
first.** Its lifecycle ends at this approval handoff and does not run again for
phase 2 onward, so putting phase-opening here would work by accident for phase
1 and silently fail for every phase after it. Opening a phase's sub-issue
happens uniformly when that phase's implementation starts, which is the product
implementation skill's job — the same skill for phase 1 as for phase 8.

**A split is proposed to David, never declared silently.** The checklist is
written *after* he approves the phased shape, never as a way of announcing one.

## What this skill no longer does

Deleted rather than kept as history, because a retired instruction that is
still readable is one an agent follows. Recorded here in one list so a reader
of the old loop can find each piece's fate:

| Retired | Why it existed | What replaced it |
|---|---|---|
| The `[PLAN REVIEW]` PR, its branch, its body template, the findings ledger | The reviewer was remote and diff-anchored | A local round JSON and one Artifact page |
| The `-combined` branch for a step-10 split | A split plan had no single URL | The Artifact page is the single URL |
| Round counting from GitHub, the round-check receipt, the trigger guard | Round state lived on GitHub | Rounds counted from `.agents/reviews/<slug>/round-N.json`; the budget enforced by the script |
| `review-budget.mjs` / `review-loop-record.mjs`, for plan loops | Both are keyed to a PR number | `--tier` plus `extensions.json`, local |
| The disclosure gate on the plan | The channel was public | The plan is never published |
| The three-round minimum and the fresh-lens stop condition | A defect-only reviewer could not say *done* | `required_revisions` empty and priors reconciled |
| The round-3-onward adjudicator dispatch, for plan loops only | Nothing could tell required from recommended | The reviewer's own required/recommended split |
| The growth tripwire's line-count ledger | A proxy for convergence | The stop rule reads convergence directly |
| Deriving the status label and reconciliation myself | The transport could not carry them | The reviewer returns both, in fields |
| `SendUserFile` as the plan fallback | No PR page on the private path | The Artifact page, which is already private |
