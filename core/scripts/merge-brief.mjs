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
import { spawnSync } from "node:child_process";
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

/**
 * A capped text field, as the record actually stores it.
 *
 * `applyCaps()` converts every long string in the record to an ARRAY OF SOURCE
 * LINES, and older records still carry plain strings. `String(array)` joins
 * with commas, so an oracle section or a finding body arrived as run-on prose
 * with `,,` where its blank lines had been -- measured on the brief this very
 * pull request generated for #88, which I read and did not notice, because I
 * was reading the answer for quality rather than the brief for fidelity to its
 * inputs (Codex, #90 round 1).
 */
export const asText = (v) => (Array.isArray(v) ? v.join("\n") : typeof v === "string" ? v : String(v ?? ""));

/**
 * One finding, WHOLE.
 *
 * No severity is invented: `reviewerFindings()` items carry `threadId`, `path`,
 * `line`, `resolved`, `outdated`, `createdAt` and `body` -- there is no
 * `severity` and no `title`, so the first version printed every real finding as
 * `[?]`. No truncation either: the record already caps these deliberately and
 * its own note records that even a 400-character excerpt was too short to
 * assess a finding by. A second cut here would drop the trigger or the
 * consequence, which is exactly what `what_you_are_trusting` is built from.
 *
 * `resolved` is GITHUB THREAD STATE, NOT CODE STATE, and the record says so in
 * its own note. Labelling it "resolved: yes/NO" reproduced the error that note
 * exists to prevent -- the record's first live adjudication read `false` as
 * "never fixed" and reasoned from it.
 */
const threadState = (f) =>
  f.resolved === true
    ? "thread closed (the reviewer was told it was handled)"
    : f.resolved === false
      ? "thread still open (may already be fixed and unanswered)"
      : "thread state unknown";

const findingBlock = (f, i) =>
  [`### Finding ${i + 1} — ${threadState(f)}`, `file: ${f.path ?? "not stated"}`, "", asText(f.body).trim(), ""].join("\n");

/**
 * The brief. Composed here, from the record and the verdict files -- never from
 * my prose.
 */
/**
 * Which commit this account actually describes, and whether that is the one
 * being merged.
 *
 * THE RECORD IS GENERATED BEFORE A ROUND'S FIXES ARE PUSHED -- that ordering is
 * required (`pr-watch`: the generator refuses an unreviewed head, so a push
 * closes the window). So on a loop whose last round came back clean, the newest
 * record describes the state BEFORE the final fixes, and presenting its patch
 * as "what you are merging" would be stale (Codex, #90 round 1).
 *
 * This does not try to regenerate the record -- that needs a fresh snapshot and
 * a reviewed head, which is the merge gate's job, not this one's. It states the
 * gap instead, with the commits in between, and the role is told to caveat
 * rather than assert. An account that knows what it is missing beats one that
 * quietly describes the wrong commit.
 */
export function headNote(record, headNow) {
  const described = record.sinceLastReview?.head ?? record.dispatch?.sha ?? null;
  if (!described) {
    return [
      "The record does not say which commit it describes. Treat the code below as",
      "indicative rather than exact, and say so if it matters to your answer.",
    ].join("\n");
  }
  if (!headNow) {
    return `This account describes commit ${described}. The current head could not be read, so nothing confirms that is what is being merged.`;
  }
  if (described === headNow) {
    return `This account describes commit ${described}, which IS the head being merged. The code below is the code that lands.`;
  }
  return [
    `**This account describes commit ${described}. The head being merged is ${headNow}.**`,
    "",
    "The record is generated before a round's fixes are pushed, so anything the",
    "builder changed after that commit is NOT in the code below. Say so where it",
    "bears on your answer rather than describing the older commit as though it",
    "were the one landing.",
  ].join("\n");
}

export function mergeBrief(pr, { record, gaps, headNow = null }) {
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
    "## Which commit this account describes",
    "",
    headNote(record, headNow),
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
      out.push(`### ${heading}`, "", asText(text).trim() || "(empty)", "");
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

  out.push("## The threat model this tier is reviewed against", "");
  const tm = record.threatModel ?? {};
  if (tm.text && asText(tm.text).trim()) {
    out.push(asText(tm.text).trim(), "");
  } else {
    out.push(
      `The record carried no threat model (${tm.reason ?? "no reason given"}). You have no written`,
      "statement of what this repository considers worth defending against, so do",
      "not imply one when you answer what David is trusting.",
      "",
    );
  }

  out.push("## What the reviewer raised, and the state of each thread", "");
  const items = Array.isArray(record.findings?.items) ? record.findings.items : [];
  if (items.length) {
    out.push(...items.map(findingBlock), "");
    out.push(
      `Threads closed: ${record.findings.resolved ?? "?"}. Threads open: ${record.findings.unresolved ?? "?"}. ` +
        `Unknown: ${record.findings.resolutionUnknown ?? "?"}.`,
      "",
      "**These are thread states, not code states**, and the record says so itself:",
      "",
      `> ${asText(record.findings.note).trim().replace(/\n/g, "\n> ")}`,
      "",
      "So do not tell David a finding was fixed because its thread is closed, or",
      "that one is outstanding because its thread is open. Where it matters and",
      "the diff does not settle it, say you cannot tell.",
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
    // NOT "merge it". The schema documents null as the common answer, and the
    // role's whole boundary is that it does not approve -- rendering absence as
    // an instruction to merge put model-generated approval in front of the
    // person whose click is the entire control (Codex, #90 round 1).
    rec && String(rec).trim() ? String(rec).trim() : "Nothing to do before you decide.",
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
/** The commit actually checked out, so the brief can say whether it matches. */
export function currentHead(root, { run = spawnSync } = {}) {
  const r = run("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function inputsFor(root, pr, { head = currentHead } = {}) {
  const found = latestRecordFor(root, pr);
  if (!found) return null;
  return { from: found.from, record: found.record, gaps: gapsFor(root, pr), headNow: head(root) };
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
  const described = inputs.record.sinceLastReview?.head ?? null;
  const stale = described && inputs.headNow && described !== inputs.headNow;
  log.write(
    `merge-brief: from ${inputs.from}, ${inputs.record.findings?.items?.length ?? 0} finding(s), ` +
      `${inputs.gaps.length} recorded gap(s)` +
      `${stale ? ` -- WARNING: it describes ${described.slice(0, 7)}, head is ${inputs.headNow.slice(0, 7)}` : ""}` +
      ` -> ${path.relative(root, brief)}\n`,
  );
  out.write(`${brief}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
