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
 * The collections the position is actually derived FROM, which is not all four.
 *
 * `capturedAtOf` defaults to `COUNTED_COLLECTIONS`, all four, and returns null
 * when any is missing. But `snapshot-from-captures` explicitly supports a
 * round-check-only snapshot with no `reviewThreads` -- it is the shape the
 * budget guard asks for -- so the default made the ordinary lightweight
 * capture write a position with `capturedAt: null`, which `loopPosition` then
 * marks stale the instant it lands. Both readers refuse it and the operator is
 * sent to assemble a full threads capture they never needed.
 *
 * Requiring only what the position reads is the whole fix: the round comes
 * from `reviews` and `issueComments`, and the identity from `pr`. Threads are
 * not consulted here, so their absence cannot date this file. (Codex, #82
 * round 3.)
 */
export const POSITION_COLLECTIONS = ["pr", "reviews", "issueComments"];

/**
 * Derive the position from a snapshot. Pure: no I/O, so the tests can feed it
 * fixtures and the assembler can call it before deciding to write.
 *
 * `allowance`/`tier` are best-effort: an internal-tier PR declares its budget
 * at the first re-request, so round 1's snapshot legitimately has none. The
 * round is the core and is always present.
 */
export function derivePosition(snapshot, { loop = null, snapshotPath = null, previous = null, now = new Date() } = {}) {
  const passes = reviewerPasses(snapshot.reviews ?? [], snapshot.issueComments ?? []);
  const counted = countRounds({ reviewerPasses: passes, issueComments: snapshot.issueComments ?? [] });
  const last = passes[passes.length - 1] ?? null;
  const budgeted = loop && !loop.problem;

  // THE ROUND NEVER GOES BACKWARDS, AND THAT IS NOT PEDANTRY -- it is the last
  // hole in gap 16, reached from the opposite side to the one that opened it.
  //
  // `reviewerPasses` is lossy in one shape: where the connector emits no
  // `Reviewed commit` marker and instead REWRITES its single summary comment
  // in place, two clean automatic passes collapse to one. Measured: two passes
  // in, one out. A count that can fall makes close-out's bound fall with it,
  // so a round that was already observed -- and already has a snapshot and an
  // exit file sitting on disk beside this file -- stops being checked, and
  // close-out reports success with that round's translation unaccounted for.
  // Exactly the silent omission this whole feature exists to prevent, arriving
  // by a third route. (Codex, #82 round 3.)
  //
  // A pass cannot be un-made, so flooring at the highest round ever observed is
  // sound rather than merely safe. Only the round is floored: `head`,
  // `capturedAt` and the rest come from the fresh evidence, because those CAN
  // legitimately move and a floored one would be a lie about the capture.
  //
  // AND IT IS VISIBLE, NEVER SILENT. `observedRound` keeps what this snapshot
  // actually derived, so a floor is a disagreement anyone can see and
  // `describe` prints. Papering over the lossiness without saying so would be
  // the same class of defect as the one being fixed.
  const observedRound = counted.delivered;
  const floor = previous && previous.pr === snapshot.pr.number && sameRepo(previous.repo, snapshot.repo)
    ? Number(previous.round)
    : NaN;
  const round = Number.isInteger(floor) && floor > observedRound ? floor : observedRound;

  return {
    pr: snapshot.pr.number,
    repo: snapshot.repo ?? null,
    head: snapshot.pr.head.sha,
    round,
    observedRound,
    pendingRequest: counted.pending === 1,
    spent: counted.spent + (round - observedRound),
    tier: budgeted ? loop.tier : null,
    allowance: budgeted ? allowance(loop.tier, loop.extensions, counted.spent + (round - observedRound)) : null,
    lastPassAt: last?.at ?? null,
    lastPassCommit: last?.commit ?? null,
    capturedAt: capturedAtOf(snapshot, null, { require: POSITION_COLLECTIONS }),
    snapshot: snapshotPath,
    writtenAt: now.toISOString(),
  };
}

/** Two repository names, compared the way every other identity check here does. */
const sameRepo = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

/** The writer. Called by the assembler after it has written the snapshot. */
export function writeLoopPosition(root, snapshot, { snapshotPath = null, io = null } = {}) {
  let loop = null;
  try {
    loop = loadLoop(snapshot.pr.number, io ?? nodeIo());
  } catch {
    loop = null; // no upstream, no budget yet -- the round still gets written
  }
  // READ BEFORE OVERWRITE, so the round can be floored at the highest ever
  // observed (see derivePosition). An unreadable or absent previous position
  // is simply no floor -- never a throw, because this runs inside the snapshot
  // assembler and a corrupt evidence file must not fail an assembly that
  // otherwise succeeded.
  let previous = null;
  try {
    previous = loopPosition(root, snapshot.pr.number);
  } catch {
    previous = null;
  }
  const pos = derivePosition(snapshot, { loop, snapshotPath, previous });
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
  // A FLOORED ROUND IS SAID OUT LOUD. When the latest evidence derives a lower
  // round than one already observed, the higher one is kept -- and the reader
  // is told, because a disagreement between the stored round and what GitHub
  // currently reports is exactly the thing nobody should discover later.
  const held =
    Number.isInteger(pos.observedRound) && pos.observedRound < pos.round
      ? ` (held at ${pos.round}; the latest evidence derives only ${pos.observedRound} -- a pass the reviewer overwrote in place)`
      : "";
  return `PR #${pos.pr}: round ${pos.round}${of}${tier}${pending}, head ${String(pos.head).slice(0, 7)}, as of ${pos.capturedAt} (${age})${held}${stale}`;
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
