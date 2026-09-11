#!/usr/bin/env node
// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
/**
 * Recover a tool result from the harness's own session transcript, byte-exact.
 *
 * WHY THIS EXISTS, AND WHAT IT IS NOT. `snapshot-from-captures.mjs` turns raw
 * API responses on disk into a snapshot. Getting those responses onto disk was
 * the problem: the harness writes an oversized result to `tool-results/` by
 * itself, but a smaller one comes back INLINE, and inline meant an agent
 * retyping it. On AI-Handbook #73 that came to ~40KB of JSON per record, and
 * mid-transcription the session caught itself reconstructing a PR body from an
 * older draft rather than copying what GitHub returned (AI-Handbook #75).
 *
 * The transcript already holds those bytes. Every tool result the harness
 * received is in it, paired to its call. So this script copies them out
 * instead.
 *
 * **The value is cost, not security** (David, 2026-09-11). This is not a
 * provenance mechanism and must not be described as one: the threat model is
 * the operator's own mistakes, the operator can edit the transcript, and
 * nothing here would notice. What it removes is a 40KB hand step -- the step
 * that is expensive, gets rushed, and where generation creeps in. A capture
 * recovered here is recorded as `transcript-recovered` so the record says
 * which kind it is; the record has always said that, and that is the whole of
 * the honesty owed.
 *
 * USAGE
 *   # one collection's page, for snapshot-from-captures.mjs
 *   node <this file> --pr 80 --collection reviews
 *   node <this file> --pr 80 --collection reviewThreads --page 2
 *
 *   # the adjudicator's own answer, beside the record it ruled on
 *   node <this file> --pr 80 --verdict --record .agents/adjudications/80-1.json
 *
 * EXIT CODES
 *   0  a file was written        1  a refusal (nothing was written)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

import { REPO_ROOT } from "./review-budget.mjs";

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

/**
 * The four collections a snapshot is built from, and the call that fetches
 * each.
 *
 * `perPage` is the ELIGIBILITY RULE, not decoration. `snapshot-from-captures`
 * proves a REST collection reached its end by the last page being shorter than
 * GitHub's maximum -- so a capture fetched with `perPage: 10` is "complete" at
 * ten entries, and a byte-exact recovery of it would certify a review history
 * that is missing rounds. A call that asked for a short page is therefore
 * never eligible, however recent. (Codex, plan round 1.)
 */
export const COLLECTIONS = {
  pr: { tool: "mcp__github__pull_request_read", method: "get", paged: false },
  reviews: { tool: "mcp__github__pull_request_read", method: "get_reviews", paged: true },
  issueComments: { tool: "mcp__github__pull_request_read", method: "get_comments", paged: true },
  reviewThreads: { tool: "mcp__github__pull_request_read", method: "get_review_comments", paged: true },
};

/** GitHub's page maximum, and so the only page size a full page can have. */
const PAGE_MAX = 100;

/**
 * Where a recovered capture goes. Derived, never supplied.
 *
 * `captureSource` reads a capture's class off its PATH, because a declared
 * class says whatever its caller wanted it to say. So the class
 * `transcript-recovered` only means anything if this directory is written by
 * this script and nothing else -- which is exactly why AI-Handbook #73 deleted
 * `fable-dispatch`'s `--out` flag rather than validating it: if naming the
 * file is the script's job, the script names it, and the whole class of
 * "wrote it somewhere the class is wrong" stops existing (David, 2026-09-10).
 */
export const CAPTURES_DIR = ".agents/captures";

export const capturePath = (pr, collection, page) =>
  `${CAPTURES_DIR}/pr-${pr}-${collection}${page > 1 ? `-p${page}` : ""}.json`;

/** The subagent whose answer a verdict file carries. */
export const ADJUDICATOR = "review-loop-adjudicator";

// ---------------------------------------------------------------------------
// Finding the transcript
// ---------------------------------------------------------------------------

/** `/home/user/AI-Handbook` -> `-home-user-AI-Handbook`, the harness's own rule. */
export const projectSlug = (root) => path.resolve(root).replace(/[/.]/g, "-");

/**
 * This session's transcript: the most recently written `.jsonl` in the
 * harness's project directory for this repository.
 *
 * Newest-wins rather than a session id from the environment, because the
 * harness exports no session id a child process can read, and the session
 * being written to IS the live one. The directory is derived from the
 * repository root, so a transcript from another project cannot be selected;
 * an older session of THIS project could be, and the consequence is a
 * refusal ("no eligible call") rather than wrong evidence, because every
 * selection below is pinned to the pull request asked for.
 */
export function findTranscript(root, { home = os.homedir(), explicit = null } = {}) {
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`--transcript ${explicit} does not exist`);
    return explicit;
  }
  const dir = path.join(home, ".claude", "projects", projectSlug(root));
  if (!fs.existsSync(dir)) {
    throw new Error(
      `no harness transcript directory at ${dir}, so no tool result can be recovered. This is the ` +
        `"no transcript" case, not the "no matching call" case: the snapshot must be assembled the ` +
        `agent-written way, and the record will say so.`,
    );
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ file: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) throw new Error(`${dir} holds no .jsonl transcript`);
  return files[0].file;
}

// ---------------------------------------------------------------------------
// Reading it
// ---------------------------------------------------------------------------

/**
 * Every tool call in the transcript, paired with the result it received.
 *
 * A line this cannot parse is skipped, like any transcript reader: the file is
 * append-only and its last line can be partial. A call with no result is kept
 * with `result: null` -- it was dispatched and never answered, which a caller
 * should see rather than have silently filtered away.
 */
export function readCalls(transcriptPath) {
  const lines = fs.readFileSync(transcriptPath, "utf8").split("\n");
  const calls = [];
  const results = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const content = event?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === "tool_use") {
        calls.push({ id: block.id, name: block.name, input: block.input ?? {}, at: event.timestamp ?? null });
      } else if (block?.type === "tool_result") {
        results.set(block.tool_use_id, { content: block.content, at: event.timestamp ?? null });
      }
    }
  }
  return calls.map((c) => ({ ...c, result: results.get(c.id) ?? null }));
}

/**
 * A tool result's text, as the harness recorded it.
 *
 * The content is either a string or an array of text blocks; both shapes are
 * the same bytes to whoever reads them, so both are joined into one string.
 */
export function resultText(result) {
  const content = result?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b?.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("");
  }
  return null;
}

/**
 * The harness's notice that it spilled an oversized result to a file.
 *
 * That file is the ORIGINAL and is already the strongest capture class there
 * is, so the recovery resolves to it rather than copying a preview of it.
 */
const SPILL_RE = /^<persisted-output>\s*\n[\s\S]*?Full output saved to:\s*(\S+)/;

export function spilledPath(text) {
  const m = SPILL_RE.exec(text ?? "");
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * The latest ELIGIBLE call for one collection and page.
 *
 * Eligible means: this tool, this method, this pull request, this page, and --
 * for a paged collection -- a full-page request. Latest among those, because a
 * loop refetches as it goes and the freshest read is the one the round is
 * about. A later call that asked for a short page does not displace an earlier
 * full-page one; it was never a candidate.
 */
export function selectCall(calls, { collection, pr, page = 1 }) {
  const spec = COLLECTIONS[collection];
  if (!spec) throw new Error(`unknown collection ${JSON.stringify(collection)} (have: ${Object.keys(COLLECTIONS).join(", ")})`);
  const eligible = calls.filter((c) => {
    if (c.name !== spec.tool) return false;
    const input = c.input ?? {};
    if (input.method !== spec.method) return false;
    if (Number(input.pullNumber) !== Number(pr)) return false;
    if (!spec.paged) return true;
    if (Number(input.perPage) !== PAGE_MAX) return false;
    return Number(input.page ?? 1) === Number(page);
  });
  if (!eligible.length) {
    throw new Error(
      `no eligible ${collection} call for PR ${pr}${spec.paged ? ` page ${page}` : ""} in this transcript. ` +
        `Eligible means ${spec.tool} with method "${spec.method}"` +
        (spec.paged ? `, perPage ${PAGE_MAX} and page ${page}` : "") +
        `. A call that asked for a shorter page is deliberately not eligible: the snapshot assembler proves a ` +
        `collection ended by its last page being short, so a short page would attest a completeness it does ` +
        `not have. Fetch it with perPage ${PAGE_MAX} and run this again.`,
    );
  }
  const chosen = eligible[eligible.length - 1];
  if (!chosen.result) throw new Error(`the latest eligible ${collection} call (${chosen.id}) has no recorded result`);
  return chosen;
}

/** The latest adjudicator dispatch whose prompt names this record. */
export function selectVerdictCall(calls, recordPath) {
  const eligible = calls.filter(
    (c) => c.name === "Agent" && c.input?.subagent_type === ADJUDICATOR && String(c.input?.prompt ?? "").includes(recordPath),
  );
  if (!eligible.length) {
    throw new Error(
      `no ${ADJUDICATOR} dispatch naming ${recordPath} in this transcript. The verdict file is recovered from ` +
        `the dispatch's own recorded result, so the dispatch has to have happened in this session.`,
    );
  }
  const chosen = eligible[eligible.length - 1];
  if (!chosen.result) throw new Error(`the adjudicator dispatch ${chosen.id} has no recorded result yet`);
  return chosen;
}

/**
 * The judge's JSON, out of its answer.
 *
 * Its contract says "return JSON and nothing else", and it usually does --
 * inside a fence, which is the one deviation worth accommodating rather than
 * refusing. Anything else refuses: a verdict file that is not the verdict is
 * worse than no verdict file.
 */
export function parseVerdict(text) {
  const candidates = [];
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(text ?? "");
  if (fenced) candidates.push(fenced[1]);
  candidates.push(text ?? "");
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === "object" && typeof parsed.verdict === "string") return parsed;
    } catch {
      /* try the next shape */
    }
  }
  throw new Error(
    "the adjudicator's recorded answer does not parse as a JSON object carrying a `verdict` field. Its " +
      "contract says to return JSON and nothing else; re-dispatch rather than editing the answer.",
  );
}

/** `.agents/adjudications/80-1.json` -> `.agents/adjudications/80-1.verdict.json`. */
export const verdictPathFor = (recordPath) => recordPath.replace(/\.json$/, ".verdict.json");

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function write(root, rel, text) {
  const abs = path.resolve(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return path.relative(root, abs);
}

export function recoverCapture({ root = REPO_ROOT, pr, collection, page = 1, transcript = null } = {}) {
  const file = findTranscript(root, { explicit: transcript });
  const call = selectCall(readCalls(file), { collection, pr, page });
  const text = resultText(call.result);
  if (text === null) throw new Error(`the ${collection} result for ${call.id} carries no readable text`);

  const spill = spilledPath(text);
  if (spill) {
    if (!fs.existsSync(spill)) throw new Error(`the harness spilled this result to ${spill}, which is no longer there`);
    return { path: spill, source: "harness-capture", capturedAt: call.result.at, toolUseId: call.id, spilled: true };
  }
  const written = write(root, capturePath(pr, collection, page), text);
  return { path: written, source: "transcript-recovered", capturedAt: call.result.at, toolUseId: call.id, spilled: false, sha256: sha256(text) };
}

export function recoverVerdict({ root = REPO_ROOT, pr, recordPath, transcript = null } = {}) {
  const recordAbs = path.resolve(root, recordPath);
  if (!fs.existsSync(recordAbs)) throw new Error(`the record ${recordPath} does not exist -- a verdict file sits beside its record`);
  const file = findTranscript(root, { explicit: transcript });
  const call = selectVerdictCall(readCalls(file), recordPath);
  const verdict = parseVerdict(resultText(call.result));

  const out = verdictPathFor(recordPath);
  const document = {
    generator: "scripts/capture-from-transcript.mjs",
    pr: Number(pr),
    recordPath,
    recordSha256: sha256(fs.readFileSync(recordAbs, "utf8")),
    toolUseId: call.id,
    decidedAt: call.result.at,
    transcript: path.basename(file),
    note:
      "The adjudicator's own answer, copied from the harness's recorded result rather than retyped. " +
      "Not a provenance claim: the operator runs this script and can edit the transcript. It exists so the " +
      "judge's answer is committed once, verbatim, and counted from one place.",
    verdict,
  };
  return { path: write(root, out, `${JSON.stringify(document, null, 2)}\n`), decidedAt: call.result.at, toolUseId: call.id };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const KNOWN = new Set(["--pr", "--collection", "--page", "--record", "--transcript", "--verdict"]);

export function parseArgs(argv) {
  const out = { pr: null, collection: null, page: 1, record: null, transcript: null, verdict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!KNOWN.has(flag)) throw new Error(`unknown argument ${JSON.stringify(flag)}`);
    if (flag === "--verdict") {
      out.verdict = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
    i += 1;
    if (flag === "--pr") out.pr = Number(value);
    else if (flag === "--page") out.page = Number(value);
    else out[flag.slice(2)] = value;
  }
  if (!Number.isInteger(out.pr) || out.pr <= 0) throw new Error("--pr is required and must be a positive integer");
  if (out.verdict) {
    if (!out.record) throw new Error("--verdict needs --record <the adjudication record it ruled on>");
  } else {
    if (!out.collection) throw new Error("--collection is required (or --verdict)");
    if (!Number.isInteger(out.page) || out.page <= 0) throw new Error("--page must be a positive integer");
  }
  return out;
}

export function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`capture-from-transcript: ${e.message}\n`);
    return 1;
  }
  try {
    if (args.verdict) {
      const { path: written, decidedAt } = recoverVerdict({ pr: args.pr, recordPath: args.record, transcript: args.transcript });
      process.stderr.write(`capture-from-transcript: verdict -> ${written} (decided ${decidedAt})\n`);
    } else {
      const r = recoverCapture({ pr: args.pr, collection: args.collection, page: args.page, transcript: args.transcript });
      process.stderr.write(
        `capture-from-transcript: ${args.collection} -> ${r.path} (${r.source}${r.spilled ? ", already on disk" : ""}, captured ${r.capturedAt})\n`,
      );
    }
  } catch (e) {
    process.stderr.write(`capture-from-transcript: ${e.message}\n`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
