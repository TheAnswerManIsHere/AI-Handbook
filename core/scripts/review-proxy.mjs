#!/usr/bin/env node
// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
/**
 * The review proxy: David's step-back on a code-review round, fired
 * automatically instead of waiting for him to sense drift (#96).
 *
 * WHAT IT REPLACES, AND WHY THE REPLACEMENT IS SMALLER. The #89 cut removed an
 * adjudicator of 3,002 lines plus 2,607 of tests whose measured record on #91
 * was four dispatches, four agreements with the builder, and zero declines
 * citing it. It answered a compliance question the builder could already
 * answer, on a record a script assembled, on a trigger that was a number. This
 * asks an open question, on GitHub's own state, on a moment.
 *
 * WHAT IT IS FOR, IN ONE SENTENCE: the builder writes code for every finding
 * because a decline is a paragraph it must compose and defend while a fix is a
 * diff, and this fills the field instead so declining costs one line. The
 * measured failure is 41 findings and 41 fixes on #109, and roughly one
 * decline in seventeen on #102 -- the pull request that removed the previous
 * judge.
 *
 * ITS ANSWER DECIDES, PER FINDING (David, 2026-09-16). The builder executes
 * each disposition without re-weighing it; a disagreement goes to David with
 * both views and is never an override. Its direction and next action are
 * recommendations. Product forks go to David. That split is deliberate: Astra
 * argued for a wholly advisory proxy, David kept the binding per-finding field
 * because "advisory" puts the decision back in the paragraph that is the
 * measured failure, and the dissent is recorded on #96.
 *
 * THE REVIEWER IS ASTRA, NOT FABLE (David, 2026-09-17). D0 stays Fable. A
 * Fable subagent can only DISCLOSE its model; the Codex CLI takes `--model` as
 * a flag and a read-only sandbox the role cannot escape, which is a stronger
 * guarantee for a verdict that decides than for an account that informs.
 *
 * NO SANDBOX OVERRIDE, unlike the plan runner, which permits workspace-write
 * under `--unpinned`. This reviews the live checkout.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  modelTier,
  validate,
  assertSchemaSupported,
  signInStatus,
  spawnSyncDefault,
  SIGN_IN_INSTRUCTIONS,
  runCodex,
} from "./machinery.mjs";
import { REVIEWS_DIR, ensureReviewsIgnored } from "./round-translation.mjs";

export const ROLE = "review-proxy";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const briefPath = () => path.resolve(SCRIPT_DIR, "..", ".agents", "roles", `${ROLE}.md`);
export const schemaPath = () => path.resolve(SCRIPT_DIR, "..", ".agents", "roles", "schemas", `${ROLE}.schema.json`);

const loadSchema = () => JSON.parse(fs.readFileSync(schemaPath(), "utf8"));

/** Read-only, with no flag that relaxes it. See the header. */
export const SANDBOX = "read-only";

/** One xhigh plan round measured 522 seconds; this reads more and is given room. */
export const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * The builder's "where we are" note is CAPPED AND FLATTENED, as the plan
 * runner does for disposition notes. It is the one channel where the builder
 * speaks in its own voice to a judge whose answer binds it, so it gets a
 * paragraph, not a brief. Flattening also stops it forging the labelled
 * sections below by embedding newlines and a heading.
 */
export const MAX_NOTE_CHARS = 300;

export const LABELS = ["David", "oracle", "reviewer", "builder", "proxy"];
export const TIERS = ["product", "sensitive", "internal"];
export const DISPOSITIONS = ["write", "decline", "no_change_needed", "to_david"];
export const OUTCOMES = ["write", "finish", "ask_david", "insufficient_context"];

/**
 * What each tier asks of the proxy, in the SCRIPT-OWNED prefix.
 *
 * The lesson is `plan-review.mjs`'s, paid for on #102 round 1: a tier that is
 * validated, pinned and logged while never reaching the reviewer selects
 * nothing, and all three tiers generate identical instructions. So the caller
 * passes a name this file validates, and never a word the reviewer reads.
 */
export const TIER_RUBRICS = {
  product: [
    "**Tier: product.** This change becomes code David's users run and he cannot read. Write for a",
    "defect that would reach a user or corrupt data. Weigh a finding by what someone would feel if it",
    "shipped, never by how visible it is in the diff.",
  ],
  sensitive: [
    "**Tier: sensitive.** This touches auth, payments or a migration, so consequence dominates",
    "likelihood: an unlikely situation with a severe outcome is a `write`, and the usual 'this is a",
    "narrow case' discount does not apply. Irreversibility is the test. The class-level rule still",
    "binds here -- a sensitive tier is bound by it, never exempt from it.",
  ],
  internal: [
    "**Tier: internal.** This is tooling, process or agent-facing documentation. Its blast radius is a",
    "confused agent or a wrongly-blocked action, both of which announce themselves; nobody's data or",
    "money is downstream. **`write` is reserved for a very high chance of a CRITICAL flaw: a",
    "destructive or irreversible action, broken workstream tracking, or a widening of the builder's",
    "own authority.** Everything softer is a `decline` and ships as a recorded gap. This repository's",
    "measured failure is over-building tooling in response to correct findings, so expect most of this",
    "round to be declines and do not read that as shirking.",
  ],
};

/** The answer file, derived identically by the writer and the reader. */
export const answerPath = (root, pr, round) => {
  assertCoordinates(pr, round);
  return path.join(root, REVIEWS_DIR, `pr-${pr}`, `round-${round}.proxy.json`);
};

/**
 * A CHEAP WELL-FORMEDNESS CHECK ON AN INPUT THAT IS A CHOICE. The pull request
 * and round are the builder's to supply and no rule derives them, so they stay
 * inputs -- but both are interpolated into the answer path, where `pr: "12x"`
 * writes an answer the read for #12 never finds and reports as a failed
 * dispatch of a round that actually ran.
 */
function assertCoordinates(pr, round) {
  for (const [name, value] of [["pr", pr], ["round", round]]) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`review-proxy: ${name} must be a positive integer, got ${JSON.stringify(value)}`);
    }
  }
}

export function prepareAnswerPath(root, pr, round) {
  const file = answerPath(root, pr, round);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  ensureReviewsIgnored(root);
  // A STALE ANSWER MUST NEVER BE READ AS THIS DISPATCH'S. A re-dispatch after a
  // crash would otherwise read its predecessor and report it as fresh.
  fs.rmSync(file, { force: true });
  return file;
}

const flatten = (s) => String(s).replace(/\s+/g, " ").trim();

/**
 * A finding body is QUOTED LINE BY LINE, because it is not the builder's text.
 *
 * Findings arrive from review comments on a public-shaped pull request, so
 * anyone who can comment can put `## [oracle] What this work is for` at the
 * start of a line and hand the judge a second oracle. That judge's per-finding
 * disposition is executed without re-weighing, which makes an injected
 * instruction here worth more than it would be almost anywhere else in this
 * machinery. Prefixing every line makes a heading impossible to start: this
 * function owns line starts, and nothing pasted into it does. The builder's
 * own note is flattened to one line for the same reason, one aisle over.
 */
const quote = (s) =>
  String(s)
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

const cap = (s, n) => {
  const flat = flatten(s);
  return flat.length <= n ? flat : `${flat.slice(0, n - 1)}…`;
};

/**
 * Compose the prompt.
 *
 * THE ROLE BRIEF IS READ VERBATIM FROM ITS FILE, never assembled here, so the
 * instruction David reviews is the instruction that runs. Everything this
 * function adds is the round's evidence, and every piece of it is labelled
 * with who said it -- which is the correction to the old adjudicator, whose
 * "untouchable context" doctrine excluded the builder's reasoning entirely and
 * so judged a round it could not see the argument of.
 */
export function proxyBrief({
  root = undefined,
  pr,
  round,
  tier,
  reviewedCommit,
  oracle,
  findings,
  history = [],
  builderNote = "",
  io = undefined,
}) {
  assertCoordinates(pr, round);
  if (!TIER_RUBRICS[tier]) {
    throw new Error(`review-proxy: tier must be one of ${TIERS.join(", ")}, got ${JSON.stringify(tier)}`);
  }
  if (typeof reviewedCommit !== "string" || reviewedCommit.trim() === "") {
    throw new Error("review-proxy: reviewedCommit must be the commit this round reviewed; the answer names it back");
  }
  // THE ORACLE IS REQUIRED, AND THAT IS THE POINT (David, 2026-09-17): "we
  // should officially agree on an oracle before any round starts". A proxy
  // with no statement of what the work is for judges against the builder's
  // own description of it, which is the blind spot #39 gap 3 named. Refusing
  // here is what makes the agreement happen before the loop, not after.
  if (typeof oracle !== "string" || oracle.trim() === "") {
    throw new Error(
      "review-proxy: an oracle is required and must be agreed with David before the first round. It is the intent " +
        "he agreed before building -- an approved plan, an issue discussion, or a request he made -- recorded where " +
        "it can be quoted. The PR body is the builder's own prose and is not an oracle.",
    );
  }
  if (!Array.isArray(findings) || findings.length === 0) {
    throw new Error("review-proxy: the proxy is dispatched on a round that RETURNED findings; there are none here");
  }
  const seen = new Set();
  for (const f of findings) {
    if (!f || typeof f.id !== "string" || f.id.trim() === "") {
      throw new Error(`review-proxy: every finding needs a stable id, got ${JSON.stringify(f?.id)}`);
    }
    if (seen.has(f.id)) throw new Error(`review-proxy: finding id ${f.id} appears twice; ids key the answer`);
    seen.add(f.id);
  }

  const lines = [
    fs.readFileSync(briefPath(), "utf8").trim(),
    "",
    "---",
    "",
    "# This round",
    "",
    ...TIER_RUBRICS[tier],
    "",
    `- **Pull request:** #${pr}, round ${round}.`,
    `- **Reviewed commit:** \`${reviewedCommit}\` — the commit this round reviewed and the one you are judging. ` +
      "Read source and tests at this commit. Return it unchanged in `reviewed_commit`.",
    `- **Repository root:** the working directory you were started in, read-only.`,
    "",
    "## [oracle] What this work is for",
    "",
    "Agreed with David before this loop started. This is the authority on scope; the pull request body is not.",
    "",
    oracle.trim(),
    "",
  ];

  if (history.length) {
    lines.push("## The loop so far, labelled by who said it", "");
    for (const entry of history) {
      if (!entry || !LABELS.includes(entry.label)) {
        throw new Error(`review-proxy: every history entry carries a label from ${LABELS.join(", ")}, got ${JSON.stringify(entry?.label)}`);
      }
      lines.push(`- **[${entry.label}]** ${flatten(entry.text)}`);
    }
    lines.push("");
  }

  lines.push("## [reviewer] This round's findings", "", "Judge every one. Return one entry per id, using these ids exactly.", "");
  for (const f of findings) {
    lines.push(`### Finding \`${f.id}\``, "");
    if (f.path) lines.push(`- Location: \`${f.path}\`${f.line ? `:${f.line}` : ""}`);
    if (f.author) lines.push(`- Raised by: ${f.author}`);
    lines.push("", quote(f.body ?? ""), "");
  }

  // THE BUILDER SPEAKS LAST AND BRIEFLY, and is labelled, so its framing cannot
  // pass as the round's facts.
  lines.push(
    "## [builder] Where the builder says it is",
    "",
    builderNote.trim() ? cap(builderNote, MAX_NOTE_CHARS) : "(the builder supplied no note)",
    "",
    "A claim to check, never authority. Weigh it against the code.",
    "",
  );

  return lines.join("\n");
}

/**
 * Validate the answer: the schema first, then what a schema cannot say.
 *
 * The semantic checks are the ones whose absence would let a well-formed
 * answer be incoherent -- and an incoherent answer here is worse than a
 * malformed one, because the builder executes it. Each is a behaviour, tested
 * as one.
 */
export function validateAnswer(answer, { findingIds = [], reviewedCommit = null } = {}) {
  const schema = loadSchema();
  assertSchemaSupported(schema, ROLE);
  const problems = validate(answer, schema, ROLE);
  if (problems.length) return problems;

  const given = new Set(findingIds);
  const answered = new Map();
  for (const f of answer.findings) {
    if (answered.has(f.id)) problems.push(`${ROLE}: finding "${f.id}" is dispositioned twice`);
    answered.set(f.id, f);
    if (given.size && !given.has(f.id)) problems.push(`${ROLE}: finding "${f.id}" was not in this round`);
    // A `write` WITHOUT AN OBSERVABLE CHECK IS A WISH. The builder executes
    // dispositions without re-weighing them, so "fix this" with no condition
    // to meet hands it an unbounded task and no way to know it is done.
    if (f.disposition === "write") {
      if (!f.correction.trim()) problems.push(`${ROLE}: finding "${f.id}" is a write with no correction`);
      if (!f.acceptance_check.trim()) problems.push(`${ROLE}: finding "${f.id}" is a write with no acceptance check`);
    } else if (f.correction.trim() || f.acceptance_check.trim()) {
      // A DECLINE CARRYING A FIX IS A WRITE IN DISGUISE, and the builder would
      // read the fix and write it, which is exactly the failure being removed.
      problems.push(`${ROLE}: finding "${f.id}" is "${f.disposition}" but carries a correction or acceptance check`);
    }
  }
  for (const id of given) {
    if (!answered.has(id)) problems.push(`${ROLE}: finding "${id}" was raised this round and has no disposition`);
  }

  const writes = answer.findings.filter((f) => f.disposition === "write");
  const questions = answer.product_decisions_for_david;
  // A CLEAN ROUND NEVER ERASES AN OUTSTANDING HUMAN DECISION, and never hides
  // a fix nobody wrote. This is the check that makes `finish` mean something.
  if (answer.outcome === "finish") {
    if (writes.length) problems.push(`${ROLE}: outcome "finish" with ${writes.length} finding(s) still to write`);
    if (questions.length) problems.push(`${ROLE}: outcome "finish" with ${questions.length} unanswered question(s) for David`);
  }
  if (answer.outcome === "write" && !writes.length) {
    problems.push(`${ROLE}: outcome "write" but no finding is dispositioned "write"`);
  }
  if (answer.outcome === "ask_david" && !questions.length) {
    problems.push(`${ROLE}: outcome "ask_david" but no question is recorded for him`);
  }
  // A `to_david` DISPOSITION IS A QUESTION OR IT IS NOTHING: without an entry
  // in the list, the finding is parked with nobody holding it.
  if (answer.findings.some((f) => f.disposition === "to_david") && !questions.length) {
    problems.push(`${ROLE}: a finding is sent to David but no question is recorded for him`);
  }
  if (reviewedCommit && answer.reviewed_commit.trim() !== reviewedCommit.trim()) {
    problems.push(`${ROLE}: the answer names commit "${answer.reviewed_commit}" but this round judged "${reviewedCommit}"`);
  }
  return problems;
}

/**
 * Read the answer, in the shape the renderers consume.
 *
 * One shape for all three delivery failures -- no file, unparseable, invalid
 * -- because each is visibly a failure and none may wear the clothes of a
 * quiet round. The lesson is D0's: a failed read that rendered as "nothing to
 * report" was a P1 on #109.
 */
export function readAnswer(root, pr, round, { findingIds = [], reviewedCommit = null } = {}) {
  const file = answerPath(root, pr, round);
  const failed = (reason) => ({ pr, round, failed: true, reason });
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    return failed(`the proxy wrote no answer file (${err.code === "ENOENT" ? "not found" : err.code})`);
  }
  let answer;
  try {
    answer = JSON.parse(raw);
  } catch (err) {
    return failed(`the answer file is not valid JSON: ${err.message}`);
  }
  const problems = validateAnswer(answer, { findingIds, reviewedCommit });
  if (problems.length) return failed(`the answer did not match the expected shape: ${problems.join("; ")}`);
  return { pr, round, answer };
}

/**
 * What the builder must do, read off the answer rather than off its own
 * reading of it. The loop's next step is a function of the verdict, so the
 * verdict is what computes it.
 */
export function dispositions(result) {
  if (result.failed) return { failed: true, reason: result.reason, writes: [], declines: [], questions: [] };
  const a = result.answer;
  return {
    failed: false,
    outcome: a.outcome,
    writes: a.findings.filter((f) => f.disposition === "write"),
    declines: a.findings.filter((f) => f.disposition === "decline"),
    noChange: a.findings.filter((f) => f.disposition === "no_change_needed"),
    toDavid: a.findings.filter((f) => f.disposition === "to_david"),
    questions: a.product_decisions_for_david,
  };
}

const OUTCOME_HEADLINES = {
  write: "write the fixes below, and nothing else from this round",
  finish: "nothing left to write — the loop stops on this head",
  ask_david: "David has to decide before this goes further",
  insufficient_context: "could not judge this round on what it could reach",
};

/**
 * The comment posted on the pull request, every dispatch.
 *
 * IT IS RENDERED FROM THE VALIDATED ANSWER, NEVER PARAPHRASED. This is the
 * durable record of the proxy's reasoning, replacing the committed verdict
 * JSON the #89 cut removed, and it is what David and the next session read. A
 * builder that summarised it could summarise away the decline it disliked.
 *
 * The declines are printed in full and never folded into a count, because a
 * decline is the proxy overruling the reviewer on David's behalf and he asked
 * to see what is being chosen against (2026-09-17).
 */
export function prComment(result) {
  if (result.failed) {
    return [
      `## Review proxy — round ${result.round}: **dispatch failed**`,
      "",
      `No independent judgement of this round exists: ${result.reason}.`,
      "",
      "This is a failure of the proxy, not a report that the round was quiet. The builder does not",
      "take it as permission to write, and says in the round report that the proxy could not run.",
    ].join("\n");
  }
  const a = result.answer;
  const d = dispositions(result);
  const out = [
    `## Review proxy — round ${result.round}: **${OUTCOME_HEADLINES[a.outcome]}**`,
    "",
    a.summary_for_david,
    "",
    `**Should this exist?** ${a.should_this_exist} — ${a.should_this_exist_reason}`,
    "",
    `**Next action.** ${a.next_action}`,
    "",
    `**Judged at** \`${a.reviewed_commit}\`.`,
    "",
    `### Dispositions (${a.findings.length})`,
    "",
  ];
  for (const f of a.findings) {
    out.push(`- **${f.disposition}** \`${f.id}\` — ${f.worth}`);
    if (f.disposition === "write") out.push(`  - Correction: ${f.correction}`, `  - Done when: ${f.acceptance_check}`);
  }
  if (d.declines.length) {
    out.push("", `### Shipping as recorded gaps (${d.declines.length})`, "");
    for (const f of d.declines) out.push(`- \`${f.id}\` — ${f.worth}`);
  }
  if (a.product_decisions_for_david.length) {
    out.push("", `### For David (${a.product_decisions_for_david.length})`, "");
    for (const q of a.product_decisions_for_david) {
      out.push(`- **${q.question}**`);
      for (const o of q.options) out.push(`  - ${o}`);
      out.push(`  - *Proxy's recommendation:* ${q.recommendation}`);
    }
  }
  out.push("", `### The batch as a whole`, "", a.batch_assessment);
  out.push("", "### What it checked, and what it could not", "");
  out.push(a.verified_claims.length ? a.verified_claims.map((c) => `- Verified: ${c}`).join("\n") : "- Verified: nothing recorded");
  out.push(
    a.unable_to_verify.length
      ? a.unable_to_verify.map((c) => `- Unable to verify: ${c}`).join("\n")
      : "- Unable to verify: nothing reported",
  );
  return out.join("\n");
}

/**
 * Run the proxy. Returns the runner's own outcome; the ANSWER is read from the
 * file, never from this return value and never from the transcript.
 */
export function dispatch({ root, pr, round, prompt, timeoutMs = DEFAULT_TIMEOUT_MS, run = spawnSyncDefault, io = undefined }) {
  const status = signInStatus({ run });
  if (!status.signedIn) {
    return { ok: false, signIn: true, reason: status.missingBinary ? "no codex binary" : status.detail, instructions: SIGN_IN_INSTRUCTIONS };
  }
  const reviewer = modelTier("strongestCodex", io);
  const outFile = prepareAnswerPath(root, pr, round);
  const outcome = runCodex({
    prompt,
    schemaFile: schemaPath(),
    outFile,
    model: reviewer.id,
    effort: reviewer.effort,
    sandbox: SANDBOX,
    cwd: root,
    timeoutMs,
    run,
  });
  return { ok: outcome.status === 0, reviewer, outFile, ...outcome };
}

export const USAGE = [
  "review-proxy — David's step-back on one code-review round.",
  "",
  "  node core/scripts/review-proxy.mjs --pr <n> --round <n> --commit <sha> --tier <t> \\",
  "      --oracle-file <path> --findings-file <path.json> [--history-file <path.json>] [--note <text>]",
  "",
  `  --tier          one of ${TIERS.join(", ")}`,
  "  --oracle-file   the intent David agreed BEFORE this loop started. Required; there is no default.",
  "  --findings-file JSON array of { id, body, author?, path?, line? } — this round's findings.",
  "  --history-file  JSON array of { label, text } — labels: " + LABELS.join(", "),
  "  --note          the builder's 'where we are', capped at " + MAX_NOTE_CHARS + " characters.",
  "",
  `  The reviewer is pinned to the strongestCodex tier and the ${SANDBOX} sandbox, with no override.`,
].join("\n");

export function parseArgs(argv) {
  const flags = {};
  const names = { pr: "pr", round: "round", commit: "commit", tier: "tier", "oracle-file": "oracleFile", "findings-file": "findingsFile", "history-file": "historyFile", note: "note" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`review-proxy: unexpected argument ${JSON.stringify(arg)}`);
    const key = names[arg.slice(2)];
    if (!key) throw new Error(`review-proxy: unknown flag ${arg}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`review-proxy: ${arg} needs a value`);
    flags[key] = key === "pr" || key === "round" ? Number(value) : value;
    i += 1;
  }
  return flags;
}

export function main(argv = process.argv.slice(2), { root = process.cwd(), run = spawnSyncDefault, log = console.error } = {}) {
  let flags;
  try {
    flags = parseArgs(argv);
  } catch (err) {
    log(`${err.message}\n\n${USAGE}`);
    return 2;
  }
  const findings = JSON.parse(fs.readFileSync(flags.findingsFile, "utf8"));
  const history = flags.historyFile ? JSON.parse(fs.readFileSync(flags.historyFile, "utf8")) : [];
  let prompt;
  try {
    prompt = proxyBrief({
      root,
      pr: flags.pr,
      round: flags.round,
      tier: flags.tier,
      reviewedCommit: flags.commit,
      oracle: fs.readFileSync(flags.oracleFile, "utf8"),
      findings,
      history,
      builderNote: flags.note ?? "",
    });
  } catch (err) {
    log(`${err.message}\n\n${USAGE}`);
    return 2;
  }
  const result = dispatch({ root, pr: flags.pr, round: flags.round, prompt, run });
  if (result.signIn) {
    log(`review-proxy: ${result.instructions}`);
    return 2;
  }
  log(`review-proxy: round ${flags.round} on ${result.reviewer.id} (${result.reviewer.effort}, ${SANDBOX}) — ${result.seconds}s`);
  const read = readAnswer(root, flags.pr, flags.round, { findingIds: findings.map((f) => f.id), reviewedCommit: flags.commit });
  process.stdout.write(`${prComment(read)}\n`);
  // A FAILED DISPATCH IS NEVER PERMISSION TO SHIP. It exits non-zero, and the
  // comment it printed says so in words rather than leaving a caller to read
  // an exit code it may not check.
  return read.failed ? 1 : 0;
}

// `pathToFileURL`, never a hand-built `file://` string: the two differ whenever
// the checkout path needs escaping, and a script that never runs exits 0.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
