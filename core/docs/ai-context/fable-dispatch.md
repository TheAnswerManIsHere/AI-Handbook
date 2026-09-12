<!-- SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead. -->

# Dispatching Fable: what is enforced, and what is not

The mechanism under AI-Handbook workstream #36's reviewer roles. Phase 0 shipped
it with **no advisory role**: the point is that the floor exists and is what
it says before anything stands on it. Phase 1 narrowed two of the five
non-guarantees and left the rest standing, which is why this file still leads
with them. Phase 2 put the first role on the floor —
[D0, the round translation](#d0--the-round-translation), which writes to David
and decides nothing.

**Codex keeps its full fix-or-decline force on product code. Nothing here
touches it.** Neither does anything here change the `review-loop-adjudicator`,
which remains a subagent dispatch in both code loops and plan loops.

## Why this document leads with the non-guarantees

The first attempt (AI-Handbook PR #70, closed unmerged) wrote a guarantee into
the payload that nothing enforced — the builder wrote every dispatch prompt
while the prose said it could not — and stamped a model from frontmatter that
nothing established was served. Codex returned thirteen findings, all correct.

**The defect was not the missing mechanism. It was the claim.** So the shape of
this file is deliberate: every property below states what it enforces *and*
what it leaves open, and the open ones are named rather than implied. A reader
who takes only the strong halves has misread it, and the round of review that
produced this file spent three of its five rounds on exactly that risk.

## The rule under all five: observed, or refused — never coerced

Every value the receipt carries is one of three things: **observed true**,
**observed false**, or **could not observe**. The third refuses the run. It is
never turned into one of the other two by the shape of an expression — a
failed `git status` is not a dirty tree, an absent session id is not a verified
boundary, a summed metadata field is not a total, a process killed after
emitting output is not a successful run, and a total that skips an attempt it
could not price is not a total.

This is stated as a rule because it was violated six times in one review round
(AI-Handbook #73, round 2), three of them inside the previous round's own
fixes. Each instance was small; the class is the whole subject of this file.
The mechanism in code is uniform: the observation is checked, and the receipt
field exists only when the check passed. Fields that are informational copies
— `agents`, `skills`, `plugins`, `permissionMode`, `apiKeySource`,
`claudeCodeVersion` — are recorded as `null` when the harness did not report
them, and **nothing reads them as facts**; every field that *is* read as a fact
refuses on absence.

## The five properties

### P1 — the instruction frame is script-owned; brief content is not authenticated

`scripts/fable-dispatch.mjs` (under `core/` in the handbook — the sync routes
`core/X -> X`, and every path in this file is written in the consumer's layout)
composes every instruction a role receives:
the system prompt is the role definition's body, read with `git show` at a
pinned commit; the user message is a fixed frame written in that script, with
the brief quoted inside it. The caller passes a role id and a path. Free text
on the command line, and any unknown flag, are refused before anything spawns.

This holds **by construction rather than by refusal** — for the frame. The
script builds the subprocess argv and the wrapper around the brief, so the
caller cannot alter the *instructions*: not the system prompt, not the schema,
not the flags, not the sentences that tell the reviewer what the brief is. It
is the same guarantee `plan-review.mjs` has for the Codex plan reviewer.

**It does not extend to the brief's content.** The brief is inserted verbatim
inside that frame, so caller-written text *does* reach the reviewer — as
material to assess, labelled as such, but it reaches it. An earlier revision of
this paragraph said "no channel through which caller-written text could reach
the reviewer" while the next paragraph admitted the opposite; that was this
document's own defect in its own subject (Codex, AI-Handbook #73 round 2).

**What it does not do.** It does not establish who wrote a brief it did not
build. That is why it only dispatches roles whose briefs it *does* build: the
permitted set is a predicate over this script's own brief generators, not a
list, and `--brief` no longer exists. A role cannot be admitted by widening a
parameter; it is admitted by having its brief composed here. See *The
refusal*, below.

**And a brief this script builds may still carry the builder's own words.**
`round-translation`'s does, deliberately — explaining what the builder did
with each finding is its whole job. The mechanism there is **a label, not a
barrier**: every block in that brief says who wrote it, reviewer or builder
or someone else, and the role is told to check the builder's claims against
the diff (David, 2026-09-12: *"I'm not worried about the adjudicator seeing
information that the builder is providing, so long as it knows where it came
from"*). No code keeps the builder's text away from a reviewer that is
supposed to read it. What stays true is narrower and unchanged: **no
caller-written instruction** reaches any role — the frame, the system prompt,
the schema and the flags are all this script's.

The receipt's `briefSha256` is the digest of the text **as embedded in the
frame** — the frame trims the brief, and hashing the untrimmed input recorded a
digest of a document nobody read.

### P2 — the observable surface is pinned and harness-reported; instruction loading is bounded, not closed

A role's built-in tools come from its frontmatter allowlist. `Bash`, `Write`,
`Edit`, `NotebookEdit`, `Agent`, `Task`, `Skill`, `WebFetch` and `WebSearch`
are forbidden to every role whatever its definition says, and a definition
declaring one refuses before spawn. MCP servers are excluded
(`--strict-mcp-config`, no `--mcp-config`); user, project and local settings —
and the hooks and `.mcp.json` they carry — are not loaded
(`--setting-sources ""`); the default system prompt is replaced; the run gets a
fresh `--session-id` and does not persist.

**The construct is the harness's own report.** The run is launched with
`--output-format stream-json`, and its first event is a `system init` the
harness emits before the model is asked anything. The script reads that event
**on every attempt, before deciding whether to retry**, and **refuses the run
if the reported `tools` or `mcp_servers` exceed what the role allows** — the
refusal cannot wait for a valid document, because a retry cannot un-launch a
reviewer that already held a forbidden tool. It also **compares the reported
session id against the one the dispatch asked for** — and refuses when the
harness reports none at all, since an unobserved boundary is one the receipt
cannot claim — so the fresh-session boundary is verified rather than asserted. Then it copies `tools`, `mcp_servers`, `agents`, `skills`,
`plugins`, `permissionMode`, `apiKeySource` and `claude_code_version` into the
receipt. A reviewer that wanted to misreport its own surface has no opportunity
to: this is not the reviewer describing itself.

`init` lists **skills** even under this configuration (nineteen on the host
measured below). They are inert without the `Skill` tool, which is permanently
forbidden, so they are recorded rather than refused on — recording what was
present beats inventing a violation.

**What it observes about instruction content, as of Phase 1: the SIZE of the
reviewer's prompt, against what this script put in it.** `init` still does not
enumerate `CLAUDE.md`, managed settings, managed hooks or memory files. But the
harness reports its own token usage on every assistant event, and the script
knows exactly what it composed — so the receipt carries
`promptTokensObserved`, the largest any request in the run reported, and
`promptTokensBound`: the composed system prompt, user message and schema, plus
what the run itself delivered, plus a measured allowance for the harness's own
framing. **Over the bound refuses the run.**

Every event, on every attempt, and both halves matter. Context delivered after
the first request is how an asynchronous hook delivers, so a check reading only
the opening request would miss it while it still reached the answer. And a
contaminated first attempt refuses before the re-ask, because a retry does not
un-launch a reviewer that already held the context.

Measured on this host (Claude Code 2.1.268, 2026-09-11): the real probe
observed **3,269** prompt tokens against 3,575 characters composed, so the
harness's framing is ~2,300 tokens and the allowance is set at 3,500. The same
host with **default** setting sources carried **17,810** tokens for a trivial
request — the repository's instructions arriving despite a replaced system
prompt. That is the contamination this bound refuses, and it does so several
times over.

The receipt also carries two lines from the harness's own debug log, under
names that say what they report: `skillsLoaded`, and `pendingAsyncHooks` —
the size of the harness's **pending asynchronous** hook registry, which is not
a count of hooks configured or run. Absence of either line refuses the run;
neither number refuses on its value.

**What remains open, stated exactly.** A hook that injects **nothing into the
prompt** is outside both observations: the token bound sees only size, and the
registry line sees only pending async entries. So the managed-hook gap
**narrows** — anything that adds context is now caught by size, whatever
delivered it — and does not close. `--setting-sources ""` still excludes only
**user, project and local** settings, and "not loaded" is still never to be
read as "none exist".

The probe's `claudemd` field stays, and stays **a self-report**, recorded in a
field that says so, beside the observations rather than standing in for them.

### P3 — the answer's model is bound, not the run's

The receipt carries `modelRequested` and `answerModel`, taken from the
`message.model` stamp on the assistant event that produced the validated
output. **They must be equal or the run is refused.**

`modelRequested` is resolved from a **tier**, not read from the definition.
"Fable" names the strongest Claude model available, not a version (David,
2026-09-11), so a role declares `model: strongestClaude` and
`.agents/machinery.json`'s `models` block maps that to today's full id. A new
model is one edit there rather than a sweep through every definition, script
and document. The refusal moved with the id and did not soften: the resolved
value must be a full id, because "it ran on the strongest tier" would
otherwise be probably-true and never established. The receipt records the
tier it asked for alongside the id it resolved to.

The run's aggregate `modelUsage` is copied verbatim **for accounting and
authorises nothing.** Measured: every run also carries a Haiku call the harness
makes for its own purposes, so "the requested model appears in the totals" is
satisfied by a run whose answer came from something else entirely. That
inference is the defect this replaces; the side-call is recorded, never excused
by its size or its family.

### P4 — schema-valid output, or no receipt

The role names a JSON Schema, read at the same pinned commit as its definition.
The run's `structured_output` must validate against it. The script re-asks
**once** and then writes nothing: a round that returns no valid document did
not happen, and a receipt describing it would be the fail-open this repository
has shipped three times already (AI-Handbook #11, #16, #59).

**A reviewer process that does not exit cleanly produced no evidence**,
whatever its stdout contains: a non-zero status, a signal, or a spawn error
refuses the run outright rather than retrying, because the buffered output of
a dying process is not "junk to ask again for". A `result` event carrying no
`subtype` at all is refused on the same principle: nothing said the run
succeeded, and an absent fact is not a favourable one.

Exit codes: `0` a receipt was written; `1` a refusal or a reviewer failure; `2`
no provider was reachable **and nothing was dispatched** — once any attempt has
run, a provider that then disappears is a `1`, and the attempts that did run
are printed with the refusal. Argument refusals that
are knowable from the command line happen **before** the launch, so a
deterministic mistake never bills a reviewer.

**The receipt path is derived, not supplied.** It is
`.agents/receipts/fable-<role>-<head>.json`, built by the script.

An earlier version took the path as a flag and then defended it: four review
rounds went into a symlinked component, a path anywhere in the repository, a
tracked file inside the receipts directory, and a hard link aliasing an inode.
Every one of those needed the *operator* to type the bad path, on a command
line the operator wrote — which is not the threat model this machinery has
(`.agents/memory/machinery-threat-model-is-my-own-mistakes.md`, and the
increment's own first settled decision). A symlink or a hard link is not a
mistake; someone has to plant it.

**If naming the file is the script's job, the script names it, and the class
of findings disappears with the input that carried it** (David, 2026-09-10).
That is the general rule, not a fact about this flag: a check whose two sides
you both control is a check against yourself.

**Cost is recorded per attempt, and summed only when every attempt's spend was
observed.** A first attempt that returns nothing valid still spent money; a
receipt carrying only the winning attempt's totals under-reports what the
dispatch cost. But an attempt that produced no result event has an *unknown*
cost, and a sum that skips it is a number presented as a total — so the receipt
carries `costComplete`, and `costUsd` is `null` whenever it is false. Usage
merges only the spend counters; per-model metadata (`contextWindow`,
`maxOutputTokens`, `canonicalModel`, `provider`) is taken once and must agree
across attempts.

### P5 — spawn-time facts are stamped as spawn-time

The receipt records `headAtSpawn`, `treeCleanAtSpawn`, the brief's sha256 and
the role definition's sha256 at its commit — **all observed at spawn**, and
each refusing if the observation itself fails: a `git status` that errors is
not a dirty tree, it is a tree that was not seen. A tree
that changes during a run is not detected. The field names carry the boundary
for that reason, and a clean tree at spawn is **not** a reproducible reviewed
snapshot. Snapshotting is not in Phase 0.

## The refusal, and how a role satisfies it

**A role may dispatch if and only if this script generates its brief.** That is
the rule and the mechanism both: the permitted set is a predicate over the
brief generators in `fable-dispatch.mjs`, there is no `--brief` flag, and
`dispatch()` takes no parameter a caller could widen. Two roles satisfy it —
the probe, and `round-translation`. Everything else is refused, and the way in
is to add a generator, not to widen anything.

That shape replaces Phase 0's list, which stated the same rule while leaving
`permittedRoles` on the exported function — so an importing script could pass
its own and the refusal was advisory (Codex, AI-Handbook #73 round 3).

**Phase 1 met one of Phase 0's two stated conditions and reshaped the other.**
The harness-side observation of instruction loading now exists, bounded: P2
above states exactly what it sees and what it still does not. Authenticated
brief provenance, as Phase 0 imagined it, is **not** what lifts the refusal —
the bar is the predicate, and a brief this script builds needs no provenance
check because there is no other author to distinguish it from.

**Phase 2's `round-translation` is the first role through it**, and it is not
an exception: its brief is composed here from a record
`round-translation-record.mjs` builds out of a captured snapshot. The caller
supplies a pull request number, a round number and a path — data this script
validates — and not one word the reviewer reads. Each role's flags are
scoped to it, so a flag belonging to another role is refused by name rather
than parsed and ignored.

## D0 — the round translation

**What it is for:** David cannot read code, so on a code-review loop the only
account he has ever had of a round is the builder's own. This role writes the
second one, from the round's own material.

**What it reads:** the named round's threads whole — the reviewer's finding
and every reply, verbatim, each labelled by author — the builder's comments on
the pull request since that round, and the diff from the round's reviewed
commit to the pull request's head.

**It holds no tools, and the brief is the whole of its evidence.** It declares
`tools: none` — an explicit empty allowlist, distinct from an omitted field,
which still refuses — and cannot open a file. An earlier version held `Read`,
justified by a one-time check that the checkout sat at the snapshot's head;
that check could not uphold what it claimed, because the tree is live, the
dispatch is detached, and the round after this one proceeds while it runs. A
translator that would have needed a file says so in `could_not_assess`
instead.

**What it cannot do:** anything. Nothing in the review loop, the budget or the
merge gate reads its receipt — `git grep -n fable` over `pr-ready.mjs`,
`guard.sh` and `guard-decision.mjs` returns nothing, and that absence is the
mechanism. It is dispatched **after** the round's re-request is posted, so
there is no moment at which the builder could act on it; if it catches
something, raising it is David's, at the cost of a round.

**What it refuses, and nothing beyond it.** The round is **named**
(`--round`), never "the latest pass" — Codex's next pass can land first, and
then the round just answered silently vanishes; its findings are attributed by
`flattenMcpThreads`, which binds each to exactly one pass. The snapshot must
have been **captured after that round's own pass and after the builder's last
comment on it** — read too early and either the findings are missing (a round
that reads as clean) or the replies are (a round that reads as unanswered).
Both **diff endpoints come from the snapshot** and must resolve in this clone,
so "what the builder pushed" is a real patch rather than an empty marker. And
the snapshot must be **this repository's**, carrying the pull request's author
— without whom every block is labelled `other` and the provenance the
translator weighs is gone.

Each is a wrong account David would read as true, which is the only thing
worth a refusal here; nothing else is checked, because the output is prose for
a human rather than a ledger (David, 2026-09-12). A translation that misses a
finding produces a paragraph missing a finding, which is visible on the page
and costs nothing else.

**What David gets:** one private page per pull request, rebuilt from every
receipt and redeployed in place each round, plus one line of chat per round
derived from the receipt — *agrees*, *differs on N*, *partial*, or *skipped*.
**`agrees` is never printed over something the translator could not assess**:
could-not-observe is not the favourable answer here either. A round that
raised nothing and prompted no push is not dispatched at all; an all-declined
round is, because it is the round where the builder's account matters most.

**Receipts are evidence, not decisions**: `fable-round-translation-<pr>-<n>`,
keyed by round rather than by head because a declined round leaves the head
where it was, and gitignored like every other `fable-*.json`. The two
gut-level counters — dispatches run, disagreements flagged — are restated in
the loop's close-out harvest comment, the same path plan-loop cost takes.

## The probe

`fable-probe` is a test fixture, never counsel. The script generates an
unpredictable challenge, writes it into a brief **it creates itself**, and
compares the returned value **exactly**. A schema-valid answer with the wrong
challenge fails even when the model evidence is perfect.

The probe also reports the tools it believes it holds, and the script compares
that to the launch report: a tool it claims that was not launched, or a real
tool it omits, refuses the run. The harness's own additions (`StructuredOutput`)
are exempt from the omission half — a reviewer has no reason to think of one as
a tool it holds, and refusing it for that would be a false refusal.

Hashing stays in the script. An earlier design asked the reviewer to return the
brief's digest, which a `Read`-only reviewer cannot compute — `plan-review.mjs`
records the same limitation for the adjudicator — and which a schema-valid
invented value would have satisfied.

What a live probe run **establishes**: P1's frame reached the model, P2's
observable surface, P3's attribution, P4's schema, P5's stamps. What it only
**checks**: instruction isolation, by self-report. What it does not touch:
brief provenance, or whether some other role's frontmatter is sound — those are
unit-tested refusals.

## Measured, on this host, at this version

Claude Code **2.1.268**, in the Claude Code Remote container; the launch-surface
and cost rows were taken at 2.1.267 on 2026-09-10 and the isolation rows at
2.1.268 on 2026-09-11. These are per-host and per-version observations, not
platform facts, and the live probe re-records them wherever it runs.

| What | Result |
|---|---|
| Launch surface under the full flag set | `init.tools = [Glob, Grep, Read, StructuredOutput]`, `init.mcp_servers = []`, 19 skills listed, fresh session id honoured |
| Answer attribution | the final `assistant` event's `message.model` was `claude-fable-5-1`; the run's `modelUsage` also listed a Haiku call |
| Round trip | the generated challenge came back exactly; `claudemd` answered `no`; cost $0.085 |
| `--json-schema` | adds a `StructuredOutput` tool, so the allowlist admits it by construction rather than by a role declaring a tool it does not choose |
| Cost as a function of flags | $0.703 on the default system prompt and tool surface (35,142 cache-creation tokens); $0.022 with a replaced system prompt and no tools; $0.085 for the probe |
| `--bare` | **breaks authentication.** It bypasses the host-managed provider and every call fails. Never passed here; the suite asserts its absence |
| Child session id | inherited from the parent unless `--session-id` is passed |
| Stdout purity | without `--setting-sources ""` a "workspace not trusted" warning prefixes stdout ahead of the JSON |
| Prompt size, isolated | the probe observed **3,269** prompt tokens against 3,575 characters composed — so the harness's own framing is ~2,300 tokens, and the allowance is set at 3,500 |
| Prompt size, contaminated | **17,810** tokens for a trivial request with default setting sources: the repository's instructions arriving despite a replaced system prompt. Refused by the bound several times over |
| Debug log | under the dispatch's flags: `Loaded 0 unique skills`, `Hooks: Found 0 total hooks in registry`. With default sources on the same host: 44 skills |

## Why a subprocess and not a subagent

The subagent route is **not impossible**, and this file does not claim it is.
Measured the same day: a `PreToolUse` hook on the `Agent` tool receives
`tool_input {description, prompt, subagent_type, run_in_background}` and can
replace the prompt through `hookSpecificOutput.updatedInput` — a full
replacement, since returning only `{prompt}` fails schema validation, while a
merged object reaches the subagent. So a hook *can* constrain a subagent's
prompt.

It was not chosen because **nothing on that route reports which model produced
the answer**, and that is half of what this increment exists to establish. The
subprocess route was chosen on its merits: the script owns argv by
construction, the harness reports its own launch surface, and the answer
carries its own model stamp.

`SubagentStop`'s `agent_transcript_path` may or may not let a subagent dispatch
recover its served model. It is **unprobed**, irrelevant to the route taken,
and noted here for whoever decides the adjudicator's future.

## What this is not

- **Not a forgery defence.** The threat model is the builder's own mistakes,
  inherited from the receipt machinery (AI-Handbook #38, #45). Every property
  above closes an accidental route. None survives a builder editing this
  script, and none claims to.
- **Not an isolation proof.** P2 bounds the SIZE of the reviewer's prompt
  against what this script put in it, which catches context that arrives from
  anywhere. It does not enumerate what loaded, and a hook that injects nothing
  is outside it.
- **Not a review of anything.** Phase 0 shipped a probe; Phase 2's
  `round-translation` explains a review that already happened, to David, and
  holds no authority over it. Nothing dispatched through this file reviews
  code or decides anything in a loop.
- **Not reachable except through the script — now.** A definition under
  `.claude/agents/` is registered with the harness as an ordinary subagent, so
  any session could dispatch it directly with a caller-written prompt, skipping
  the frame, the launch check, the model binding and the receipt at once. The
  first version of this work put the probe there and merely *described* that
  second door as a Phase 1 prerequisite; Codex (AI-Handbook #73, round 1) said
  correctly that describing it is not closing it, and that the fix was
  available. Role definitions now live in **`.agents/fable-roles/`**, which the
  harness does not scan, and there is no root agent entry for them. One way in
  rather than two. The lesson is the increment's own: a contract that named the
  second door while leaving it open would have been the defect this work
  exists to remove, one level up.
