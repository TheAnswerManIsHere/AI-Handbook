#!/usr/bin/env node
// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
/**
 * Wait for every round's translation at close-out, and refuse if a round has
 * no account.
 *
 * WHY THIS IS A SCRIPT AND NOT FOUR LINES OF SHELL. The close-out wait lived
 * in `pr-watch`'s recipe as a pasted bash loop and produced FOUR findings in
 * one review loop (#81 rounds 6, 7 and 9, plus two defects in my own draft of
 * the round-9 fix): an unquoted expansion that word-split on a path containing
 * a space, an unmatched glob that waited forever on a file that cannot exist,
 * an `exit` that would close the operator's terminal, and an enumeration that
 * asked *which rounds produced a snapshot* rather than *which rounds
 * happened*. Every one of those was a defect in shell, not in the idea. The
 * idea is four lines; the shell around it is where the bugs were.
 *
 * WHAT IT FIXES THAT THE SHELL COULD NOT. The bound is DERIVED, not typed.
 * The recipe took `<rounds>` as a placeholder the operator filled in, and an
 * operator who undercounts it — 3 after a fourth pass landed — gets a loop
 * that never examines round 4 and reports success, silently omitting exactly
 * the account this check exists to guarantee. That is the same failure by
 * another route, and a value this code already holds is a value it must
 * compute rather than accept. (Codex, #82 round 1.) `reviewerPasses` is the
 * existing count, reused rather than reimplemented: the bound here is the
 * same number the budget guard and the record builder derive.
 *
 * WHAT IT DOES NOT DO. It never prints a translation, never composes a
 * *translation unavailable* line, and never dispatches. The fixed notices are
 * `fable-dispatch`'s own wording, and a round with no snapshot never reached
 * that script — a notice written here would be a sentence David cannot
 * distinguish from a genuine refusal. This says which rounds have no account
 * and stops; producing one is the operator going back to the capture step.
 *
 * It also does not touch `fable-dispatch.mjs`. That file decides what may
 * dispatch and is a guardrail carve-out; a close-out helper has no business
 * widening its flag table.
 *
 * USAGE
 *   node scripts/round-translation-closeout.mjs --pr <n> --mcp-snapshot <file>
 *        [--timeout-sec <s>]   default 900
 *
 * EXIT CODES
 *   0  every round that happened has an exit file
 *   1  a round has no account, or a dispatch did not finish in time
 *   2  the arguments or the snapshot are unusable
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { reviewerPasses } from "./review-counting.mjs";
import { assertSnapshotIsForPr } from "./round-translation-record.mjs";
import { repoRoot } from "./fable-dispatch.mjs";

/** How often the wait re-checks. The shell loop used the same interval. */
export const POLL_MS = 5000;

/** Where a PR's round artifacts live, relative to the repo root. */
export const reviewsDir = (root, pr) => path.join(root, ".agents", "reviews", `pr-${pr}`);

/**
 * How many reviewer passes this snapshot records.
 *
 * THE WHOLE POINT OF THE FILE: this number is asked of the evidence, never of
 * the operator. `reviewerPasses` is the counter the budget guard and the
 * record builder already use, so close-out's bound cannot disagree with the
 * round numbers everything else derives.
 */
export function roundsIn(snapshot) {
  return reviewerPasses(snapshot.reviews ?? [], snapshot.issueComments ?? []).length;
}

/**
 * Classify one round from what is on disk. Three states, not two.
 *
 * "Done" and "missing" would collapse the case that matters: a round that was
 * dispatched and has not returned yet is not a round with no account, and
 * treating it as one would refuse close-out on a translation that is simply
 * still running.
 */
export function roundState(dir, r, exists = fs.existsSync) {
  if (exists(path.join(dir, `d0-r${r}.exit`))) return "done";
  if (exists(path.join(dir, `snap-r${r}.json`))) return "pending";
  return "missing";
}

/**
 * Wait until every round is `done`, or report the ones that are not.
 *
 * `missing` rounds are collected and reported TOGETHER rather than returned at
 * the first one: a close-out told about one gap at a time is a close-out run
 * twice. They are also not waited on — nothing was dispatched for them, so
 * there is no exit file coming.
 */
export async function waitForRounds(dir, rounds, { timeoutMs = 900_000, pollMs = POLL_MS, now = Date.now, sleep, exists } = {}) {
  const all = Array.from({ length: rounds }, (_, i) => i + 1);
  const missing = all.filter((r) => roundState(dir, r, exists) === "missing");
  const deadline = now() + timeoutMs;
  let pending = all.filter((r) => roundState(dir, r, exists) === "pending");
  const nap = sleep ?? ((ms) => new Promise((res) => setTimeout(res, ms)));

  while (pending.length && now() < deadline) {
    await nap(pollMs);
    pending = pending.filter((r) => roundState(dir, r, exists) !== "done");
  }
  return { missing, timedOut: pending };
}

export function parseArgs(argv) {
  const out = { pr: null, snapshot: null, timeoutSec: 900 };
  const KNOWN = new Set(["--pr", "--mcp-snapshot", "--timeout-sec"]);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!KNOWN.has(a)) throw new Error(`unknown argument ${JSON.stringify(a)}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
    i += 1;
    if (a === "--pr") out.pr = Number(v);
    else if (a === "--mcp-snapshot") out.snapshot = v;
    else out.timeoutSec = Number(v);
  }
  // WELL-FORMEDNESS ONLY on the two that are genuinely the caller's to choose:
  // which PR, and how long to wait. Neither is derivable from anything this
  // process holds, which is exactly what separates them from `<rounds>`.
  if (!Number.isInteger(out.pr) || out.pr <= 0) throw new Error("--pr must be a positive whole number");
  if (!out.snapshot) throw new Error("--mcp-snapshot is required");
  if (!Number.isFinite(out.timeoutSec) || out.timeoutSec <= 0) throw new Error("--timeout-sec must be a positive number of seconds");
  return out;
}

export async function main(argv = process.argv.slice(2), { root = null, log = process.stderr } = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    log.write(`round-translation-closeout: ${e.message}\n`);
    return 2;
  }

  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(args.snapshot, "utf8"));
    assertSnapshotIsForPr(args.pr, snapshot);
  } catch (e) {
    log.write(`round-translation-closeout: ${e.message}\n`);
    return 2;
  }

  const here = root ?? repoRoot();
  const dir = reviewsDir(here, args.pr);
  const rounds = roundsIn(snapshot);
  log.write(`round-translation-closeout: ${rounds} completed reviewer pass(es) on PR #${args.pr}, derived from the snapshot\n`);
  if (rounds === 0) return 0;

  const { missing, timedOut } = await waitForRounds(dir, rounds, { timeoutMs: args.timeoutSec * 1000 });

  if (missing.length) {
    log.write(
      `round-translation-closeout: no snapshot and no dispatch for round(s) ${missing.join(", ")} -- go back to the ` +
        `capture step for each. The merge ask must not go out with a round absent from the page.\n`,
    );
  }
  if (timedOut.length) {
    log.write(
      `round-translation-closeout: round(s) ${timedOut.join(", ")} were dispatched but had not finished after ` +
        `${args.timeoutSec}s. Read .agents/reviews/pr-${args.pr}/d0-r<r>.log before deciding they failed.\n`,
    );
  }
  if (!missing.length && !timedOut.length) {
    log.write(`round-translation-closeout: all ${rounds} round(s) accounted for\n`);
  }
  return missing.length || timedOut.length ? 1 : 0;
}

// `pathToFileURL(process.argv[1]).href` rather than a hand-built `file://`
// string: they differ whenever the checkout path needs escaping (a space, a
// `#`), and AI-Handbook #11 records a guard that exited 0 having evaluated
// nothing for exactly that reason.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
