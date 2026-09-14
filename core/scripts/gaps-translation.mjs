#!/usr/bin/env node
// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
/**
 * Turn a loop's recorded gaps into plain English for David.
 *
 *   node scripts/gaps-translation.mjs --pr 87
 *
 * WHY (David, 2026-09-14, verbatim: "we simply need to have a simple
 * translator function that takes each of the gaps that you already delivered
 * to me and put it in plain English"). Every loop that stops
 * `ship-with-gaps-recorded` ships known defects, and each one is recorded in
 * the adjudicator's verdict like this:
 *
 *   "record-delivery.mjs re-reads all receipts and exit files at invocation
 *    instead of the round set publishPage actually rendered, so a round whose
 *    account lands between the Artifact publish and the record-delivery call..."
 *
 * Forty of those across seven pull requests, every one a thing he agreed to
 * merge and none of them in words he can read. This reads them and says what
 * they mean.
 *
 * WHAT IT IS, AND ALL IT IS. It collects the `gaps` arrays out of this PR's
 * committed verdict files, hands them to Fable through the one dispatch path,
 * and writes what comes back. It decides nothing, gates nothing, and refuses
 * nothing. If it fails, the loop is unaffected -- the gaps are still in the
 * verdict files where they always were.
 *
 * DELIBERATELY NOT BUILT (David, same instruction: "we are going to stop
 * overbuilding and we are going to stop solving for problems that aren't
 * real"): no per-gap accounting, no dedup across loops, no severity model, no
 * gate on whether it ran, no defence against a malformed verdict beyond
 * skipping it. A gap summary that is occasionally missing is a paragraph he
 * does not get; it cannot merge anything or break anything.
 *
 * EXIT CODES
 *   0  written        2  arguments unusable, or this PR recorded no gaps
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { REPO_ROOT } from "./review-budget.mjs";
import { ADJUDICATIONS_DIR } from "./review-loop-record.mjs";

/** Where the plain-English summary lands. Beside the round translations. */
export const gapsPath = (root, pr) => path.join(root, ".agents", "reviews", `pr-${pr}`, "gaps.md");

/**
 * Verdicts that END a loop. Only `continue` reopens it.
 */
export const TERMINAL_VERDICTS = new Set(["ship-with-gaps-recorded", "split", "escalate"]);

/**
 * The gaps this PR is actually SHIPPING: the LAST verdict's, and no other's.
 *
 * Collecting every verdict's was wrong in the one way that matters. A gap the
 * loop went on to FIX still sits in the verdict that first recorded it, so
 * presenting the lot to David tells him he is merging with defects that were
 * repaired two rounds earlier -- the opposite of the truth. Measured on PR 79:
 * four gaps from a `continue` verdict and three from the terminal one, all
 * seven reported as shipped (Codex, #88 round 1).
 *
 * THE LAST VERDICT, not "every terminal one" -- which was this fix's own first
 * attempt, and wrong. A loop does not always end at its first terminal verdict:
 * David reopens one by granting rounds after the adjudicator has said ship, and
 * PR 87 carries three `ship-with-gaps-recorded` verdicts because of it. What
 * makes the last one sufficient is that the adjudicator RE-ENUMERATES what is
 * still open each time it rules -- verified on 87, where the `--show` gap
 * appears in both the second and third verdicts and the two that were fixed in
 * between appear in neither.
 *
 * A last verdict of `continue` means the loop is still running, so nothing is
 * shipping yet and the answer is empty. That is not an error: the caller
 * already treats "no gaps" as nothing to translate.
 *
 * A verdict file that will not parse is skipped, so the search walks backwards
 * to the newest READABLE verdict: one unreadable file should not cost David the
 * summary, and nothing downstream depends on this being complete.
 */
export function gapsFor(root, pr, { dir = ADJUDICATIONS_DIR, read = fs.readFileSync, list = fs.readdirSync } = {}) {
  const base = path.join(root, dir);
  if (!fs.existsSync(base)) return [];
  const mine = list(base)
    .filter((n) => n.startsWith(`${pr}-`) && n.endsWith(".verdict.json"))
    .sort((a, b) => roundOf(a) - roundOf(b));
  for (const name of mine.reverse()) {
    let v;
    try {
      v = JSON.parse(read(path.join(base, name), "utf8"));
    } catch {
      continue;
    }
    const o = v.verdict ?? v;
    if (!TERMINAL_VERDICTS.has(o.verdict)) return [];
    return (Array.isArray(o.gaps) ? o.gaps : [])
      .filter((text) => typeof text === "string" && text.trim())
      .map((text) => ({ from: name, verdict: o.verdict, text: text.trim() }));
  }
  return [];
}

/**
 * The round a verdict filename carries, so `<pr>-10` sorts after `<pr>-9`.
 * A lexical sort put 10 second and would have taken the wrong last verdict.
 */
const roundOf = (name) => Number(/-(\d+)\.verdict\.json$/.exec(name)?.[1] ?? 0);

export function gapsBrief(pr, gaps) {
  const out = [
    `# Known defects being shipped in pull request #${pr}`,
    "",
    "You are writing for David. He is the product manager. He does not read code,",
    "and he is about to merge this pull request. Each block below is a defect the",
    "builder and an adjudicator agreed to ship rather than fix.",
    "",
    "For EACH one, write a short paragraph answering, in plain English:",
    "",
    "  - what actually stops working, in terms of something he would notice;",
    "  - when it would happen, and how likely that is in ordinary use;",
    "  - what it would cost him if it did.",
    "",
    "Then one closing paragraph: taken together, how worried should he be, and is",
    "there one of these he should ask about before merging?",
    "",
    "Be direct. If a defect is genuinely inconsequential, say so plainly rather",
    "than dressing it up -- he wants to know which ones matter, and a summary that",
    "treats all of them as equally serious tells him nothing. Do not use the",
    "builder's framing or repeat its justifications; say what is true.",
    "",
    "No preamble, no heading of your own, no code. Plain prose he can read in a",
    "minute.",
    "",
    "---",
    "",
  ];
  gaps.forEach((g, i) => {
    out.push(`## Defect ${i + 1}`, "", g.text, "");
  });
  return out.join("\n");
}

export function parseArgs(argv) {
  const out = { pr: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== "--pr") throw new Error(`unknown argument ${JSON.stringify(argv[i])}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error("--pr needs a value");
    i += 1;
    out.pr = Number(v);
  }
  if (!Number.isInteger(out.pr) || out.pr <= 0) throw new Error("--pr must be a positive whole number");
  return out;
}

export function main(argv = process.argv.slice(2), { root = REPO_ROOT, log = process.stderr, out = process.stdout } = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    log.write(`gaps-translation: ${e.message}\n`);
    return 2;
  }
  const gaps = gapsFor(root, args.pr);
  if (!gaps.length) {
    log.write(`gaps-translation: PR #${args.pr} recorded no gaps -- nothing to translate\n`);
    return 2;
  }
  const brief = path.join(root, ".agents", "reviews", `pr-${args.pr}`, "gaps-brief.md");
  fs.mkdirSync(path.dirname(brief), { recursive: true });
  fs.writeFileSync(brief, gapsBrief(args.pr, gaps));
  log.write(`gaps-translation: ${gaps.length} gap(s) from ${new Set(gaps.map((g) => g.from)).size} verdict(s) -> ${path.relative(root, brief)}\n`);
  out.write(`${brief}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
