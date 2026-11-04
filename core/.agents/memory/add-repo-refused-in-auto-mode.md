---
name: add_repo with push access is refused in auto mode — /sync-fleet stops at its first step until David approves it
description: In a cloud session running in auto mode, `add_repo` (`access: "push"`) for a consumer repository is refused by the permission classifier with the reason "Access Added As A Means". It is not a GitHub or org-access failure. The same call succeeded once David answered the 🛑 and the session left auto mode, so the remedy is his approval, never a workaround.
---

<!-- SYNCED FROM KITT — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change KITT instead. -->

# `add_repo` is refused in auto mode, and only David's approval clears it

## What was measured (KITT, 2026-11-04)

`/sync-fleet` Step 2 attaches each consumer with `add_repo`,
`access: "push"`. In a session in auto mode, both calls (Overhype.me and
DojoOS) came back:

> Permission for this action was denied by the Claude Code auto mode
> classifier. Reason: [Access Added As A Means].

Nothing was wrong with GitHub access: `list_repos` listed both
repositories with `"can_push": true` in the same turn. David answered the
🛑 with *"1. Try again now."*, the session left auto mode, and the same two
calls returned `"status":"appended"` with clone instructions.

## What to do

- **Expect it.** A `/sync-fleet` run from an auto-mode session will stop at
  Step 2. That is the permission layer working, not a broken sync. Do not
  re-try it in a loop.
- **Never work around it.** Do not route the sync through another session
  that already has the repositories attached, and do not push to a
  consumer by any other path. Getting another session to do what this one
  was refused is the same denial, laundered.
- **Ask once, as a 🛑**, naming the refused call, its quoted reason, and
  the options: approve it and retry; let the next sync carry the delta;
  or have David run the sync from a session that already holds the
  repositories. Then wait for his answer.
- **Once attached, a repository stays attached** for the rest of the
  session. Only the first attach in a session is gated.

Whether `add_repo` is refused in auto mode every time, or only for
`access: "push"`, is `unable to verify: one session, one pair of calls;
the next auto-mode /sync-fleet run is the measurement`.
