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
 * THE BOUND COMES FROM `loop-position.mjs`, NOT FROM A FILE THIS COMMAND IS
 * POINTED AT. The first version of this script derived the count from a
 * snapshot the operator named on the command line -- and in gap 16's own
 * scenario, a round whose capture failed has no snapshot, so the operator
 * names the previous one and gets the previous count. Same silent omission,
 * one step removed (D0, #82 round 1). Now there is nothing to name: the
 * position is the file the snapshot assembler writes from fresh evidence, and
 * this command refuses one older than the merge gate's own freshness bound.
 * "Refresh" is the ordinary step-2 capture, never an edit. (David, 2026-09-13.)
 *
 * USAGE
 *   node scripts/round-translation-closeout.mjs --pr <n> [--timeout-sec <s>]
 *        default timeout 900
 *
 * EXIT CODES
 *   0  every round that happened has an exit file
 *   1  a round has no account, a dispatch did not finish in time, or the
 *      position is missing or stale (assemble a fresh snapshot first)
 *   2  the arguments are unusable
 */

import { pathToFileURL } from "node:url";

import { MAX_SNAPSHOT_AGE_MS } from "./review-counting.mjs";
import { repoSlug } from "./review-budget.mjs";
import { loopPosition, describe, roundState } from "./loop-position.mjs";
import { repoRoot } from "./fable-dispatch.mjs";

/** How often the wait re-checks. The shell loop used the same interval. */
export const POLL_MS = 5000;

/**
 * Wait until every round is `done`, or report the ones that are not.
 *
 * `missing` rounds are collected and reported TOGETHER rather than returned at
 * the first one: a close-out told about one gap at a time is a close-out run
 * twice. They are also not waited on — nothing was dispatched for them, so
 * there is no exit file coming.
 */
export async function waitForRounds(root, pr, rounds, { timeoutMs = 900_000, pollMs = POLL_MS, now = Date.now, sleep, exists, receipts, delivered } = {}) {
  const opts = { exists, receipts, delivered };
  const state = (r) => roundState(root, pr, r, opts);
  const all = Array.from({ length: rounds }, (_, i) => i + 1);
  const missing = all.filter((r) => state(r) === "missing");
  const deadline = now() + timeoutMs;
  let pending = all.filter((r) => state(r) === "pending");
  const nap = sleep ?? ((ms) => new Promise((res) => setTimeout(res, ms)));

  // A pending round is waited on until it has an ACCOUNT -- its dispatch
  // returned. Delivery is a separate step that happens after every dispatch
  // is in, so waiting for `done` here would wait forever on a round that is
  // simply not published yet.
  while (pending.length && now() < deadline) {
    await nap(pollMs);
    pending = pending.filter((r) => ["pending", "missing"].includes(state(r)));
  }
  const undelivered = all.filter((r) => state(r) === "undelivered");
  return { missing, timedOut: pending, undelivered };
}

export function parseArgs(argv) {
  const out = { pr: null, timeoutSec: 900 };
  const KNOWN = new Set(["--pr", "--timeout-sec"]);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!KNOWN.has(a)) throw new Error(`unknown argument ${JSON.stringify(a)}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
    i += 1;
    if (a === "--pr") out.pr = Number(v);
    else out.timeoutSec = Number(v);
  }
  // WELL-FORMEDNESS ONLY on the two that are genuinely the caller's to choose:
  // which PR, and how long to wait. Neither is derivable from anything this
  // process holds. The round bound is not an argument at all.
  if (!Number.isInteger(out.pr) || out.pr <= 0) throw new Error("--pr must be a positive whole number");
  if (!Number.isFinite(out.timeoutSec) || out.timeoutSec <= 0) throw new Error("--timeout-sec must be a positive number of seconds");
  return out;
}

export async function main(argv = process.argv.slice(2), { root = null, log = process.stderr, now = Date.now(), slug = null } = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    log.write(`round-translation-closeout: ${e.message}\n`);
    return 2;
  }

  const here = root ?? repoRoot();
  const pos = loopPosition(here, args.pr, { now });
  if (!pos) {
    log.write(
      `round-translation-closeout: no loop position for PR #${args.pr} -- no snapshot has been assembled for it in this ` +
        `checkout. Assemble one (step 2) and run this again.\n`,
    );
    return 1;
  }
  const ours = slug ?? repoSlug();
  if (pos.repo && pos.repo.toLowerCase() !== String(ours).toLowerCase()) {
    log.write(`round-translation-closeout: the loop position was written for ${pos.repo}, not ${ours}\n`);
    return 2;
  }
  log.write(`round-translation-closeout: ${describe(pos)}\n`);
  // THE FRESHNESS BOUND IS THE MERGE GATE'S, reused rather than invented. A
  // position older than this could predate a whole round -- the exact hole a
  // hand-named snapshot had -- so close-out refuses it and says what to do.
  if (pos.stale) {
    log.write(
      `round-translation-closeout: that position is older than ${MAX_SNAPSHOT_AGE_MS / 60000} minutes, so a round ` +
        `could have landed since. Assemble a fresh snapshot (step 2) and run this again.\n`,
    );
    return 1;
  }

  const rounds = pos.round;
  if (rounds === 0) return 0;

  const { missing, timedOut, undelivered } = await waitForRounds(here, args.pr, rounds, { timeoutMs: args.timeoutSec * 1000 });

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
  // An undelivered round is the expected state at this point of a normal
  // close-out: every dispatch is in, and delivery is the next step. Said out
  // loud so the step is not skipped, and exit 1 so a merge ask cannot follow
  // a close-out that stopped here.
  if (undelivered.length) {
    log.write(
      `round-translation-closeout: round(s) ${undelivered.join(", ")} have an account but have not been delivered -- ` +
        `publish the page, paste each line, then: node scripts/record-delivery.mjs --pr ${args.pr} --url <artifact url>\n`,
    );
  }
  if (!missing.length && !timedOut.length && !undelivered.length) {
    log.write(`round-translation-closeout: all ${rounds} round(s) accounted for and delivered\n`);
  }
  return missing.length || timedOut.length || undelivered.length ? 1 : 0;
}

// `pathToFileURL(process.argv[1]).href` rather than a hand-built `file://`
// string: they differ whenever the checkout path needs escaping (a space, a
// `#`), and AI-Handbook #11 records a guard that exited 0 having evaluated
// nothing for exactly that reason.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
