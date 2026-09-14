#!/usr/bin/env node
// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
/**
 * Tell David what he is about to merge, in plain English.
 *
 *   node scripts/merge-brief.mjs --pr 88        # preview the brief, no dispatch
 *   node scripts/fable-dispatch.mjs --role merge-opinion --pr 88
 *
 * WHY (workstream #36, role D2). David cannot read code. At a merge he has
 * exactly two things today: the round translations, which say what happened in
 * each REVIEW ROUND, and my own merge report, which is the builder's account of
 * the builder's work. Nothing answers the question the merge actually turns on:
 *
 *   What is this thing, what does it NOT do, and what am I trusting?
 *
 * Measured on #88, the pull request that shipped D3: David merged it having
 * read four round translations and my summary, and not one of those was an
 * independent answer to "what is this." The rounds each described a fix. None
 * described the artifact.
 *
 * IT READS THE MECHANICAL RECORD, NOT MY PROSE. The record
 * `review-loop-record.mjs` already generates for the adjudicator is exactly the
 * unslantable input set this needs -- the diff, the approved plan's oracle
 * sections pinned to their commit, the threat model, every finding and what
 * happened to it, the loop's shape. It is script-assembled by construction, so
 * reusing it is both the simplest thing and the only one that keeps D2's
 * independence. The recorded gaps come from the terminal verdict through
 * `gapsFor`, the same function D3 uses.
 *
 * WHAT IT DELIBERATELY DOES NOT READ: my merge report, my PR-body argument, my
 * thread replies. Workstream #36: a touchpoint role "does not read the
 * builder's banner first -- David gets two independent framings, and their
 * disagreement is the signal." A D2 that read my summary would be reviewing my
 * summary. The plan oracle IS read, quoted from the body, because it is the
 * human-approved statement of intent the adjudicator already runs on -- not the
 * builder's case for the diff.
 *
 * IT DECIDES NOTHING. No gate reads it, no receipt consumes it, and a failure
 * here leaves the merge bar exactly where it was.
 *
 * EXIT CODES
 *   0  written        2  arguments unusable, or this PR has no record to read
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { REPO_ROOT } from "./review-budget.mjs";
import { ADJUDICATIONS_DIR } from "./review-loop-record.mjs";
import { gapsFor } from "./gaps-translation.mjs";

/** Where the merge brief lands. Beside the round translations and the gaps. */
export const mergePath = (root, pr) => path.join(root, ".agents", "reviews", `pr-${pr}`, "merge.md");

/** The round a record filename carries, so `<pr>-10` sorts after `<pr>-9`. */
const roundOf = (name) => Number(/-(\d+)\.json$/.exec(name)?.[1] ?? 0);

/**
 * The LAST mechanical record this loop generated, which is the one describing
 * the state being merged.
 *
 * Numeric sort for the same reason `gapsFor` uses one: round 10 is the last
 * record, not round 9. `.verdict.json` files are excluded by the pattern --
 * they are the adjudicator's answer, not the record it ruled on.
 */
export function latestRecordFor(root, pr, { dir = ADJUDICATIONS_DIR, read = fs.readFileSync, list = fs.readdirSync } = {}) {
  const base = path.join(root, dir);
  if (!fs.existsSync(base)) return null;
  const mine = list(base)
    .filter((n) => new RegExp(`^${pr}-\\d+\\.json$`).test(n))
    .sort((a, b) => roundOf(a) - roundOf(b));
  for (const name of mine.reverse()) {
    try {
      return { from: name, record: JSON.parse(read(path.join(base, name), "utf8")) };
    } catch {
      continue; // an unreadable record should not cost David the brief
    }
  }
  return null;
}

/** One finding, reduced to what a reader who cannot read code needs. */
const findingLine = (f, i) =>
  `${i + 1}. [${f.severity ?? "?"}] ${String(f.title ?? f.body ?? "").split("\n")[0].slice(0, 300)}` +
  `\n   file: ${f.path ?? "not stated"} | resolved: ${f.resolved === true ? "yes" : f.resolved === false ? "NO" : "unknown"}`;

/**
 * The brief. Composed here, from the record and the verdict files -- never from
 * my prose.
 */
export function mergeBrief(pr, { record, gaps }) {
  const o = record.planOracle ?? {};
  const sections = o.sections ?? null;
  const out = [
    `# What David is about to merge: pull request #${pr}`,
    "",
    `Title, as the builder wrote it: ${JSON.stringify(record.title ?? "(none)")}`,
    "",
    "You are writing for David. He is the product manager, he cannot read code,",
    "and he is about to decide whether this merges. Everything below is",
    "script-assembled from the mechanical record: the diff, the approved plan's",
    "own words, the threat model, and every finding the reviewer raised. The",
    "builder's summary, its pull-request argument and its replies are",
    "DELIBERATELY ABSENT -- your account is meant to be independent of them.",
    "",
    "Answer three questions, in plain English, each in its own field:",
    "",
    "  1. WHAT THIS DOES. Not the file list -- what changes for someone using or",
    "     operating this. If it changes nothing anyone would notice, say that",
    "     plainly; a lot of what he merges is machinery, and 'this is plumbing'",
    "     is a real and useful answer.",
    "  2. WHAT IT DOES NOT DO. The limits: what a reasonable person would assume",
    "     this covers and it does not, what was left for later, what it refuses.",
    "     This is the field he cannot get anywhere else, so do not pad it with",
    "     restatements of question 1.",
    "  3. WHAT HE IS TRUSTING. What rests on judgement rather than evidence --",
    "     paths with no test, defects knowingly shipped, findings declined,",
    "     assumptions the diff makes about its inputs. Be specific and be",
    "     honest; if the answer is 'very little, this is well covered', say so.",
    "",
    "Then one line: what, if anything, he should do before merging.",
    "",
    "No preamble, no code, no headings of your own.",
    "",
    "---",
    "",
    `## The tier this was reviewed at: ${record.budget?.tier ?? "unknown"}`,
    "",
    `${record.budget?.tierMeaning ?? ""}`,
    `Rounds completed: ${record.rounds?.completedReviewerPasses ?? "unknown"}.`,
    `Findings per round: ${JSON.stringify(record.rounds?.trend ?? [])}.`,
    "",
  ];

  out.push("## What the change was supposed to be, in the approved plan's own words", "");
  if (sections && Object.keys(sections).length) {
    for (const [heading, text] of Object.entries(sections)) {
      out.push(`### ${heading}`, "", String(text ?? "(empty)").trim(), "");
    }
  } else {
    out.push(
      `There is no approved-plan oracle on this pull request (${o.reason ?? "not stated"}).`,
      "That is normal for a small or mechanical change, and it means you have no",
      "statement of intent to judge the diff against -- say so in your answer",
      "rather than inventing one.",
      "",
    );
  }

  out.push("## What the reviewer found, and whether it was resolved", "");
  const items = Array.isArray(record.findings?.items) ? record.findings.items : [];
  if (items.length) {
    out.push(...items.map(findingLine), "");
    out.push(
      `Unresolved: ${record.findings.unresolved ?? "?"}. Resolved: ${record.findings.resolved ?? "?"}. ` +
        `Unknown: ${record.findings.resolutionUnknown ?? "?"}.`,
      "",
    );
  } else {
    out.push("No findings were recorded on this loop.", "");
  }

  out.push("## Defects being shipped rather than fixed", "");
  if (gaps.length) {
    out.push(...gaps.map((g, i) => `${i + 1}. ${g.text}`), "");
  } else {
    out.push("None recorded.", "");
  }

  out.push(
    "## The code itself",
    "",
    `${record.artifact?.files ?? "?"} file(s), ${record.artifact?.added ?? "?"} line(s) added, ` +
      `${record.artifact?.removed ?? "?"} removed.`,
    "",
    ...(Array.isArray(record.artifact?.patch) ? record.artifact.patch : ["(the record carried no patch)"]),
    "",
  );
  return out.join("\n");
}

/**
 * The answer as David reads it.
 *
 * A plain file, written by the code that produced the answer, before anything
 * else happens to it -- the rule #88 round 2 cost a round to learn.
 */
export function renderMerge(pr, answer) {
  const rec = answer.recommendation;
  return [
    `# What you are about to merge: pull request #${pr}`,
    "",
    "Written by Fable from the mechanical record — the diff, the approved plan's",
    "own words, and every finding. It did not read the builder's summary. It",
    "decides nothing.",
    "",
    "## What this does",
    "",
    answer.what_this_does.trim(),
    "",
    "## What it does not do",
    "",
    answer.what_it_does_not_do.trim(),
    "",
    "## What you are trusting",
    "",
    answer.what_you_are_trusting.trim(),
    "",
    "## Before you merge",
    "",
    rec && String(rec).trim() ? String(rec).trim() : "Nothing — merge it.",
    "",
  ].join("\n");
}

/** Write it, and hand back the path. One step, no caller cooperation needed. */
export function writeMerge(root, pr, answer) {
  const out = mergePath(root, pr);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, renderMerge(pr, answer));
  return out;
}

/** Everything the brief is built from, gathered in one place. */
export function inputsFor(root, pr) {
  const found = latestRecordFor(root, pr);
  if (!found) return null;
  return { from: found.from, record: found.record, gaps: gapsFor(root, pr) };
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
    log.write(`merge-brief: ${e.message}\n`);
    return 2;
  }
  const inputs = inputsFor(root, args.pr);
  if (!inputs) {
    log.write(
      `merge-brief: PR #${args.pr} has no mechanical record under ${ADJUDICATIONS_DIR} -- ` +
        `generate one with review-loop-record.mjs first, or this loop never ran one\n`,
    );
    return 2;
  }
  const brief = path.join(root, ".agents", "reviews", `pr-${args.pr}`, "merge-brief.md");
  fs.mkdirSync(path.dirname(brief), { recursive: true });
  fs.writeFileSync(brief, mergeBrief(args.pr, inputs));
  log.write(
    `merge-brief: from ${inputs.from}, ${inputs.record.findings?.items?.length ?? 0} finding(s), ` +
      `${inputs.gaps.length} recorded gap(s) -> ${path.relative(root, brief)}\n`,
  );
  out.write(`${brief}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
