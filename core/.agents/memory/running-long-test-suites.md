---
name: Running long test suites in the bash tool
description: How to reliably run the multi-minute test suites without the bash tool killing the process mid-run
---

<!-- SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead. -->

# Running long test suites without losing output

**Symptom:** running a multi-minute suite in the foreground piped to `tail`
(e.g. `pnpm test 2>&1 | tail -20`) returns `exit code -1` with **no output**.
This is the bash tool killing the foreground subprocess before it finishes —
it is NOT a test failure and NOT a time-limit wrapper.

**Rule:**
- For a runner that flushes line-by-line (node:test does): run detached and poll
  **in the same bash call** so the shell stays alive:
  `setsid bash -c '<cmd> > /tmp/x.log 2>&1; echo "EXIT=$?" >> /tmp/x.log' < /dev/null & disown; sleep <N>; tail /tmp/x.log`.
  node's test reporter flushes line-by-line, so the log is complete on poll.
- Backgrounding in one call and polling in a *separate* call does NOT work — each
  bash call is a fresh shell; the `&` job gets SIGHUP'd when the first call returns.
- **A runner that buffers its summary shows an empty log while it is still
  going.** That is not a reason to give up: most such runners flush on process
  exit, so keep polling for the `EXIT=` marker the wrapper appends — when the
  marker is there, the summary is too. Judge by the marker, never by the log
  looking empty at one moment.
- **Only when a runner still writes nothing after the marker appears** is it
  genuinely unobservable through a redirected log. Then don't fight it — run
  that suite through CI and read the workflow's status, where a clean finish
  means the runner exited 0. (**Overhype:** vitest in the frontend package is
  the one known to behave this way; its `sentry-tests` workflow is what gets
  read instead.)

**Why:** the `-1`/no-output result is easy to misread as a test failure or a
"time limit"; it is neither. Reaching for the wrong pattern wastes many turns
re-running the same suite.

**How to apply:** whenever a suite takes >~60s, reach for the detached+poll or
workflow pattern up front instead of foreground-pipe-to-tail.
