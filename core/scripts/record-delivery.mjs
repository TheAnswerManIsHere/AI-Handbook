#!/usr/bin/env node
// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
/**
 * Write down that the translation page was delivered to David, and which
 * rounds it carried.
 *
 *   node scripts/record-delivery.mjs --pr <n> --url <artifact url>
 *   -> .agents/reviews/pr-<n>/delivered.json
 *
 * WHY THIS EXISTS (David, 2026-09-14, verbatim: "write a file that tells me
 * that you delivered the artifact. It can't be that hard."). It is not hard,
 * and the reason it took a loop to get here was an argument that was wrong:
 * that a delivery marker written by the same hand that forgets to deliver
 * proves nothing. That conflates two failures. LYING about delivery is out of
 * scope by David's own rule -- no defence is built against the builder's
 * intent. FORGETTING delivery is the failure that actually happened on #85,
 * and a marker whose write is the last line of the delivery step catches it
 * exactly: forget the step, and there is no marker, and the gate refuses.
 *
 * WHAT IT RECORDS. The Artifact URL the publish returned -- evidence from the
 * delivery surface, handed back by the service -- and the set of rounds that
 * were deliverable at that moment, READ rather than typed:
 *
 *   - rounds with a receipt: on the page, because `publishPage` renders the
 *     page from exactly these receipts;
 *   - rounds with an exit file and no receipt: the dispatch ran and failed,
 *     so what David gets is the fixed "translation unavailable" line, pasted
 *     in the same delivery step. Recorded under `unavailable` so the record
 *     says which kind of account each round got.
 *
 * ONE FILE PER PR, OVERWRITTEN ON EACH DELIVERY. The page is one artifact
 * republished in place, so its delivery is one fact that moves forward. The
 * gate asks a per-round question of it -- "was round k delivered?" -- and a
 * round that landed after the last delivery is refused until the page goes
 * out again with it. That is the point: the merge ask cannot go out on a page
 * one round behind.
 *
 * EXIT CODES
 *   0  written        2  arguments unusable, or nothing deliverable for this PR yet
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { REPO_ROOT } from "./review-budget.mjs";
import { receiptsFor } from "./round-translation-page.mjs";
import { deliveryPath, reviewsDir } from "./loop-position.mjs";

export function parseArgs(argv) {
  const out = { pr: null, url: null };
  const KNOWN = new Set(["--pr", "--url"]);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!KNOWN.has(a)) throw new Error(`unknown argument ${JSON.stringify(a)}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
    i += 1;
    if (a === "--pr") out.pr = Number(v);
    else out.url = v;
  }
  // Well-formedness only, on the two values genuinely the caller's to supply:
  // which PR, and the URL the publish handed back. Neither is derivable here.
  if (!Number.isInteger(out.pr) || out.pr <= 0) throw new Error("--pr must be a positive whole number");
  if (typeof out.url !== "string" || !/^https:\/\/\S+$/.test(out.url)) throw new Error("--url must be the https URL the publish returned");
  return out;
}

/** Rounds whose dispatch left an exit file: attempted, whatever the outcome. */
export function attemptedRounds(root, pr, { readdir = fs.readdirSync, exists = fs.existsSync } = {}) {
  const dir = reviewsDir(root, pr);
  if (!exists(dir)) return [];
  return readdir(dir)
    .map((name) => /^d0-r(\d+)\.exit$/.exec(name))
    .filter(Boolean)
    .map((m) => Number(m[1]));
}

export function recordDelivery(root, pr, url, { now = new Date(), receipts = receiptsFor, attempted = attemptedRounds } = {}) {
  const onPage = receipts(root, pr).map((r) => r.round);
  const unavailable = attempted(root, pr).filter((r) => !onPage.includes(r));
  const rounds = [...new Set([...onPage, ...unavailable])].sort((a, b) => a - b);
  if (!rounds.length) {
    throw new Error(`nothing deliverable for PR #${pr} in this checkout -- no receipt and no dispatch exit file`);
  }
  const record = { pr, url, deliveredAt: now.toISOString(), rounds, unavailable: unavailable.sort((a, b) => a - b) };
  const out = deliveryPath(root, pr);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  return { path: out, record };
}

export function main(argv = process.argv.slice(2), { root = REPO_ROOT, log = process.stderr } = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    log.write(`record-delivery: ${e.message}\n`);
    return 2;
  }
  try {
    const { path: out, record } = recordDelivery(root, args.pr, args.url);
    const note = record.unavailable.length ? ` (round(s) ${record.unavailable.join(", ")} as the fixed unavailable notice)` : "";
    log.write(`record-delivery: PR #${args.pr} delivered at ${record.deliveredAt}, rounds ${record.rounds.join(", ")}${note} -> ${path.relative(root, out)}\n`);
    return 0;
  } catch (e) {
    log.write(`record-delivery: ${e.message}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
