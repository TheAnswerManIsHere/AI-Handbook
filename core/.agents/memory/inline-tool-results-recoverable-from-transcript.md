---
name: An inline tool result can be recovered byte-exact from the session transcript
description: A tool response small enough to come back inline is normally re-typed into a capture file, which is where evidence gets corrupted. The same bytes are already on disk in ~/.claude/projects/<session>.jsonl as tool_result blocks — read them instead of retyping.
---

<!-- SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead. -->

## Rule

Never retype a tool response into a capture file from what is on screen. The
harness has already written the bytes to
`~/.claude/projects/<session>.jsonl`, where each tool response is a
`tool_result` block. Read them from there.

## The mechanic

The harness spills an **oversized** tool result to disk and hands back a path;
a **smaller** one comes back inline in the conversation. The capture machinery
classifies these differently and by path, never by declaration —
`harness-capture` for the spilled file (no agent in the path) versus
`agent-written` for anything transcribed.

Measured threshold: between ~50 KB (inline) and 69,207 characters (spilled).

The asymmetry that follows is the whole problem: **evidence the harness writes
costs nothing to refresh, and evidence it hands back inline costs a
transcription.** So any rule demanding a large capture per round is free, and
one demanding a small capture is a tax — and the discipline that is expensive
is the one that gets skipped, which is how evidence got fabricated in the
first place (AI-Handbook #38, round 4: a snapshot carrying invented ids).

The transcript closes that gap for the inline case. The bytes exist; the
retyping step is optional.

## What this does NOT do

It does not make the capture `harness-capture`. The file is still written by
the machinery's own classification as `agent-written`, and the adjudicator's
contract still weighs a wholly agent-written record as slightly weaker
evidence. This removes the **corruption** risk, not the provenance caveat.

Hand-typed values do drift in practice, not just in theory: transcribed
issue-comment `created_at` values have come back up to two minutes off
GitHub's actual timestamps.

## Related

- AI-Handbook #75 — the mechanical record's evidence path still has an
  unguarded hand step. This is a mitigation candidate for it, not its closure.
