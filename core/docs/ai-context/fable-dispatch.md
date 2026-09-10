<!-- SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead. -->

# Dispatching Fable: what is enforced, and what is not

The mechanism under AI-Handbook workstream #36's reviewer roles. Phase 0 ships
this and **no advisory role**: the point is that the floor exists and is what
it says before anything stands on it.

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

## The five properties

### P1 — the instruction frame is script-owned; brief content is not authenticated

`core/scripts/fable-dispatch.mjs` composes every instruction a role receives:
the system prompt is the role definition's body, read with `git show` at a
pinned commit; the user message is a fixed frame written in that script, with
the brief quoted inside it. The caller passes a role id and a path. Free text
on the command line, and any unknown flag, are refused before anything spawns.

This holds **by construction rather than by refusal**: the script builds the
subprocess argv, so there is no channel through which caller-written text could
reach the reviewer. It is the same guarantee `plan-review.mjs` has for the
Codex plan reviewer, on the same kind of transport.

**What it does not do.** It does not establish who wrote the brief. A file the
builder typed passes through unchanged; the receipt records the brief's sha256
and never its origin. Authenticated brief provenance is Phase 1's boundary, and
until it exists **every role except the script-fed probe is refused,
unconditionally** — see *The refusal*, below.

### P2 — the observable surface is pinned and harness-reported; instruction loading is checked, not closed

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
and **refuses the run if the reported `tools` or `mcp_servers` exceed what the
role allows**, then copies `tools`, `mcp_servers`, `agents`, `skills`,
`plugins`, `permissionMode`, `apiKeySource` and `claude_code_version` into the
receipt. A reviewer that wanted to misreport its own surface has no opportunity
to: this is not the reviewer describing itself.

`init` lists **skills** even under this configuration (nineteen on the host
measured below). They are inert without the `Skill` tool, which is permanently
forbidden, so they are recorded rather than refused on — recording what was
present beats inventing a violation.

**What it does not observe: which instruction content loaded.** `init` does not
enumerate `CLAUDE.md`, managed settings, managed hooks or memory files, and
replacing the system prompt does not by itself exclude separately delivered
context. The probe's schema carries a `claudemd` field the reviewer answers
from its own context, and **that is a self-report, recorded as one**. The
receipt says so in a field next to it. A managed hook could supply context
without widening the reported tool list, and nothing here would see it.

So: `--setting-sources ""` excludes **user, project and local** settings. It
says nothing about **managed** settings and hooks. "Not loaded" is never to be
read as "none exist".

**Closing this with a harness-side observation is a named Phase 1
prerequisite**, and the refusal below does not lift until it is met.

### P3 — the answer's model is bound, not the run's

The receipt carries `modelRequested` (the role's frontmatter, a full model id —
an alias is refused, because "it ran on 5.1" would otherwise be probably-true
and never established) and `answerModel`, taken from the `message.model` stamp
on the assistant event that produced the validated output. **They must be equal
or the run is refused.**

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

Exit codes: `0` a receipt was written; `1` a refusal or a reviewer failure; `2`
no provider was reachable and nothing was dispatched.

### P5 — spawn-time facts are stamped as spawn-time

The receipt records `headAtSpawn`, `treeCleanAtSpawn`, the brief's sha256 and
the role definition's sha256 at its commit — **all observed at spawn**. A tree
that changes during a run is not detected. The field names carry the boundary
for that reason, and a clean tree at spawn is **not** a reproducible reviewed
snapshot. Snapshotting is not in Phase 0.

## The refusal, and the two things that lift it

Phase 0 dispatches **only the probe**. Every other role is refused with an
error naming why. This is not configuration and not a soft default: P1 does not
authenticate brief content and P2 does not observe instruction loading, so any
role reading a caller-supplied brief would be counsel resting on inputs this
increment cannot vouch for.

Phase 1 may lift it **only after both**:

1. **Authenticated brief provenance** — briefs derived from git over a pinned
   range and provenance-checked snapshots, not from a path a caller names.
2. **A harness-side observation of instruction isolation** — something better
   than the reviewer's own `claudemd` answer.

One of the two is not enough. The refusal is the single control keeping
un-authenticated, un-isolated Fable advice out of the fleet, and it is liftable
only on its whole stated evidence.

## The probe

`fable-probe` is a test fixture, never counsel. The script generates an
unpredictable challenge, writes it into a brief **it creates itself**, and
compares the returned value **exactly**. A schema-valid answer with the wrong
challenge fails even when the model evidence is perfect.

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

Claude Code **2.1.267**, in the Claude Code Remote container, 2026-09-10. These
are per-host and per-version observations, not platform facts, and the live
probe re-records them wherever it runs.

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
- **Not an isolation proof.** See P2.
- **Not a review of anything.** Phase 0 ships a probe.
- **Not the only way to reach a role definition.** A definition under
  `.claude/agents/` is also registered with the harness as an ordinary
  subagent, so any session can dispatch it directly — with no brief, no
  receipt, no launch report and no model binding. Nothing here prevents that;
  the properties above describe what `fable-dispatch.mjs` establishes when it
  is the caller, and say nothing about a direct dispatch.

  For the probe this costs nothing: it echoes a challenge it will not have
  been given, and its own definition tells it to report that rather than
  invent one. **For an advisory role it would be a hole**, and closing it —
  by moving role definitions off the harness's agent path, or by making a
  role refuse a dispatch that carries no receipt — is a **Phase 1
  prerequisite alongside the two named above**. Recorded on the day it was
  found, because a contract that claimed sole-caller status while the harness
  offered a second door would be this increment's own defect, one level up.
