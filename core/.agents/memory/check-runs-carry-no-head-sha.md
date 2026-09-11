---
name: get_check_runs carries no head_sha — the workflow-job responses do
description: pull_request_read method get_check_runs returns id/name/status/conclusion and no head_sha, but pr-ready.mjs refuses check runs that cannot be tied to the head commit. Re-fetch each run id through actions_get get_workflow_job, which does carry head_sha and head_branch.
---

<!-- SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead. -->

## Rule

When a readiness snapshot needs check runs bound to a commit, take the run
**ids** from `pull_request_read` (`method: "get_check_runs"`) and then fetch
each one through `actions_get` (`method: "get_workflow_job"`, `resource_id`
the same id). Only the second response carries `head_sha`.

## The mechanic

`get_check_runs` returns, per run: `id`, `name`, `status`, `conclusion`,
`html_url`, `details_url`, `started_at`, `completed_at`. **No `head_sha`, and
no other field that names a commit** — `html_url` embeds a *run* id, not a sha.

`get_workflow_job` on the same id returns `head_sha` and `head_branch` beside
the same `name`/`status`/`conclusion`. Measured on AI-Handbook PR #77
(2026-09-11), job ids `103096134145` and `103096133887`: both came back with
`"head_sha": "4123ede313b8bd3f15e0fe352ecf3c0ba83b9e66"`.

## Why it matters rather than being a curiosity

`pr-ready.mjs` refuses on exactly this:

> `N check run(s) carry no head_sha, so they cannot be tied to <sha> -- capture head_sha with each run`

and that refusal is load-bearing, not pedantry. The collections in a readiness
snapshot come from separate calls, so **green checks read before a push, with
the PR metadata read after it, produce a receipt bound to the new commit whose
CI item describes the old one** — and the branch-tip comparison then agrees,
because it is also looking at the new commit. The binding is what stops a
receipt certifying CI that never ran on the merged code.

So an agent that reaches for the obvious call, finds no `head_sha`, and fills
one in from the PR metadata it already has is **fabricating the binding the
check exists to verify**. The two-call route is the difference between an
observed value and an assumed one.

## Related

- `snapshot-from-captures.mjs` does not emit `checkRuns` at all — its verified
  collections are `pr`, `reviews`, `issueComments`, `reviewThreads`. A
  readiness snapshot is therefore assembled by hand, and `pr-ready.mjs` does
  not call `assertCaptureProvenance`. That gap is AI-Handbook #74 and #75.
- Neither call pages: `get_check_runs` returns `total_count` with the runs
  inline.
