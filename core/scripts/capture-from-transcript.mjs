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

import { REPO_ROOT, repoSlug } from "./review-budget.mjs";

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

/**
 * A BACKGROUNDED dispatch's paired result is not its answer.
 *
 * The harness launches a background `Agent` and immediately pairs the
 * `tool_use` with a launch notice carrying the agent's id; the judge's answer
 * arrives later, out of band, and is written to that agent's own transcript.
 * So `resultText` on the paired result returns the notice, and recovery
 * refused with "does not parse as a JSON object carrying a `verdict` field" --
 * blaming the judge for the harness's bookkeeping, and telling the operator to
 * re-dispatch, which costs a whole adjudication and would fail the same way.
 *
 * Found by running it, not by review: this PR's own round-2 dispatch was
 * backgrounded because that is the tool's default.
 *
 * The id is the link, and it is in the notice. Matched loosely on purpose --
 * the notice's prose is the harness's to change; the id's shape is not.
 */
const BACKGROUND_AGENT_ID_RE = /\bagentId:\s*([A-Za-z0-9_-]{6,})/;

export function backgroundAgentId(text) {
  const m = BACKGROUND_AGENT_ID_RE.exec(text ?? "");
  return m ? m[1] : null;
}

/**
 * The last thing a backgrounded agent said, from its own transcript.
 *
 * Its final assistant text block is its answer -- the same bytes the paired
 * result would have carried had the dispatch run in the foreground, and
 * notably NOT the copy the harness renders back into this session, which is
 * neutralized where it matched an instruction-shaped pattern.
 *
 * A missing transcript is its own refusal rather than a fallback to the
 * launch notice: the notice never parses, so falling through would only
 * restore the misleading message this exists to replace.
 */
export function agentAnswer(transcriptFile, agentId, { readFile = fs.readFileSync, exists = fs.existsSync } = {}) {
  const dir = transcriptFile.replace(/\.jsonl$/, "");
  const file = path.join(dir, "subagents", `agent-${agentId}.jsonl`);
  if (!exists(file)) {
    throw new Error(
      `the adjudicator ran in the BACKGROUND (agent ${agentId}) and its own transcript is not at ${file}, so ` +
        `its answer cannot be recovered. Re-dispatch it in the foreground -- a verdict is what the loop waits ` +
        `on, so there is nothing to run beside it.`,
    );
  }
  let last = null;
  for (const line of String(readFile(file, "utf8")).split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== "assistant" || !Array.isArray(entry.message?.content)) continue;
    const text = entry.message.content
      .filter((b) => b?.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("");
    if (text.trim()) last = { text, at: entry.timestamp ?? null };
  }
  if (!last) {
    throw new Error(
      `agent ${agentId}'s transcript at ${file} holds no assistant text, so it produced no answer to recover`,
    );
  }
  return last;
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
export function selectCall(calls, { collection, pr, page = 1, repo = null }) {
  const spec = COLLECTIONS[collection];
  if (!spec) throw new Error(`unknown collection ${JSON.stringify(collection)} (have: ${Object.keys(COLLECTIONS).join(", ")})`);
  // THE REPOSITORY IS PART OF THE SELECTOR, not just the pull number. Every
  // repository has a #79, so a session that also queried another repo's #79
  // had its later foreign call win -- and a foreign EMPTY collection carries
  // no urls for the downstream provenance checks to reject, so it assembles
  // as a complete empty collection for this repository and undercounts the
  // loop (Codex, #79 round 1). Derived from the machinery config, never
  // typed: it is the same identity every other artifact is stamped with.
  const [owner, name] = (repo ?? "").split("/");
  const eligible = calls.filter((c) => {
    if (c.name !== spec.tool) return false;
    const input = c.input ?? {};
    if (input.method !== spec.method) return false;
    if (Number(input.pullNumber) !== Number(pr)) return false;
    if (owner && String(input.owner ?? "").toLowerCase() !== owner.toLowerCase()) return false;
    if (name && String(input.repo ?? "").toLowerCase() !== name.toLowerCase()) return false;
    if (!spec.paged) return true;
    if (Number(input.perPage) !== PAGE_MAX) return false;
    return Number(input.page ?? 1) === Number(page);
  });
  if (!eligible.length) {
    throw new Error(
      `no eligible ${collection} call for ${repo ?? "this repository"} PR ${pr}` +
        `${spec.paged ? ` page ${page}` : ""} in this transcript. ` +
        `Eligible means ${spec.tool} with method "${spec.method}", this repository` +
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

/** The classes the adjudicator's contract defines. Anything else is malformed. */
export const CONFORMANCE_CLASSES = [
  "in-scope",
  "out-of-threat-model",
  "out-of-product-intent",
  "test-precision",
  "misdirection",
  "unclassifiable-no-oracle",
];

/**
 * The conformance array against the record the judge was given.
 *
 * THE CONTRACT ALREADY SAID THIS AND THE CODE DID NOT DO IT. The adjudicator's
 * definition tells it that coverage is total and that a missing, extra or
 * duplicated `threadId` is a malformed answer the loop refuses; recovery
 * accepted any object carrying a string `verdict`, so an answer that silently
 * dropped a finding became a committed verdict and, from round 3, a binding
 * classification with a hole in it (Codex, #79 round 1).
 *
 * A claim in a contract that nothing enforces is the defect this entire
 * workstream exists to remove -- attempt 1 (AI-Handbook PR #70) was withdrawn
 * for exactly it, one level up. So this is not a hostile-input defence; it is
 * the contract's own refusal, finally written.
 *
 * A record with no findings is not dispatched for, so an absent `findings`
 * block means this is not a code-loop record and coverage cannot be checked --
 * `conformance` must still be an array, because the contract returns one
 * (empty, on a plan loop) either way.
 */
export function assertConformance(verdict, record) {
  const entries = verdict.conformance;
  if (!Array.isArray(entries)) {
    throw new Error(
      "the adjudicator's answer carries no `conformance` array. Its contract returns one on every dispatch -- " +
        "empty on a plan loop, one entry per finding on a code loop -- so an answer without it is malformed " +
        "and is not written. Re-dispatch rather than editing the answer.",
    );
  }
  for (const [i, entry] of entries.entries()) {
    if (!entry || typeof entry !== "object" || typeof entry.threadId !== "string" || !entry.threadId) {
      throw new Error(`conformance[${i}] carries no \`threadId\``);
    }
    if (!CONFORMANCE_CLASSES.includes(entry.class)) {
      throw new Error(
        `conformance entry for ${entry.threadId} carries class ${JSON.stringify(entry.class)}, which is not one ` +
          `of: ${CONFORMANCE_CLASSES.join(", ")}. An unrecognised class cannot be acted on, and guessing which ` +
          `one was meant is how a binding classification becomes fiction.`,
      );
    }
    // THE EVIDENCE, NOT ONLY THE LABEL. Round 1 of this PR enforced the
    // COVERAGE half of the contract clause -- every finding classified, nothing
    // outside the record -- and left the EVIDENCE half in prose, which is the
    // same defect one field over (Codex, #79 round 2). The contract says each
    // entry carries "a `class`, a `citation` into the record, and a
    // one-sentence `why`", and the citation is what the builder is required to
    // quote when declining a Codex finding on a classification. A bare
    // `{threadId, class: "out-of-threat-model"}` would have been a binding
    // reason to leave a finding unfixed with no evidence in it at all.
    if (typeof entry.why !== "string" || !entry.why.trim()) {
      throw new Error(
        `conformance entry for ${entry.threadId} carries no \`why\`. Every classification states its reason in ` +
          `one sentence; a class with no reasoning behind it cannot be weighed, only obeyed.`,
      );
    }
    // `in-scope` is the DEFAULT READING and needs no citation: there is no
    // oracle line or diff hunk to point at for "this is a real defect in what
    // the increment set out to do". Every other class asserts something about
    // the oracle, the threat model or the code, and must point at it.
    if (entry.class !== "in-scope" && (typeof entry.citation !== "string" || !entry.citation.trim())) {
      throw new Error(
        `conformance entry for ${entry.threadId} is classed \`${entry.class}\` with no \`citation\`. Only ` +
          `\`in-scope\` may cite nothing; every other class is an assertion about the oracle, the threat model ` +
          `or the diff, and the builder may decline a Codex finding on it ONLY by quoting the citation -- so an ` +
          `uncited class is a decline that cannot be made and must not be recorded as though it could.`,
      );
    }
  }

  const expected = Array.isArray(record?.findings?.items)
    ? record.findings.items.map((f) => f.threadId).filter((id) => typeof id === "string")
    : null;
  if (expected === null) return;

  const seen = new Map();
  for (const entry of entries) seen.set(entry.threadId, (seen.get(entry.threadId) ?? 0) + 1);
  const duplicated = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  const missing = expected.filter((id) => !seen.has(id));
  const extra = [...seen.keys()].filter((id) => !expected.includes(id));
  if (missing.length || extra.length || duplicated.length) {
    const parts = [];
    if (missing.length) parts.push(`omits ${missing.length} finding(s) the record carries (${missing.slice(0, 3).join(", ")})`);
    if (extra.length) parts.push(`names ${extra.length} thread(s) the record does not carry (${extra.slice(0, 3).join(", ")})`);
    if (duplicated.length) parts.push(`names ${duplicated.slice(0, 3).join(", ")} more than once`);
    throw new Error(
      `the adjudicator's conformance does not cover the record it ruled on: it ${parts.join("; it ")}. Coverage ` +
        `is total by contract -- every finding in the record, nothing outside it -- so a gap here would leave a ` +
        `finding unclassified while the loop treated the classification as complete. Re-dispatch.`,
    );
  }
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

export function recoverCapture({ root = REPO_ROOT, pr, collection, page = 1, transcript = null, repo = undefined } = {}) {
  const file = findTranscript(root, { explicit: transcript });
  const call = selectCall(readCalls(file), { collection, pr, page, repo: repo === undefined ? repoSlug() : repo });
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
  // A foreground dispatch's answer is its paired result; a backgrounded one's
  // paired result is only the launch notice, and the answer is in that agent's
  // own transcript. Same dispatch either way -- this follows the link rather
  // than asking for a second adjudication of a record already judged.
  const paired = resultText(call.result);
  const backgrounded = backgroundAgentId(paired);
  const answer = backgrounded ? agentAnswer(file, backgrounded) : { text: paired, at: call.result.at };
  const verdict = parseVerdict(answer.text);
  const recordText = fs.readFileSync(recordAbs, "utf8");
  let record;
  try {
    record = JSON.parse(recordText);
  } catch (e) {
    throw new Error(`the record ${recordPath} is not valid JSON (${e.message}), so the verdict cannot be checked against it`);
  }
  assertConformance(verdict, record);

  const out = verdictPathFor(recordPath);
  const document = {
    generator: "scripts/capture-from-transcript.mjs",
    pr: Number(pr),
    recordPath,
    recordSha256: sha256(recordText),
    toolUseId: call.id,
    agentId: backgrounded,
    decidedAt: answer.at ?? call.result.at,
    transcript: path.basename(file),
    note:
      "The adjudicator's own answer, copied from the harness's recorded result rather than retyped. " +
      "Not a provenance claim: the operator runs this script and can edit the transcript. It exists so the " +
      "judge's answer is committed once, verbatim, and counted from one place.",
    verdict,
  };
  return {
    path: write(root, out, `${JSON.stringify(document, null, 2)}\n`),
    decidedAt: answer.at ?? call.result.at,
    toolUseId: call.id,
  };
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
