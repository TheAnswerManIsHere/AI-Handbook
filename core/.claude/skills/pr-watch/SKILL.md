---
name: pr-watch
description: Use after opening or being re-engaged on any PR, and whenever a github-webhook-activity event arrives for a watched PR. Implementation PRs only — plan review runs in-session and opens no PR.
---

<!-- SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead. -->

# Watching the PRs I open

**This file was 1,182 lines before the #89 cut, and most of that was mechanics
for machinery that no longer exists**: budget cadence, receipt shapes, snapshot
recipes, round-count recovery and adjudicator dispatch. All of it is gone,
along with the scripts it drove.

**What is here is what survived the deletion, plus one restoration.** The
rewritten, re-sequenced version of this skill — the draft-first flow, the
judge's dispatch step, the gap-issue step and the shared-vocabulary
references — is deliberately NOT in this PR; it lands with the rulebook
rewrite, beside #92. So a step below that reads thin is thin on purpose: this
change removes, it does not re-specify.

**The restoration, because a strip that overshoots is a deletion nobody
approved.** Most of the old reply section was a second statement of
`claude-core.md` rules 5 and 6, and losing a second copy is the point of this
cut. But three things lived *only* here and rule 6 still points at them — the
class-level sweep and the two escape valves on the `Oracle:` line. Stripping
those would have left the always-loaded contract pointing at a spec that no
longer exists, which is a worse outcome than the duplication. They are back in
step 5, stated once, with the duplicated material left out.
## The loop

1. **Subscribe, immediately, on whatever tier the session is on** (David,
   2026-08-15, retiring the Sonnet gate). There is no model gate and no tier
   gate. An open PR I created and am not yet watching gets subscribed the
   moment I notice it, without David re-asking.

   **One exception, and it is not optional** (Codex, PR #458 round 1): a
   `/document` harvest PR is subscribed only at step 5 of
   [`documentation-workflow.md`](../../../docs/ai-context/documentation-workflow.md),
   after the workstream issue exists and the PR body's `Workstream:` line
   points at it. Subscribing performs label writes, so subscribing early
   labels an untracked draft against a missing or wrong issue.

2. **Read live PR state on every event.** One batched `pull_request_read`:
   threads, CI, latest commits. **Never judge a webhook event from its text
   alone** — webhooks lag, drop CI successes and arrive out of order, so
   silence is never "all clear". An echo of my own comment still gets the
   silent live-state check and produces no output on either surface.

3. **Triage every finding before writing anything for it**, under
   `claude-core.md`'s review-loop rules: fix / accept-and-document / escalate,
   stated explicitly, with the `Worth:` test deciding whether a fix is written
   at all. **The external adjudicator that used to rule on this was removed by
   the #89 cut**; until #96 lands the call is mine, and a fork or a call I am
   unsure of goes to David.

4. **Batch the fixes.** Everything being written for goes in one push, with the
   repo's own fast checks run first — lint, format, typecheck, the changed
   suites. One validated push beats three speculative ones, because each push
   costs a full round.

5. **Reply to every finding and resolve its thread**, right after posting that
   reply, never in a batch, and never as a standalone summary comment in place
   of per-thread replies. The reply carries the fields `claude-core.md` rule 6
   requires — `Class:` / `Worth:` / `Oracle:` / `Result:`, in that order, with
   the outcome said in plain words in the first sentence. **What those lines
   mean is stated once, in rule 6 and rule 5, and is not restated here**; a
   second copy is what this cut exists to stop. What is here is only what rule
   6 points at and states nowhere else:

   - **The sweep is class-level, always.** A fix closes the class the finding
     belongs to, not the line the reviewer happened to land on, and the
     `Oracle:` line carries the command that proves it. Measured cost of not
     doing this: on #553 I posted twenty-plus replies across five rounds that
     read as thorough — naming the class, describing what I had checked — and
     ran zero commands. **Prose that sounds thorough is not an oracle that
     ran**, so the command runs *before* the reply is written and `Result:`
     transcribes its real output.

   - **Escape valve 1 — a class with no mechanical oracle.** Some classes are
     design judgement or naming preference and cannot be enumerated by any
     command. The reply says so on the Oracle line rather than going silent:
     `Oracle: none — <why this class is not mechanically enumerable>`. That is
     a claim I can be held to; silence is not.

   - **Escape valve 2 — the class has exactly one member.** `instance = class`
     is not an exemption from the oracle line. The command that proves the
     class has one member goes on `Oracle:`, and its `1` goes on `Result:`.

   - **The prose is held to the `Result:` bar.** A sentence in the reply's
     body that asserts a fact about the code — that an edit applied, that a
     flag exists, that a class has no other member — is a load-bearing claim
     under `claude-core.md`'s *A load-bearing claim is quoted, or it is marked
     unverified*: it quotes what was read, or it carries `unable to verify:`.
     A reply once passed the `Oracle:`/`Result:` lines and asserted in its
     prose a fix that had never applied (#113).

   **If I cannot write the command, I have not understood the finding** — that
   is a signal to go back to the code, never a licence to reply in prose. This
   applies to declines as hard as to fixes: declining with no oracle asserts
   the class is empty without having looked.

6. **Re-request review on the actual head.**

   - **No re-request without a behavioural change** since the last reviewed
     commit. A skill file, `claude-core.md`, or a `docs/ai-context/` contract
     counts as behavioural. A prose-only push does not buy a round and does not
     escape review either — it waits and rides the next behavioural round.
   - **Pre-registered flip conditions, in the request itself.** Name, before
     the round runs, what would stop the loop. **Each names an OBSERVABLE,
     never a judgement** (#85, 2026-09-13) — something read off the round ("a
     silent omission", "more findings than the last round"), not something I
     decide in the moment having just read the finding ("needs a new concept").
     The second kind does not fire: on #83 a judgement-shaped pair was crossed
     twice and caught once, by the round translation rather than by me, while
     #85's observable pair fired twice and decided both times without my
     judgement entering it. **A condition I have to interpret is one I will
     reinterpret.**
   - **Name the branch head, never a specific SHA** (David, 2026-08-17). Codex
     reviews the head at the moment it runs, not the SHA it was told, and the
     `**Reviewed commit:**` line it emits is what binds.
   - **The re-request says what to reconcile.** A bare trigger on a fix round
     invites a review of just the new commits, so the round context names which
     findings it was meant to close and asks for each to be confirmed resolved
     in the code, not merely responded to.
   - **The trigger comment carries no prose of mine** — the defanged trigger
     `atC0dex r3view` and nothing else (`claude-core.md` interaction rule 11).
     Round context and flip conditions go in a separate defanged comment posted
     just before it.
   - **Verify CI on the SHA that is actually HEAD**, not the one last looked
     at. `get_check_runs` returning `total_count: 0` means checks have not
     reported yet, which is not green and must never be reported as green.

7. **Translate the round for David (D0), after the trigger is posted.** Never
   before: a translation I could act on is an in-loop advisor reading my own
   prose. The page link posted on the PR is the delivery record — the
   `Rounds translated` merge-gate item that used to prove this went with the
   gate.

   **D0 cannot run until #95.** Its record builder read the review snapshot
   this cut removes, so the dispatcher refuses the role. Post a plain-English
   round summary on the PR myself and say in it that the translator could not
   run. Do not repair the plumbing — #95 replaces it.

8. **Merge, sync, report**, per `claude-core.md`'s *Close-out is mine, end to
   end*: re-verify live state with a fresh `pull_request_read` — not cached
   green — then squash-merge, trigger the Repl sync and verify it, execute the
   Post-merge verification section, post the harvest-notes comment, and send
   the merge report with both SHAs, the latitude line and the UAT handoff.
   **No readiness receipt is minted or quoted**: `pr-ready.mjs` is gone, and
   the four-item bar is read by eye.

## One standing stop

**A Codex code-review outage is a FULL STOP**, not the security-review
usage-limit bounce. Stop building, tell David as a 🛑 with a push
notification, say which PRs are blocked and in what state, and wait.

## Keeping the workstream issue's labels current

Per [`workstream-tracking.md`](../../../docs/ai-context/workstream-tracking.md),
`pr-watch` owns `stage:code-review` and everything downstream of it for the
PR's workstream issue (found via `Workstream: #N` in the PR body — if it's
missing, that PR skipped the tracking convention; flag it rather than
silently leaving the workstream unlabeled):

- **PR opens / round 1 triggers** → `stage:code-review`, `waiting:codex`.
- **Codex posts findings, I start responding** → `waiting:claude`.
- **I post the next round's `@codex review` trigger** → `waiting:codex`.
- **A genuine design/architecture decision goes to David** (the escalate
  rule above) → `waiting:david`; `stage:code-review` stays put — the stage
  hasn't moved, but the turn has.
- **CI is green and Codex has converged, and every thread is resolved** →
  the ready bar is met and **I merge it myself per CLAUDE.md's close-out
  contract (David, 2026-08-15)** — re-verify live state, squash-merge, sync,
  verify, report — so `stage:merge` is normally a moment, not a resting
  state. There is no carve-out exception any more (David, 2026-09-14): a
  guardrail- or authority-widening PR merges the same way, with the latitude
  it grants named in the report.
- **The PR merges with a Post-merge verification section that has real
  content** → `stage:test-run`, `waiting:replit` — the lifecycle's own
  Test-run stage, between Merge and UAT, not a step to skip past. Per the
  `pr-docs` contract this stage is now **executed inside close-out**: I
  drive the section through the connector, read the results, and on a
  clean pass move the label myself to `stage:uat`/`stage:close-out` per
  the next bullet's check, in the same close-out sequence. A failure
  keeps the workstream here while it routes through the normal channel.
  (The `test-run-completion.yml` Action that used to own this transition —
  built on PR #334 when file deletion was the completion signal and no
  agent owned the moment — is retired along with the TEST_RUN file
  pattern, 2026-08-15: close-out now has an owner, me. A **legacy**
  `docs/tests/Replit/PR<N>_..._TEST_RUN.md` doc still on `main` follows
  this same flow, plus deleting the doc on a full pass — a tiny deletion
  PR, self-merged; the label move is likewise mine, since the Action is
  gone.)
- **The PR merges with "none needed" verification** → `stage:uat` **only
  after the close-out sync checks pass, and only if a UAT doc
  exists or is actually due**. The transition moment is the verified Repl
  sync (matching SHA + clean worktree, per CLAUDE.md's close-out
  sequence), not the merge click — a failed sync would otherwise put a
  David-held UAT gate on the board for a build he can't actually reach;
  until the checks pass the workstream stays agent-held in close-out.
  On the UAT-doc test: pure-docs/pure-devops PRs never have one,
  and neither does a Tier A bugfix or a Tier B bugfix whose only surface is
  internal (per `working-modes.md`'s Tier B exception): all three go
  straight to `stage:close-out` instead, since holding them at `uat` would
  be a gate with nothing to run against it. "Has product-visible behavior"
  is *not* the test by itself — a Tier A fix can be product-visible and
  still ship no UAT doc, which is what makes checking for the doc the right
  test, not the behavior. **When that straight-to-close-out case is a
  product-visible fix that shipped no UAT doc (the Tier A case), the
  close-out State of Play's *What you need to do* aims David instead of
  saying "nothing" (David, 2026-08-09):** one line — where in the app to
  glance next time he's there, and to reopen the workstream if the symptom
  persists. No gate, no extra stage — David is the acceptance test whether
  or not a stage tracks it; this just points him. Never `stage:done` at
  merge — that's David's to set once he's actually verified it, the same
  reason the Project's built-in `PR merged → Done` workflow is off.

**If this PR is one phase of a phased feature, every `waiting:` toggle
updates the parent too — not just close-out.** Per
[`workstream-tracking.md`](../../../docs/ai-context/workstream-tracking.md)'s
*Phased features* section, the parent's `waiting:` is supposed to mirror
whoever holds the active phase at all times. Touching it only at close-out
leaves the parent showing a stale holder for the entire review-and-merge
cycle of every phase — so **each time this section moves the phase issue's
`waiting:`** (round-by-round toggling, escalation, merge), mirror the same
value onto the parent, in the same edit, State of Play included.

**The parent's Phases checklist moves when the phase issue itself reaches
`stage:close-out` — never at merge.** This is the same distinction the
general flow above already makes for an ordinary workstream (merge is not
verified work; David's UAT is) — a phase is no different. A product-visible
phase merges into `stage:test-run`/`stage:uat` like any workstream and sits
there through David's UAT before reaching `stage:close-out`; a phase with
no UAT reaches `stage:close-out` sooner, immediately after its verification
checks, but through the same transition, not a merge-time shortcut. Ticking
the checklist at merge instead would let `/next` treat a phase as done —
and surface the next phase, or close the parent — while its own UAT is
still outstanding.

**Keep mirroring the parent's `waiting:` through this entire span**, per
the toggle rule above — that already covers the phase's `stage:uat`/
`waiting:david` transition, so the parent correctly shows "waiting on
David's UAT" for exactly as long as that's true.

**When the phase issue reaches `stage:close-out`, move the parent's
checklist**, in the same edit as the phase's own transition:

- **Tick this phase's checkbox** in the parent's checklist, replacing
  `(active)` with the merged PR number.
- **Re-point the parent's `waiting:`** at whoever holds the next phase — or
  `waiting:claude` when the next phase hasn't been opened yet, since an
  unstarted next phase is work owed, not a resting state.
- **If this was the last phase**, move the parent straight to
  `stage:close-out`. There is no separate whole-feature UAT gate — every
  phase already ran its own UAT wherever it was product-visible, per
  `workstream-tracking.md`'s *Phased features* section, so a UAT stage here
  would be a gate with nothing left to run against it.
- **If a phase's own UAT surfaced a bug**, that's the UAT-descent case —
  see `workstream-tracking.md`'s *When UAT finds a bug* section for the
  `Blocked by:` marker that records the way back up. The phase stays open
  (not `stage:close-out`) until that descent resolves, so the checklist
  correctly doesn't tick early.

**At the close-out of any workstream, check whether it was the target of a
`Blocked by:` marker** — one `search_issues` call, `"Blocked by: #<this
issue>" in:body`, trusted-issue filtered the same way every other marker
lookup here is. If a match comes back, that match is a parent this closure
just unblocked — but what to do about its `waiting:` depends on whether
this is the UAT-descent shape:

- **If the matched issue's State of Play records a stashed prior
  `waiting:` value** (only `bugfix`'s UAT-descent intake writes one, per
  `workstream-tracking.md`'s *When UAT finds a bug*) — **restore it**
  (normally back to `david`) and remove the now-stale `Blocked by:` line.
  Skipping this leaves the unblocked parent sitting at `waiting:claude`
  indefinitely — mechanically releasable per the `Blocked by:` contract,
  but with no open question left for anyone to notice needs restoring.
  **If that matched issue is itself a phase sub-issue, restore its
  parent's `waiting:` the same way, in the same edit** — `bugfix` mirrors
  the descent flip onto the parent at intake, so the restore has to mirror
  back the same way, or the parent is left stuck at `waiting:claude` after
  the phase itself has already recovered.
- **Otherwise** — an ordinary workstream-to-workstream dependency, or a
  blocked backlog item — **only remove the stale `Blocked by:` line.**
  Nothing stashed a prior value for these, so guessing a `waiting:` (or
  adding one to a `queue:`-only item that shouldn't carry the label at
  all) would fabricate state instead of restoring it. Their own next
  `waiting:`-touching moment sets the right value normally.

**Every transition above lands with a State of Play update in the same
edit** — the block's `Stage`/`Waiting on`/`Last movement` fields at minimum,
and `Where it actually stands`/`What's blocking` whenever there's real
narrative to add (a round's findings, an escalation's actual question, what
shipped at merge). Per `workstream-tracking.md`'s ownership rule: the skill
that moves the label moves the block, in the same edit, every time.

An echo of my own comment bouncing back as a webhook event still needs the
silent live-state check like any other event, but never a label change on
its own — only real state (a new commit, a new finding, an actual merge)
moves a label.

Codex (and other AI reviewers) remain the independent reviewers; my job while
watching is to *respond* — fix the mechanical, escalate the substantive.

