# Plan review without GitHub: GPT-6 Astra as the plan reviewer

Research notes, 2026-09-09 (Fable session, exploration only — nothing built).
Repo-local, outside `core/`, so nothing here ships to a consumer. This is
the working-notes doc for the "better way to do planning" ask; the decision
lives in chat until David makes it, then belongs in `decisions.md`.

## The ask, and what it actually constrains

David's ask: a plan-review loop that (1) does not run through PRs/GitHub,
(2) uses GPT-6 Astra as the reviewer, under our control rather than the
Codex GitHub connector's, (3) is fast and efficient, (4) brings the best
intelligence available, (5) need not leave a permanent record.

Hard constraints from the environment and the contract, all **measured in
this session** unless marked otherwise:

| Constraint | Status |
|---|---|
| `api.openai.com` reachable from a cloud session | **Yes.** Node `fetch` through the egress proxy returned OpenAI's own 401 (no key) — the proxy passed it. `auth.openai.com` and `wss://api.openai.com` also pass (device-code login printed a real code; Codex's websocket transport got OpenAI's 401, not a proxy refusal). |
| `curl`/`wget` from bash | Refused by our own guard, by design. Node `fetch` and spawned CLIs are untouched (`guard-decision.mjs` says so explicitly). So the transport is a `node` script, never a shell one-liner. |
| An OpenAI credential in the session | **None today.** No `OPENAI_API_KEY`/`CODEX_API_KEY` in the environment. The only mechanism is the cloud environment's env block, which anyone using the environment can read — `web-research.md` currently forbids putting an OpenAI key there on the Firecrawl precedent. |
| Codex CLI in the container | Not preinstalled. `npm install @openai/codex` works (npm registry is proxy-exempt): v0.153.4 installed in ~7s. |
| `gpt-6-astra` in that CLI | **Yes** — the model id is in the binary's catalogue, the bundled system prompt reads "an agent based on GPT-6", and `model_reasoning_effort` accepts `xhigh` and `max`. `codex exec -m gpt-6-astra` reached the Responses API end to end (failed only on the dummy key). |
| `codex mcp-server` | **Deprecated** (the binary warns on start; changelog 2026-08-24 says use the app server or the Codex SDK). It still works today and exposes two tools, `codex` and `codex-reply`. Don't build on it. |
| Claude Code subagents on a non-Anthropic model | Not possible: `model:` accepts Anthropic aliases/ids/`inherit` only. The Advisor tool is Claude-to-Claude as well. |
| The plan-review contract | Already transport-agnostic. Its **full-assessment surface** (status label, seven sections, per-finding why/what/acceptance-check, prior-finding reconciliation) was written for a reviewer that can post a whole document — which the GitHub connector never could. A GPT-6 reviewer with a JSON output schema is the first reviewer that can satisfy the contract as written. |

GPT-6 Astra itself (subagent research, primary sources at
`developers.openai.com/api/docs/models/gpt-6-astra` and `/pricing`):
model id `gpt-6-astra`, released 2026-09-03/04, 1.05M context (922k input,
128k output), effort `low`–`max` (rejects `none`), Responses + Chat
Completions, $10/$1/$50 per 1M input/cached/output (short context) and
$20/$2/$75 long context. Available in ChatGPT Plus/Pro/Business/Enterprise
and via the API. Subscription rate limits for Astra are reported tighter
than Sol (secondary sources only; not verified against OpenAI's own page).

## Why the GitHub loop is slow and heavy — the mechanism, not the symptom

Everything expensive in the current loop is a consequence of the transport,
not of reviewing:

- **The reviewer can only post diff-anchored defects.** So the contract's
  status label, lens, "what is strong", and reconciliation cannot be
  posted; I derive them myself, keep a findings ledger in the PR body, and
  count line growth as a proxy for convergence. The minimum-three-rounds
  rule exists because a defect-only reviewer cannot say "done".
- **Round state lives on GitHub.** So rounds are counted fresh from GitHub
  each time, receipts are committed *and pushed* to exist, a guard gates
  the trigger comment, and `snapshot-from-captures` / `review-loop-record`
  exist to make GitHub state legible to the adjudicator. None of that is
  review; it is bookkeeping for a remote, unobservable reviewer.
- **The channel is public.** So a disclosure check gates every plan, and
  the sensitive path falls back to manual paste.
- **Latency is queue + webhook.** Trigger, wait for the connector, wait for
  a webhook that may never arrive, fetch, reconcile.

Move the reviewer into the session and every one of those goes away for
plan loops: the reviewer returns a whole structured document, round state
is a local JSON file, the plan never leaves the container until David reads
it, and a round is one process wait.

## Options weighed

1. **Direct Responses API call** (a `node` script sends plan + oracle +
   whatever repo context I pack; strict JSON-schema output). Fastest and
   cheapest, but the reviewer sees only what I choose to show it. That is
   exactly the failure #36 names ("if the builder writes the prompt, the
   builder can steer the reviewer") and the contract's non-negotiable
   "inspect the repo before concluding" cannot be met. Fixing it means
   giving GPT-6 read tools in a loop — which is re-implementing Codex CLI.
2. **Codex CLI in the container, `codex exec`, read-only sandbox,
   `-m gpt-6-astra`, effort `xhigh`, `--output-schema`** (driven from a
   `node` script, or via `@openai/codex-sdk`, which is a thin wrapper that
   spawns the same CLI and exchanges JSONL). The reviewer is an agent with
   the checkout: it greps, reads, runs the test suite if told to. Real
   independence (different model family *and* its own inputs), the full
   assessment shape via the schema, official and maintained, and it is the
   same engine the GitHub connector runs — minus the connector's persona,
   queue, and transport limits. **Recommended.**
3. **Third-party MCP bridges** (PAL/zen `consensus`/`codereview`,
   `tuannvm/codex-mcp-server`, council servers). An extra process that
   must be alive in the session, none confirms GPT-6 support, their tool
   workflows don't map onto the contract, and everything they offer is
   reachable by spawning `codex exec` directly. No upside; rejected.
4. **Keep the Codex GitHub connector for plans.** Rejected by the ask.

Known rough edges on option 2, from the CLI's own issue tracker (secondary):
`--output-schema` has had model-family gating bugs and is ignored when MCP
tools are active; `exec resume` doesn't support it. Mitigation: no MCP
tools in the reviewer's config, fresh thread per round, and the script
validates the JSON against the schema and re-asks once on failure.

## The proposed shape (plan loops only — code review is untouched)

Codex-on-GitHub stays David's safety net for **code**. This replaces only
the plan loop.

1. **The plan is a file in my working tree** (`docs/plans/PLAN_<slug>.md`
   on my branch), with the oracle — direction, product intent, must not
   change, settled decisions, scope boundaries, tier, criticality — as a
   fenced block at its head. It is never pushed for review; it may never be
   pushed at all.
2. **A round is one command:**
   `node core/scripts/plan-review.mjs --plan <file> --round N --lens <lens>`
   which spawns `codex exec` at the repo root with: base instructions = the
   plan-review contract's full-assessment surface; developer instructions =
   the round context (lens, toolchain exclusion, and the prior rounds'
   findings **as structured data** to reconcile); prompt = review this
   file against its oracle; `--sandbox read-only`; `--output-schema` =
   the contract's shape (status ∈ the six labels; strong / required /
   product-decisions / recommended / verified / unable-to-verify /
   previous-findings with Resolved|Still open|Superseded; each finding
   carries why / what / acceptance check / class). Output lands in
   `.agents/reviews/<slug>/round-N.json`, gitignored.
3. **Fresh reviewer context every round**, not a resumed thread. Prior
   findings are handed over as data, so the reviewer reconciles against
   the *current whole plan* (what the contract's re-review rule demands)
   instead of against its own memory, and it cannot be anchored by its own
   earlier verdicts or by my replies. Same principle as the adjudicator.
4. **Convergence comes from the reviewer, not from me.** Stop when a round
   returns *No major technical disagreement*, zero required revisions, and
   every prior finding Resolved or Superseded. The three-round floor loses
   its rationale (it compensated for a reviewer that couldn't say "done").
   A round budget (5) and the write-gate adjudicator at the budget, or on
   an `escalate`, stay — see open question 4 on whether the round-3+
   adjudication survives.
5. **Escalation is unchanged:** product/design forks and scope additions
   go to David as now/next/never; the reviewer's `product_decisions`
   section is the feed.
6. **Delivery to David:** with no PR page, the plan needs a reading
   surface he can open on the iPad. A private Artifact page (default
   private, shareable when he chooses) is the natural one, and it also
   dissolves the disclosure problem: the plan is no longer published into
   public git history. This reverses a 2026-07-28 decision that was made
   *because* the PR page existed — open question 2.
7. **Record:** the round JSONs plus the plan are the record for the
   session; if anything durable is wanted, one harvest comment on the
   workstream issue at approval, as today.

What this retires **for plan loops** (not for code loops): the plan-review
PR and branch, the `[PLAN REVIEW]` title/provenance kind, the bare-trigger
rule, the findings ledger in a PR body, round counting from GitHub, the
review-budget receipts and the guard on trigger posts, the snapshot and
record scripts' GitHub input, the disclosure check as a *gate* (it becomes
a reason to keep the Artifact private, which it is by default).

Files that change: `plan-review-loop` skill (rewrite), `claude-core.md`
Planning rules 3 and 6 and the plan-loop paragraphs of `working-modes.md`,
`plan-review-contract.md` (the full-assessment surface becomes the only
plan surface; the structured-defect-pass section stays for code), a new
`core/scripts/plan-review.mjs` + schema + tests, `web-research.md`'s
credential rule (see below). All of it is a working-contract change and
therefore David-merge-only.

## Credentials — the one real decision

Two ways to give the container GPT-6 Astra, both measured to reach OpenAI:

- **A. API key in the cloud environment's env block.** Set once, zero
  per-session friction, metered billing. Conflicts with the current rule
  ("never an OpenAI key in this block"). The rule's reasoning is blast
  radius, so the fix is the credential, not the storage: a **dedicated
  OpenAI project** holding nothing else, a **hard monthly spend cap**, and
  a key with model access only. Worst case is then "someone with the
  environment burns the cap", which is bounded and visible on the OpenAI
  dashboard. **Recommended.**
- **B. Sign in with ChatGPT via device code.** `codex login --device-auth`
  prints a URL and a one-time code; David opens the URL on his phone and
  approves — no CLI on his side. Uses his subscription's Astra allowance
  instead of API billing. Cost: the token lives in `$CODEX_HOME/auth.json`
  in an ephemeral container, so it is a ~30-second step in every session
  that runs a plan loop, and Astra's subscription limits are reported (not
  verified) to be tight. Persisting the token in the env block would put a
  ChatGPT account credential where anyone can read it — worse than A.

## Cost and speed, honestly

Per round on Astra at short-context rates: ~150k input (plan ~25k, contract
~8k, repo reads ~100k; cached rates on repeats) ≈ $1.50–3.00, plus output
and reasoning tokens (billed as output) ~20–40k at `xhigh` ≈ $1.00–2.00.
**Roughly $3–5 a round, $15–25 for a five-round loop.** Codex-on-GitHub's
marginal cost is $0 on the subscription; this is a real new line item.

Speed: a round is one agentic run — I expect single-digit minutes at
`xhigh` on a ~1,500-line plan, against today's trigger → queue → webhook →
fetch cycle, but that is an expectation, not a measurement. **The pilot is
the measurement**, which is why step 1 below is a pilot, not a rewrite.

## What GPT-6 Astra changes for #36

#36's premise was that independence "cannot come from a different model
family, since Fable and the builder share one", so it had to come from
different inputs and different questions. A GPT-6 reviewer with its own
repo access supplies the family independence #36 could not, and #36's
script-assembled-inputs rule still applies to it — the script, not I,
composes the reviewer's instructions. D1 (plan opinion for David) is a
natural second consumer of the same round JSON.

## Proposed sequence

1. **Pilot, before any contract edit.** David picks the credential (A or
   B). I write a throwaway script, run **one real round** on an existing
   plan, and report latency, cost from the CLI's usage counters, and the
   findings side by side with what Codex-on-GitHub returned for the same
   plan. That answers "faster, and is it better" with numbers.
2. If the pilot holds: the contract rewrite above, as one internal-tier
   PR, David-merge-only.
3. **Next**, not now: the same script running `codex review --base main`
   for **code** diffs under our persona and effort, as a controlled second
   reviewer beside (never instead of) the GitHub connector.

## Counter-proposal weighed: a Codex GitHub Action (ChatGPT, via David, 2026-09-09)

ChatGPT proposed keeping the PR handoff and replacing the managed Codex
reviewer with `openai/codex-action` on GitHub runners, on the premise that
the alternative needed a laptop. Verified against the action's README: it
takes `model`, `effort`, `output-schema-file`, `permission-profile:
:read-only`, and `openai-api-key` as a GitHub secret. So it can run the
same reviewer, same contract, same schema.

- **The premise is wrong.** The in-session design runs entirely in the
  Claude cloud container, which reaches OpenAI (measured above). Nothing
  touches a laptop in either design. The real axis is *where the reviewer
  process runs*: my session, or a GitHub runner.
- **What the Action genuinely buys:** the key lives in GitHub's encrypted
  secret store instead of the environment env block that anyone using the
  environment can read; and the handoff is durable and asynchronous, so a
  review lands even if my session dies mid-round.
- **What it costs, against the stated goals:** every round pays runner
  boot, queue, review, post, webhook, fetch, and our own contract records
  that webhooks lag and drop. It keeps the whole ceremony David wants gone:
  the PR, the public branch, the disclosure gate, round counting from
  GitHub, the ledger. "Preserves the existing PR monitoring" is
  overstated, since `pr-watch` parses the connector's specific comment
  shapes and would be rewritten either way. Iterating the reviewer prompt
  costs a push per try instead of a re-run. And an AI action reading PR
  content on a public repo is the prompt-injection surface the
  `agentic-actions-auditor` skill exists to audit.
- **Resolution:** not rival designs. The reviewer is one script that runs
  `codex exec` with the contract and the schema; in-session is one
  deployment target and the Action is another, using the same script. Run
  in-session now, where speed is the goal; the Action is the *next* if a
  durable asynchronous review is ever needed, or if David decides the
  secret-store argument outweighs the capped-project key.

## Using the ChatGPT Pro allowance instead of API billing (David, 2026-09-09)

No API key draws on a ChatGPT subscription; the API is metered by design.
The credential that does draw on it is the ChatGPT sign-in bundle Codex
keeps in `$CODEX_HOME/auth.json` (access token, refresh token, account
id). OpenAI documents persisting it for headless runners ("Maintain Codex
account auth in CI/CD", `learn.chatgpt.com/codex/auth/ci-cd-auth`):

- Seed `auth.json` from one real sign-in; Codex refreshes the bundle
  itself when `last_refresh` is older than about 8 days and writes the
  refreshed tokens back. Refresh tokens do not rotate on their own.
- The refreshed file should be persisted back after each run. Our
  container cannot write to the environment env block, so the stored seed
  ages; a seed too old or revoked yields 401 and needs a fresh sign-in.
  Whether a weeks-old seed still refreshes is the pilot's first
  measurement.
- One bundle per runner; treat it like a password; never in the repo,
  logs, chat, or tickets.

Flow that fits "David never runs CLI": I run `codex login --device-auth`
in the session, David approves the URL and code on his phone, the bundle
lands in the container. To persist it he pastes it into the environment
settings as one variable (e.g. `CODEX_AUTH_JSON`), which means it transits
this session's chat or a sent file once. Every later session writes the
variable to `$CODEX_HOME/auth.json` before spawning Codex.

Only two routes draw on the Pro allowance at all: the managed Codex
GitHub connector (today's), and Codex CLI signed in with ChatGPT. The
GitHub Action route bills an API key. So the subscription requirement by
itself selects the in-session design.

Blast radius: the bundle is David's ChatGPT account credential, uncapped,
readable by anyone using the environment. That is exactly what the
current `web-research.md` rule forbids; storing it anyway is David's
override, to be recorded in `decisions.md` with the dissent.

## Pilot round, measured (2026-09-09)

Setup: ChatGPT Pro sign-in via device code (worked headless through the
proxy); Codex CLI 0.153.4; `gpt-6-astra` at `model_reasoning_effort=xhigh`;
`--sandbox read-only`; `--output-schema` = the contract's full-assessment
shape (`docs/research/pilot/review-schema.json`); prompt =
`docs/research/pilot/prompt-round1.md` (apply the contract, the PR #37
oracle inline, lens "authority, bypass, sync/bootstrap ordering", the
toolchain exclusion). Reviewed the #36 phase 1a plan at the exact commit
Codex's round 3 reviewed (`e0b08b6`, worktree), so the two are
apples-to-apples. Output: `docs/research/pilot/astra-round1.json`; Codex's
round 3 on the same revision: `docs/research/pilot/codex-round3-same-revision.md`.

| Measure | Value |
|---|---|
| Wall clock, prompt to schema-valid JSON | 522 s |
| Repository commands the reviewer ran unprompted | 45 |
| Input tokens (of which cached) | 3,089,593 (2,893,824) |
| Output tokens (of which reasoning) | 13,248 (5,199) |
| Cost on the Pro plan | $0 marginal; one Codex "turn" of allowance |
| Same round at API list price | ≈ $5.50 (196k uncached × $10/M + 2.89M cached × $1/M + 13k × $50/M) |
| Smoke call at `low` effort | 12 s |

Behaviour: it read the contract, the agents core, the plan, PLANS.md and
the working rules before anything else; opened the adjudication record
`33-1.json` and confirmed the zero-size anomaly; ran `loadLoop` over every
committed receipt chain and found PR #10's fails today; ran the four
read-only repo checks; ran a Node probe to show the record-size policy
cannot terminate; tried the test suite and hit EROFS (read-only sandbox
blocks `/tmp`). Every required revision cites file:line evidence; I
spot-checked R1 (`pr-ready.mjs` 1592-1610, 1706-1720;
`review-budget.mjs` 1054) and R3 (`sync-manifest.yml` 346-350, 678-691)
and the lines say what the findings say.

Side by side with Codex's round 3 on the same revision (4 findings):

| Codex round 3 | Astra round 1 |
|---|---|
| Bind stamps to the definition the harness actually loads (P1) | **R2**, same defect, same stale-checkout route |
| Make the producer oracle find the refusal recipes (P2) | **R5**, same two line ranges, plus the missing fifth inventory result and a 6-vs-7 consumer count |
| Require the plan-review title before selecting the head oracle (P2) | not raised |
| Accept legitimate empty diffs with distinct endpoints (P2) | not raised |
| — | **R1** the always-run rail path validates receipts with `io:null`, so a clean Codex pass never opens the cited record: decision 8a is bypassable. On the lens; Codex missed it |
| — | **R3** the decline citation ships in the `memory` group, `machinery` requires only `machinery-config`: a first sync can deliver the reader without its mandatory input. On the lens; Codex missed it |
| — | **R4** the 600k total-size policy has no terminal behaviour once finding text is empty; probe serialised 919k chars of metadata alone |
| — | one product decision (PR #10's chain already fails; preserve or repair), two recommendations, seven verified claims, four honest unable-to-verify |

Reading: two of Codex's four reproduced independently, two not (both
P2), three new required revisions all on the requested lens and all
code-grounded, plus the full-assessment sections the GitHub transport
could never carry. Status returned: *Substantive technical concerns*.

Gotchas for the script:
- `codex exec` waits forever on an open stdin in this harness; run it
  with `</dev/null`, or pass the prompt on stdin with `-`.
- `--sandbox read-only` also blocks `/tmp`; if the reviewer should run
  the suite, use `workspace-write` on a scratch checkout or set `TMPDIR`.
- `pkill -f 'codex exec'` kills the calling shell too (the pattern matches
  its own command line); match on the binary path instead.
- `setsid nohup … &` is the shape that survives the tool timeout; a
  background waiter on the exit-file gives one wake-up.
