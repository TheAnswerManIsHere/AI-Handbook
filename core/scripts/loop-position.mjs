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

import { reviewerPasses, capturedAtOf, sameCommit, MAX_SNAPSHOT_AGE_MS } from "./review-counting.mjs";
import { countRounds, loadLoop, allowance, nodeIo, REPO_ROOT, repoSlug } from "./review-budget.mjs";
import { receiptsFor } from "./round-translation-page.mjs";

/**
 * Where a PR's round artifacts live -- the position, the per-round snapshots,
 * and the translation exit files beside them.
 *
 * ONE CONSTRUCTION OF THIS PATH, deliberately. It was built here and again in
 * `round-translation-closeout.mjs`, and the merge gate now needs it for a
 * third reader. Two copies agreeing is luck; three is the shape this repo
 * exists to eliminate, so the locator moved to the file that already owns
 * "where is this loop, on disk" and the other callers import it.
 */
export const reviewsDir = (root, pr) => path.join(root, ".agents", "reviews", `pr-${pr}`);

export const positionPath = (root, pr) => path.join(reviewsDir(root, pr), "loop-position.json");

/**
 * Where the delivery record lives, and how to read it. Written by
 * `record-delivery.mjs` as the last line of the delivery step; read here so
 * the two consumers of "was this round delivered" share one reader.
 */
export const deliveryPath = (root, pr) => path.join(reviewsDir(root, pr), "delivered.json");

export function delivery(root, pr, { exists = fs.existsSync, read = (f) => fs.readFileSync(f, "utf8") } = {}) {
  const file = deliveryPath(root, pr);
  if (!exists(file)) return null;
  const d = JSON.parse(read(file));
  return Array.isArray(d.rounds) ? d : null;
}

/**
 * Classify one round's translation from what is on disk. Three states, not two.
 *
 * "Done" and "missing" would collapse the case that matters: a round that was
 * dispatched and has not returned yet is not a round with no account, and
 * treating it as one would refuse on a translation that is simply still
 * running. The two readers act on that difference in opposite ways -- the
 * close-out WAITS on `pending`, the merge gate REFUSES it -- which is exactly
 * why the classification lives in one place and the policy does not.
 *
 * TWO ARTIFACTS, IN THIS ORDER, AND NEITHER ALONE IS RIGHT (Codex, #87 round
 * 1, which asked for something else and was right about the premise):
 *
 *   - The RECEIPT is written by `fable-dispatch.mjs` itself, on a real outcome
 *     -- a translation or a by-design skip. Machinery-written, so it is the
 *     strong evidence and it is checked first.
 *   - The EXIT FILE is written by the recipe's shell (`echo $? > …`), which
 *     runs REGARDLESS of the dispatch's exit code. So it cannot mean "this
 *     round has an account" on its own: a dispatch that crashed leaves one
 *     too. What it does mean is "the dispatch was attempted", and a dispatch
 *     that ran and failed is a round where David gets the fixed *translation
 *     unavailable* notice -- which the contract accepts as that round's
 *     account. So it passes, one rung down.
 *
 * Checking only the exit file would pass a round whose dispatch died; checking
 * only the receipt would refuse a round that legitimately came back
 * unavailable, and refuse every round dispatched outside the recipe. The
 * ordering is what makes both come out right.
 *
 * AND ABOVE BOTH, THE DELIVERY RECORD (David, 2026-09-14: "write a file that
 * tells me that you delivered the artifact"). Neither artifact below it says
 * the account reached David; the page is published and the line is pasted
 * by hand, after the dispatch returns. `record-delivery.mjs` writes
 * `delivered.json` as the last line of that step, naming the rounds it
 * carried. A round that is on that list is DONE. A round with an account but
 * not on that list is UNDELIVERED -- produced, never shown -- and the gate
 * refuses it, which is the #85 failure one step later: the step was
 * forgotten, so the file is absent, so the merge does not go out.
 *
 * This is not a defence against a false marker; David's rule already says
 * none is built. It is a defence against the forgotten step, which is the
 * failure that actually happened.
 */
export function roundState(root, pr, r, { exists = fs.existsSync, receipts = receiptsFor, delivered = delivery } = {}) {
  const d = delivered(root, pr);
  if (d && d.rounds.includes(r)) return "done";
  if (receipts(root, pr).some((rc) => rc.round === r)) return "undelivered";
  const dir = reviewsDir(root, pr);
  if (exists(path.join(dir, `d0-r${r}.exit`))) return "undelivered";
  if (exists(path.join(dir, `snap-r${r}.json`))) return "pending";
  return "missing";
}

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

  // THE ROUND NEVER GOES BACKWARDS, AND WHAT CARRIES IT FORWARD IS THE PASSES
  // THEMSELVES, NOT THE COUNT. This is the last hole in gap 16, and it was
  // reached from the opposite side to the one that opened it.
  //
  // `reviewerPasses` is lossy in one shape, and the loss is named in its own
  // source: the connector's summary row is ONE comment per PR, rewritten each
  // round, so two clean automatic rounds on different commits leave only the
  // later one. A count that can fall makes close-out's bound fall with it, so
  // a round that already has a snapshot and an exit file on disk stops being
  // checked, and close-out reports success with that round's translation
  // unaccounted for. (Codex, #82 round 3.)
  //
  // THE FIRST FIX FOR THAT FLOORED THE COUNT -- `max(previous.round,
  // observed)` -- AND IT FAILED IN A WAY THAT WAS WORSE THAN THE BUG. Once a
  // loss exists, every later real pass raises `observed` by one too, so the
  // floor is never again the larger of the two and the recorded round stays
  // PERMANENTLY one behind. Worse, `observedRound` catches back up to the
  // floored `round`, so the "held at" announcement that made the loss visible
  // disappears at exactly the moment the loss stops being transient. Measured:
  // true round 3 recorded as 2, announced as nothing. (Codex, #83 round 1.)
  //
  // Comparing counts cannot work, because the count is the one thing the lossy
  // evidence destroys. So the position carries the passes instead:
  // `observedPasses` tallies how many passes each commit has ever been seen to
  // have, and the round is the sum of those per-commit high-water marks. A
  // pass cannot be un-made, so keeping the highest count ever seen for a
  // commit is sound rather than merely safe, and the sum is monotone by
  // construction rather than by a comparison that can be skipped.
  //
  // PER COMMIT, NOT PER SIGHTING, AND THAT IS DELIBERATE. One pass can be seen
  // first as a summary row and later as its own marker announcement -- the
  // summary fallback fires only "for a commit no marker announcement already
  // names" -- and those two sightings carry different timestamps. Keying on
  // the sighting would count that single pass twice; keying on the commit and
  // keeping a count cannot, while #292's twice-announced commit still counts
  // twice because the evidence itself says two.
  //
  // WHAT THIS STILL DOES NOT FIX, stated rather than papered over: two clean
  // automatic rounds on the SAME commit collapse to one, because the evidence
  // never showed two and nothing here can invent what was never observed. That
  // residual belongs to `reviewerPasses`, is capped at one by the automatic
  // triggers that produce it, and errs toward spending budget more slowly.
  //
  // AND IT IS VISIBLE, NEVER SILENT. `observedRound` keeps what this snapshot
  // actually derived, so a carried pass is a disagreement anyone can see and
  // `describe` prints -- and it now keeps printing, because the discrepancy is
  // permanent rather than transient.
  const observedRound = counted.delivered;
  const mine = previous && previous.pr === snapshot.pr.number && sameRepo(previous.repo, snapshot.repo);
  const observedPasses = highWater(mine ? previous.observedPasses : null, tallyByCommit(passes));

  // A POSITION WRITTEN BEFORE THE TALLY EXISTED STILL KNOWS ITS ROUND, AND
  // THROWING THAT AWAY IS THE REGRESSION THIS FILE EXISTS TO PREVENT. Every
  // position already on disk anywhere carries `round` and no `observedPasses`,
  // so the first assembly after this ships finds a carry it cannot read and
  // carries nothing. If the evidence happens to be lossy at that moment the
  // round silently drops to the smaller fresh derivation -- and the deficit is
  // gone for good, so it never recovers either. Measured: a legacy round 2
  // became 1, and the next real pass made it 2 when the truth was 3.
  // (Codex, #83 round 2.)
  //
  // The legacy file knows a TOTAL and not which commits it came from, so the
  // shortfall is booked to a reserved key rather than invented against a
  // commit. Booking the whole legacy round would double-count every pass the
  // fresh evidence can already see; booking only the difference cannot, and
  // when the fresh evidence already accounts for everything the legacy file
  // knew, nothing is booked at all.
  //
  // THIS RUNS ONCE. The write that reads a legacy position replaces it with a
  // tallied one, so the branch is dead from then on -- which is why a bound
  // here cannot become the permanently-trailing floor it replaced.
  //
  // The residual, named rather than hidden: if the capture is incomplete at
  // exactly this one write, the shortfall is booked and a later complete
  // capture re-counts those passes, so the round runs one high and close-out
  // refuses a round that never happened. That is louder and rarer than the
  // alternative -- it needs a short capture on the single transition write,
  // where dropping the round needs only the recurring summary-row rewrite --
  // and a refusal is discovered, where a silent omission is not.
  if (mine && !isTally(previous.observedPasses)) {
    // Strict, like the tally's own entries: a machine wrote this file, so a
    // round that is a string or a float is corruption, not a value to coerce.
    const legacy = previous.round;
    const seen = total(observedPasses);
    if (Number.isInteger(legacy) && legacy > seen) observedPasses[PRE_TALLY] = legacy - seen;
  }

  const round = total(observedPasses);

  return {
    pr: snapshot.pr.number,
    repo: snapshot.repo ?? null,
    head: snapshot.pr.head.sha,
    round,
    observedRound,
    observedPasses,
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

/**
 * Where a round carried from a position written before the tally existed is
 * booked. That file knows a total and not which commits it came from, so the
 * shortfall gets a key of its own. It never prefix-matches a commit sha, and
 * it is carried forward like any other entry once written.
 */
const PRE_TALLY = "pre-tally";

/** A tally is a plain object of counts. An array's indices are not commits. */
const isTally = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** The round: every pass this PR has ever been seen to have. */
const total = (tally) => Object.values(tally).reduce((n, c) => n + c, 0);

/**
 * How many passes the evidence currently shows for each commit. The commit is
 * the key because it is the one part of a pass's identity that survives the
 * rewrite that loses it; a pass with no commit to name is tallied under a
 * single reserved key rather than dropped.
 */
const tallyByCommit = (passes) => {
  const byCommit = {};
  for (const p of passes) {
    const key = String(p.commit ?? "unannounced").toLowerCase();
    byCommit[key] = (byCommit[key] ?? 0) + 1;
  }
  return byCommit;
};

/**
 * The per-commit high-water mark of what was carried forward and what this
 * snapshot shows.
 *
 * MATCHED THE WAY THIS MACHINERY MATCHES COMMITS ANYWHERE ELSE -- by prefix,
 * through `review-counting`'s own `sameCommit` -- and that is load-bearing
 * rather than tidy. The two announcement shapes name the same commit at
 * different lengths: a marker carries the full forty characters, while the
 * connector's summary row carries the abbreviated form it renders. Within one
 * snapshot `reviewerPasses` already reconciles them, so they never both
 * appear; ACROSS snapshots they would, and an exact-key tally would then read
 * one pass seen in both shapes as two and inflate the round permanently. That
 * is the same class of defect as the undercount this carry exists to fix,
 * facing the other way. The longer key wins, since it is the one that
 * identifies the commit.
 *
 * A missing, malformed or negative carried entry contributes nothing rather
 * than throwing -- this runs inside the snapshot assembler, and corrupt
 * evidence must not fail an assembly that otherwise succeeded. An array is
 * rejected as a class and not merely when empty: its indices would enter the
 * tally as commit keys.
 */
const highWater = (carried, current) => {
  const out = { ...current };
  const prior = isTally(carried) ? carried : {};
  for (const [commit, n] of Object.entries(prior)) {
    if (!Number.isInteger(n) || n < 0) continue;
    const match = Object.keys(out).find((k) => sameCommit(k, commit));
    if (match === undefined) {
      out[commit] = n;
      continue;
    }
    const key = match.length >= commit.length ? match : commit;
    const seen = Math.max(out[match], n);
    if (key !== match) delete out[match];
    out[key] = seen;
  }
  return out;
};

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
