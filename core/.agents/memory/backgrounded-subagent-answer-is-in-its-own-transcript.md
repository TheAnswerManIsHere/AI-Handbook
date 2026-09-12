---
name: A backgrounded subagent's answer is in its own transcript, not in the paired tool result
description: The harness pairs a backgrounded Agent tool_use with a launch notice, not the agent's answer. The answer is the last assistant text block in <session-transcript-without-.jsonl>/subagents/agent-<agentId>.jsonl, and those are the ORIGINAL bytes — the copy rendered back into the session is neutralized where it matched an instruction-shaped pattern. Measured 2026-09-11: this harness backgrounds every Agent dispatch even when run_in_background is false, so "dispatch in the foreground" is not an available remedy.
---

<!-- SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead. -->

## Rule

To recover a subagent's answer from the transcript, **do not read the
`tool_result` paired with its `tool_use`.** For a backgrounded dispatch that
block is the harness's launch notice:

```
Async agent launched successfully. ...
agentId: <id>
```

The answer is the **last assistant `text` block** in that agent's own
transcript:

```
<session-transcript-path minus .jsonl>/subagents/agent-<agentId>.jsonl
```

So for a session at
`/root/.claude/projects/-home-user-AI-Handbook/<session-id>.jsonl`, the agent's
transcript is
`/root/.claude/projects/-home-user-AI-Handbook/<session-id>/subagents/agent-<agentId>.jsonl`
(a sibling `agent-<agentId>.meta.json` sits beside it). The `agentId` is in the
launch notice, which is the link between the two.

Read the file to its end and keep the last assistant entry carrying non-empty
`text`: a `thinking` block and interim chatter ("one moment") appear as earlier
assistant entries, and the answer is the final one.

## Why the foreground is not the remedy

The obvious alternative is a contract line — *dispatch adjudicators in the
foreground, where the paired result really is the answer.* **It is not
enforceable here.** Measured 2026-09-11, in this container: an `Agent` call
made with `run_in_background: false` still returned "Async agent launched
successfully" with an `agentId`, and its answer still arrived out of band.

That is one measurement of the false case, not an exhaustive survey — but it is
enough to reject a rule whose whole value depends on the flag being honoured.
Follow the id; do not write the rule.

## The subagent transcript holds the ORIGINAL bytes

This is the part worth the note on its own. The copy of a subagent's answer
that the harness renders **back into the session** can be neutralized: where
the output matches an instruction-shaped pattern, control characters are
escaped and a preamble is prepended saying so.

Measured on the same dispatch, one string, two places:

| Where | Bytes |
|---|---|
| Rendered back into the session | `&lt;record&gt;.verdict.json` |
| `subagents/agent-<agentId>.jsonl` | `<record>.verdict.json` |

For anything asserting byte-exactness — a committed verdict, a quoted
citation, a digest — the session-rendered copy is the wrong source and the
agent's own transcript is the right one. Recovering from the transcript is not
merely cheaper than retyping here; it is the only route to the actual bytes.

## The failure mode it replaces

Before this was understood, recovery read the launch notice, failed to parse
it, and reported:

```
the adjudicator's recorded answer does not parse as a JSON object carrying a
`verdict` field. Its contract says to return JSON and nothing else;
re-dispatch rather than editing the answer.
```

Every clause of that is wrong about the cause. The judge returned perfect JSON;
the harness's bookkeeping was in the block being read. And the remedy it
advises — re-dispatch — costs a full adjudication and **fails identically**,
because the second dispatch is backgrounded too.

A refusal that misdiagnoses is worse than a loud one: it spends the expensive
thing while pointing away from the fix. `capture-from-transcript.mjs` now
follows the id, and when that agent's transcript is genuinely missing it says
so by name rather than blaming the agent.

## Related

- [`inline-tool-results-recoverable-from-transcript.md`](inline-tool-results-recoverable-from-transcript.md)
  — the same idea one level up: a tool response is on disk, so it never needs
  retyping. That note covers `tool_result` blocks in the session transcript;
  this one covers the case where the block you want is not there at all.
- `core/scripts/capture-from-transcript.mjs` (`backgroundAgentId`,
  `agentAnswer`) implements this, discovered by running it rather than by
  review — AI-Handbook #79.
