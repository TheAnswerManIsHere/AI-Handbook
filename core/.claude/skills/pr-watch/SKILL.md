---
name: pr-watch
description: Use after opening or being re-engaged on any PR, and whenever a github-webhook-activity event arrives for a watched PR. Implementation PRs only — plan review runs in-session and opens no PR.
---

<!-- SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead. -->

# Watching the PRs I open

An operational checklist. The **meaning** of the words used here — the four
dispositions, the tiers as rubric selectors, the escalation precedence, the
verification rule, the settled-decline rule and the six-hour hard stop — is
stated once in `claude-core.md`'s *Review loops → The shared vocabulary*, and
is deliberately not restated. So is the write-gate rule, the proxy's authority,
and the `Worth:` principle.

This file was 1,182 lines before the #89 cut. Most of it was budget cadence,
receipt shapes, snapshot recipes and adjudicator dispatch mechanics for
machinery that no longer exists. What is left is what a session actually does.

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

2. **Open every PR as a draft** (#97). GitHub disables Merge on a draft, and
   the *Draft* badge tells David at a glance that it is not ready. It is
   marked ready only at step 9.

3. **Read live PR state on every event.** One batched `pull_request_read`:
   threads, CI, latest commits. **Never judge a webhook event from its text
   alone** — webhooks lag, drop CI successes and arrive out of order, so
   silence is never "all clear". An echo of my own comment still gets the
   silent live-state check and produces no output on either surface.

4. **Send the round to the proxy before writing anything for it** (#96). It
   reads the round and returns a disposition per finding plus a direction. Its
   per-finding answer decides; its direction is advice. Its rendered answer is
   posted on the PR as a plain-English comment — that comment is the durable
   record of its reasoning, and it is rendered from the validated answer, never
   paraphrased by me.

   **Recheck the live head before acting on any disposition**, not only before
   finishing. A moved head invalidates the answer for the new head; the old
   answer is kept as history.

5. **Batch the fixes.** Everything the proxy ruled *write* goes in one push,
   with the repo's own fast checks run first — lint, format, typecheck, the
   changed suites. One validated push beats three speculative ones, because
   each push costs a full round.

6. **Reply to every finding and resolve its thread**, right after posting that
   reply, never in a batch, and never as a standalone summary comment in place
   of per-thread replies. **The first sentence says fix or decline, and why.**
   A reply citing a command ran it first and transcribes its real output.

7. **Re-request review on the actual head.**

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
     Round context, flip conditions and the proxy's summary go in a separate
     defanged comment posted just before it.
   - **Verify CI on the SHA that is actually HEAD**, not the one last looked
     at. `get_check_runs` returning `total_count: 0` means checks have not
     reported yet, which is not green and must never be reported as green.

8. **Translate the round for David (D0), after the trigger is posted.** Never
   before: a translation I could act on is an in-loop advisor reading my own
   prose. The page link posted on the PR is the delivery record. The final
   round's account also carries what is shipping as a known gap.

   **While D0's plumbing is being rebuilt (#95) this is a hand-written
   comment.** Its record builder read a review snapshot assembled by machinery
   the cut removed, so the dispatcher refuses the role. Post a plain-English
   round summary on the PR myself and say in it that the translator could not
   run. Do not repair the plumbing — #95 replaces it.

9. **Mark the draft ready for review once the four reads pass**: CI green,
   Codex returned for the head commit, every thread resolved, every round
   delivered to David. Marking it ready is what asserts the bar — there is no
   receipt behind it. The merge report names the moment it happened.

10. **File the gap issues** (#98), before the merge report. Every finding the
    proxy ruled *decline as a recorded gap* gets one issue, labelled `gap` plus
    the workstream's `mode:` label, carrying the finding verbatim with its
    thread link, the reasoning for declining it now, this PR, and the
    workstream issue. A *no change needed* gets none. On a disclosure-gated
    workstream the gap goes on the private path and the public record says only
    that one exists and where it lives.

11. **Merge, sync, report.** Re-verify live state with a fresh
    `pull_request_read` — not cached green — then squash-merge, trigger the
    Repl sync and verify it, execute the Post-merge verification section, post
    the harvest-notes comment, and send the merge report with both SHAs, the
    moment the draft was marked ready, the gap issues, the latitude line and
    the UAT handoff. Full sequence: `claude-core.md`'s *Close-out is mine, end
    to end*.

## Two standing stops

- **A Codex code-review outage is a FULL STOP**, not the security-review
  usage-limit bounce. Stop building, tell David as a 🛑 with a push
  notification, say which PRs are blocked and in what state, and wait.
- **Six hours of unattended elapsed time on one PR loop** — read from the PR's
  age on GitHub, not counted in rounds, not reset per dispatch — pauses the
  loop and asks David to resume. Expiry is never convergence.

## Worth, worked — stated once, here

`claude-core.md` states the principle: a fix needs a likely occurrence and a
consequence someone would feel, judged at the level of the finding's **class**
rather than its reported instance. The three worked cases, which is what makes
it usable rather than a slogan:

- **Derivable** — this code already holds what the input carries. Remove the
  input and derive it; never add a check, because a check whose two sides I own
  guards nothing. That is a write, so a round is owed.
- **A choice** — intent this code cannot know (`--role`, `--timeout`,
  `sync --to`). It stays an input with a cheap well-formedness check; a
  hostile-value defence on it is declined, because the only party supplying it
  is the operator running the script.
- **A value from outside my control** — only this one goes on to likelihood ×
  consequence. Missing either, it is a one-line decline shipped as a gap,
  however small the diff looks, because each fix costs a round and the
  aggregate is never weighed at the moment of the decision.

Two classes settled as standing declines (David, 2026-09-11), because I kept
building for both: **accounting precision** — a miscounted round changes no
decision, so machinery that makes a count exact is pure cost — and **my own
influence on my own tools**, since I run every script here and a defence
against my editing its inputs is a lock whose key is on the same ring. The
real controls are the server-side rulesets and David working beside me, reading
the latitude line every widening PR carries.

## Keeping the workstream issue's labels current

Per [`workstream-tracking.md`](../../../docs/ai-context/workstream-tracking.md),
`pr-watch` owns `stage:code-review` and everything downstream of it for the
PR's workstream issue (found via `Workstream: #N` in the PR body — if it's
missing, that PR skipped the tracking convention; flag it rather than
silently leaving the workstream unlabeled):

- **PR opens / round 1 triggers** → `stage:code-review`, `waiting:codex`.
- **Codex posts findings, I start responding** → `waiting:claude`.
- **The proxy raises a question only David can answer** → `waiting:david`,
  set when its comment is posted and cleared when he answers.
- **I post the next round's `@codex review` trigger** → `waiting:codex`.
- **A genuine design/architecture decision goes to David** (the escalate
  rule above) → `waiting:david`; `stage:code-review` stays put — the stage
  hasn't moved, but the turn has.
- **The four reads pass and the draft is marked ready** → the bar is met and
  **I merge it myself per CLAUDE.md's close-out contract (David,
  2026-08-15)** — re-verify live state, squash-merge, sync, verify, report —
  so `stage:merge` is normally a moment, not a resting state. There is no
  carve-out exception any more (David, 2026-09-14): a guardrail- or
  authority-widening PR merges the same way, with the latitude it grants
  named in the report.
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

