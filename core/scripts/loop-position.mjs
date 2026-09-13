#!/usr/bin/env node
// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
/**
 * Where a review loop is: ONE file, ONE writer, ONE reader.
 *
 *   node scripts/loop-position.mjs --pr <n>
 *   -> PR #82: round 2 of 3 (internal), head 1322eed, as of 2026-09-13T07:12:20Z (4 min ago)
 *
 * WHY THIS EXISTS (David, 2026-09-13, verbatim: "I want one simple helper
 * function that you can call at any time you need to that tells you exactly
 * where we are in the loop"). The round number had been re-derived at every
 * site that needed it -- a glob over snapshot files, a `<rounds>` placeholder
 * the operator typed, a snapshot file the operator named -- and each site got
 * it wrong in its own way. The counting function itself never changed:
 * `reviewerPasses` has been the count since it was written. What kept
 * changing was the plumbing that fed it evidence. This file ends that by
 * giving the count one durable home.
 *
 * WRITTEN BY THE SNAPSHOT ASSEMBLER, NEVER BY HAND. `snapshot-from-captures`
 * is the one place fresh GitHub evidence enters this machinery -- every
 * snapshot, for every purpose, passes through it -- so it is the one place
 * the position is written. I never type a round number anywhere. The file is
 * a cache of a derivation, stamped with the evidence's own capture time, so
 * "how stale is this" is a field rather than a guess.
 *
 * WHAT IT CANNOT KNOW. A round whose evidence was never captured is invisible
 * to every local file, this one included; only GitHub knows about it. So the
 * position carries `capturedAt`, the reader reports the age, and any step
 * that must be current (close-out is the one) refuses a position older than
 * the same freshness bound the merge gate already applies. Refresh means
 * "assemble a snapshot" -- the ordinary step -- not "edit this file".
 *
 * `.agents/reviews/` is gitignored evidence, like the snapshots beside it.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { reviewerPasses, capturedAtOf, MAX_SNAPSHOT_AGE_MS } from "./review-counting.mjs";
import { countRounds, loadLoop, allowance, nodeIo, REPO_ROOT, repoSlug } from "./review-budget.mjs";

export const positionPath = (root, pr) => path.join(root, ".agents", "reviews", `pr-${pr}`, "loop-position.json");

/**
 * Derive the position from a snapshot. Pure: no I/O, so the tests can feed it
 * fixtures and the assembler can call it before deciding to write.
 *
 * `allowance`/`tier` are best-effort: an internal-tier PR declares its budget
 * at the first re-request, so round 1's snapshot legitimately has none. The
 * round is the core and is always present.
 */
export function derivePosition(snapshot, { loop = null, snapshotPath = null, now = new Date() } = {}) {
  const passes = reviewerPasses(snapshot.reviews ?? [], snapshot.issueComments ?? []);
  const counted = countRounds({ reviewerPasses: passes, issueComments: snapshot.issueComments ?? [] });
  const last = passes[passes.length - 1] ?? null;
  const budgeted = loop && !loop.problem;
  return {
    pr: snapshot.pr.number,
    repo: snapshot.repo ?? null,
    head: snapshot.pr.head.sha,
    round: counted.delivered,
    pendingRequest: counted.pending === 1,
    spent: counted.spent,
    tier: budgeted ? loop.tier : null,
    allowance: budgeted ? allowance(loop.tier, loop.extensions, counted.spent) : null,
    lastPassAt: last?.at ?? null,
    lastPassCommit: last?.commit ?? null,
    capturedAt: capturedAtOf(snapshot),
    snapshot: snapshotPath,
    writtenAt: now.toISOString(),
  };
}

/** The writer. Called by the assembler after it has written the snapshot. */
export function writeLoopPosition(root, snapshot, { snapshotPath = null, io = null } = {}) {
  let loop = null;
  try {
    loop = loadLoop(snapshot.pr.number, io ?? nodeIo());
  } catch {
    loop = null; // no upstream, no budget yet -- the round still gets written
  }
  const pos = derivePosition(snapshot, { loop, snapshotPath });
  const out = positionPath(root, snapshot.pr.number);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(pos, null, 2)}\n`);
  return { path: out, position: pos };
}

/** The reader. Returns null when no snapshot has ever been assembled for the PR. */
export function loopPosition(root, pr, { now = Date.now() } = {}) {
  const file = positionPath(root, pr);
  if (!fs.existsSync(file)) return null;
  const pos = JSON.parse(fs.readFileSync(file, "utf8"));
  const at = Date.parse(pos.capturedAt ?? "");
  const ageMs = Number.isFinite(at) ? now - at : null;
  return { ...pos, ageMs, stale: ageMs === null || ageMs > MAX_SNAPSHOT_AGE_MS };
}

export function describe(pos) {
  if (!pos) return "no snapshot has been assembled for this pull request yet, so there is no position to report";
  const of = pos.allowance === null ? "" : ` of ${pos.allowance === Infinity ? "uncapped" : pos.allowance}`;
  const tier = pos.tier ? ` (${pos.tier})` : " (no budget declared yet)";
  const pending = pos.pendingRequest ? ", a request is in flight" : "";
  const age = pos.ageMs === null ? "unknown age" : `${Math.round(pos.ageMs / 60000)} min ago`;
  const stale = pos.stale ? " -- STALE, assemble a fresh snapshot before relying on it" : "";
  return `PR #${pos.pr}: round ${pos.round}${of}${tier}${pending}, head ${String(pos.head).slice(0, 7)}, as of ${pos.capturedAt} (${age})${stale}`;
}

export function main(argv = process.argv.slice(2), { root = REPO_ROOT, log = process.stderr, out = process.stdout, slug = null } = {}) {
  const i = argv.indexOf("--pr");
  const pr = i >= 0 ? Number(argv[i + 1]) : NaN;
  if (!Number.isInteger(pr) || pr <= 0 || argv.length !== 2) {
    log.write("usage: node scripts/loop-position.mjs --pr <n>\n");
    return 2;
  }
  const pos = loopPosition(root, pr);
  const ours = slug ?? repoSlug();
  if (pos && pos.repo && pos.repo.toLowerCase() !== String(ours).toLowerCase()) {
    log.write(`loop-position: ${positionPath(root, pr)} was written for ${pos.repo}, not ${ours}\n`);
    return 2;
  }
  out.write(`${describe(pos)}\n`);
  return pos ? (pos.stale ? 1 : 0) : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
