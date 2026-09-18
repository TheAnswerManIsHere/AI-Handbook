#!/usr/bin/env node
// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
/**
 * The review proxy: independent technical advice on a code-review round (#96).
 *
 * WHAT THIS IS, AFTER THE 2026-09-17 REDESIGN. Codex returns findings. Astra
 * and a Fable assessor each read the same findings, the same agreed intent and
 * the same revision, separately, and each says what is actually wrong and
 * whether acting on it is worthwhile. I compare the two, check disputed facts
 * in the repository, ask Astra a focused follow-up when a real question of
 * reasoning remains, and implement what is agreed. A purely technical
 * disagreement that survives that is settled by the Fable assessor, with its
 * reasoning recorded. Intended behaviour and accepted user-facing shortfalls
 * are David's.
 *
 * WHAT IT REPLACED, AND WHY THE SHAPE CHANGED. The first version had Astra
 * emit JSON whose per-finding disposition BOUND me, under a rubric that told
 * it to decline most findings. David replaced that design after working
 * through it with Astra: binding dispositions made every finding a
 * jurisdiction question, and a decline quota is the mirror image of the fix
 * quota it was built to fix. Both quotas are gone. There is no target rate in
 * either direction, and the measure is whether David can see what mattered and
 * why the response was proportionate.
 *
 * SO THERE IS NO SCHEMA HERE, DELIBERATELY. The substantive output is Markdown
 * because a person reads it. This module supplies the same package to both
 * assessors, stamps the metadata the harness already owns, and gets out of the
 * way. **Nothing parses an assessment to decide what happens next.** What
 * happens next is the action I state explicitly, in the block `actionBlock`
 * renders -- so no phrase in an assessment can authorise work, and agent
 * agreement never substitutes for David's approval.
 *
 * ASTRA IS THE CODEX CLI, PINNED, IN A READ-ONLY SANDBOX WITH NO OVERRIDE. The
 * plan runner permits workspace-write under `--unpinned`; this reviews the live
 * checkout and must not copy that escape hatch.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { modelTier, signInStatus, spawnSyncDefault, SIGN_IN_INSTRUCTIONS, runCodex } from "./machinery.mjs";
import { REVIEWS_DIR, ensureReviewsIgnored } from "./round-translation.mjs";

export const ROLE = "review-proxy";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const briefPath = () => path.resolve(SCRIPT_DIR, "..", ".agents", "roles", `${ROLE}.md`);
/**
 * The Worth rule lives in ONE file and is quoted verbatim into both assessors'
 * prompts and pointed at by the contracts. A judgement rule restated in three
 * places is three rules a year from now.
 */
export const judgmentPath = () => path.resolve(SCRIPT_DIR, "..", "docs", "ai-context", "review-judgment.md");

/** Read-only, with no flag that relaxes it. See the header. */
export const SANDBOX = "read-only";

/** One xhigh plan round measured 522 seconds; this reads more and is given room. */
export const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * My "where we are" note is capped and flattened, as the plan runner does for
 * disposition notes: a bound on how much of the prompt the assessed party's
 * own framing may occupy. Not a defence against anything -- I write the note
 * and I would be the one removing the cap.
 */
export const MAX_NOTE_CHARS = 300;

export const LABELS = ["David", "oracle", "reviewer", "builder", "astra", "fable"];
export const TIERS = ["product", "sensitive", "internal"];

/**
 * What each tier tells an assessor, now that no tier sets a threshold.
 *
 * UNDER THE OLD DESIGN THIS WAS A RUBRIC THAT DECIDED: `internal` reserved a
 * write for "a very high chance of a CRITICAL flaw" and everything softer was
 * a decline. That is exactly the quota David removed. What survives is the
 * only thing a tier ever genuinely knew -- **what is downstream of the change**
 * -- which the Worth rule needs in order to weigh a consequence at all, and
 * which nobody but the caller can supply.
 *
 * The lesson from `plan-review.mjs` on #102 round 1 still binds: a tier that
 * is validated, pinned and logged while never reaching the assessor selects
 * nothing. So it reaches the assessor, in the script-owned prefix.
 */
export const TIER_LENSES = {
  product: [
    "**What is downstream: product code.** Users run this and David cannot read it. Weigh consequences by",
    "what someone using the product would experience, and for how long, before anyone noticed.",
  ],
  sensitive: [
    "**What is downstream: auth, payments or a migration.** Recoverability is the thing to weigh hardest",
    "here, because a wrong authorization decision and a wrong migration cannot be taken back by a",
    "follow-up fix. This does not make every finding in these areas worthwhile; it changes which factor",
    "dominates.",
  ],
  internal: [
    "**What is downstream: the software factory.** This is tooling, process, or instructions agents read.",
    "Nobody's money or data is downstream, so weigh it by its effect on David's ability to direct agents,",
    "build features, fix bugs and understand results -- including recurring reversible disruption, which",
    "costs him real time even though each incident is individually recoverable.",
  ],
};

/**
 * What I can state as the next action. The list is short on purpose: it exists
 * so the step after an assessment is something I SAY, never something inferred
 * from an assessment's prose.
 */
export const ACTIONS = ["proceed", "investigate", "follow-up", "ask-david", "conclude"];

export const SOURCES = ["astra", "fable"];

/** The assessment file, derived identically by the writer and the reader. */
export const assessmentPath = (root, pr, round, { source, followUp = 0 } = {}) => {
  assertCoordinates(pr, round);
  if (!SOURCES.includes(source)) {
    throw new Error(`review-proxy: source must be one of ${SOURCES.join(", ")}, got ${JSON.stringify(source)}`);
  }
  if (!Number.isInteger(followUp) || followUp < 0) {
    throw new Error(`review-proxy: followUp must be a non-negative integer, got ${JSON.stringify(followUp)}`);
  }
  const suffix = followUp > 0 ? `.followup-${followUp}` : "";
  return path.join(root, REVIEWS_DIR, `pr-${pr}`, `round-${round}.${source}${suffix}.md`);
};

/**
 * A cheap well-formedness check on inputs that are a choice. The pull request
 * and round are mine to supply and no rule derives them, but both land in the
 * assessment path, where `pr: "12x"` writes where the read for #12 never looks
 * and reports a failed dispatch of an assessment that actually ran.
 */
function assertCoordinates(pr, round) {
  for (const [name, value] of [["pr", pr], ["round", round]]) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`review-proxy: ${name} must be a positive integer, got ${JSON.stringify(value)}`);
    }
  }
}

const defaultGit = (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8" });

/**
 * REFUSE UNLESS THE CHECKOUT IS THE REVISION BEING ASSESSED.
 *
 * Both assessors read the live working tree. The prompt tells them which commit
 * they are judging, and until this existed nothing made that true: on a delayed
 * webhook, or after I had already pushed, they would read newer or uncommitted
 * source, name the requested revision back, and give advice about code that was
 * never reviewed. `claude-core.md` already required this of any dispatched
 * judgement -- "check my working tree matches it when the question is about a
 * tree" -- and the dispatch did not do it. (Codex, #120 round 2.)
 *
 * Refusing is right rather than harsh: the remedy is one checkout or one fresh
 * dispatch for the new head, and both are cheaper than advice about the wrong
 * code.
 */
export function assertCheckout(root, reviewedCommit, { git = defaultGit } = {}) {
  const head = git(["rev-parse", "HEAD"], root);
  if (head.status !== 0) {
    throw new Error(`review-proxy: cannot read HEAD in ${root}: ${String(head.stderr ?? "").trim()}`);
  }
  const at = String(head.stdout ?? "").trim();
  const want = reviewedCommit.trim();
  // The shorter of the two decides: a marker carries a 10-character prefix, a
  // caller may pass 7, and `rev-parse` returns all 40.
  const n = Math.min(at.length, want.length);
  if (at.slice(0, n) !== want.slice(0, n)) {
    throw new Error(
      `review-proxy: the checkout is at ${at.slice(0, 10)} but this assessment is of ${want}. Both assessors read ` +
        `the live tree, so assessing from here would give advice about code the reviewer never saw. Check out the ` +
        `reviewed commit, or dispatch for the current head instead.`,
    );
  }
  const dirty = git(["status", "--porcelain"], root);
  if (dirty.status !== 0) {
    throw new Error(`review-proxy: cannot read the worktree state in ${root}: ${String(dirty.stderr ?? "").trim()}`);
  }
  const changed = String(dirty.stdout ?? "").trim();
  if (changed !== "") {
    throw new Error(
      `review-proxy: the worktree has uncommitted changes, so it is not the revision being assessed:\n${changed}\n` +
        `Commit or stash them, then dispatch.`,
    );
  }
  return at;
}

export function prepareAssessmentPath(root, pr, round, opts) {
  const file = assessmentPath(root, pr, round, opts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  ensureReviewsIgnored(root);
  // A stale assessment must never be read as this dispatch's. A re-dispatch
  // after a crash would otherwise read its predecessor and report it as fresh.
  fs.rmSync(file, { force: true });
  return file;
}

const flatten = (s) => String(s).replace(/\s+/g, " ").trim();

const cap = (s, n) => {
  const flat = flatten(s);
  return flat.length <= n ? flat : `${flat.slice(0, n - 1)}…`;
};

/**
 * Who each assessor is, who the other one is, and who holds the tie-break.
 *
 * ONE BRIEF, TWO READERS, SO THE ROLE-SPECIFIC FACTS ARE THE SCRIPT'S. The
 * brief is deliberately generic -- "the other assessor" throughout -- because
 * both assessors must receive the same words for a difference between their
 * answers to mean a difference of judgement rather than of briefing. But a
 * generic brief cannot tell Fable that the tie-break is *its own*, and the
 * first version of this file shipped Astra's brief to Fable unchanged: it read
 * that it discussed with Fable and that Fable settled ties, which is a role
 * talking to itself about a third party that is also itself. (David,
 * 2026-09-17, on reading what the subagent was actually sent.)
 *
 * So the three facts that genuinely differ are emitted here, per source, and
 * never left for either model to infer.
 */
export const identityBlock = (source) => {
  if (!SOURCES.includes(source)) {
    throw new Error(`review-proxy: source must be one of ${SOURCES.join(", ")}, got ${JSON.stringify(source)}`);
  }
  const astra = source === "astra";
  return [
    "## Who you are in this round",
    "",
    astra
      ? "- **You are Astra**, reached through the Codex CLI in a read-only sandbox."
      : "- **You are the Fable assessor**, a Claude subagent with the checkout to read.",
    astra
      ? "- **The other assessor is the Fable assessor**, a Claude subagent reading this same package separately."
      : "- **The other assessor is Astra**, reached through the Codex CLI, reading this same package separately.",
    "- **Neither of you sees the other's assessment before writing your own.** That is the point: two",
    "  independent readings, not a second opinion formed by reading the first.",
    astra
      ? "- **The tie-break is the Fable assessor's**, not yours: once Claude has investigated the facts and you have had a focused follow-up where one was warranted, a purely technical disagreement that still remains is settled there. You are not obliged to agree with how it is settled."
      : "- **The tie-break is yours**, once Claude has investigated the facts and Astra has had a focused follow-up where one was warranted. Choose, and record why in a short paragraph. Astra is not obliged to agree.",
    "- **Neither of you can settle anything reserved for David**: what the software should do, and whether a",
    "  shortfall he or a user would feel is acceptable. If a disagreement turns out to rest on one of those,",
    "  say so and stop.",
    "",
  ].join("\n");
};

const readBrief = () => `${fs.readFileSync(briefPath(), "utf8").trim()}

---

# The Worth rule

${fs.readFileSync(judgmentPath(), "utf8").replace(/^<!--[\s\S]*?-->\s*/, "").trim()}`;

/**
 * Compose the package both assessors receive.
 *
 * THE BRIEF AND THE WORTH RULE ARE READ VERBATIM FROM THEIR FILES, never
 * assembled here, so the instructions David reviewed are the instructions that
 * run. Everything this function adds is the round's evidence, labelled with who
 * said it.
 *
 * BOTH ASSESSORS GET THE SAME PACKAGE. That is what makes the two readings
 * independent rather than merely separate: a difference between them is a
 * difference of judgement, not of what they were told.
 */
export function assessmentBrief({
  source = "astra",
  pr,
  round,
  tier,
  reviewedCommit,
  oracle,
  findings,
  history = [],
  builderNote = "",
  assessmentFile,
}) {
  assertCoordinates(pr, round);
  if (!TIER_LENSES[tier]) {
    throw new Error(`review-proxy: tier must be one of ${TIERS.join(", ")}, got ${JSON.stringify(tier)}`);
  }
  if (typeof reviewedCommit !== "string" || reviewedCommit.trim() === "") {
    throw new Error("review-proxy: reviewedCommit must be the commit this round reviewed");
  }
  // THE ORACLE IS REQUIRED (David, 2026-09-17): "we should officially agree on
  // an oracle before any round starts". Refusing here is what makes the
  // agreement happen before the loop rather than being noticed after it. The PR
  // body is my own prose and is never the oracle.
  if (typeof oracle !== "string" || oracle.trim() === "") {
    throw new Error(
      "review-proxy: an oracle is required and must be agreed with David before the first round. It is the outcome " +
        "he agreed the work should achieve -- an approved plan, an issue discussion, or an explicit request -- " +
        "recorded where it can be quoted. The PR body is the builder's own prose and is not an oracle.",
    );
  }
  if (!Array.isArray(findings) || findings.length === 0) {
    throw new Error("review-proxy: the assessors are dispatched on a round that RETURNED findings; there are none here");
  }
  const seen = new Set();
  for (const f of findings) {
    // GitHub's review-comment ids are integers and JSON keeps them integers, so
    // the id is coerced rather than demanded as a string. (Codex, #120 round 1.)
    const id = f == null || f.id == null ? "" : String(f.id).trim();
    if (id === "") throw new Error(`review-proxy: every finding needs a stable id, got ${JSON.stringify(f?.id)}`);
    if (seen.has(id)) throw new Error(`review-proxy: finding id ${id} appears twice; ids key the assessment`);
    seen.add(id);
  }

  const lines = [
    readBrief(),
    "",
    "---",
    "",
    identityBlock(source),
    "# This round",
    "",
    ...TIER_LENSES[tier],
    "",
    `- **Reviewed commit:** \`${reviewedCommit}\` — the revision you are assessing. The checkout you are reading ` +
      "is at this commit and is clean; the dispatch refuses otherwise.",
    `- **Repository root:** the working directory you were started in.`,
    assessmentFile ? `- **Write your assessment to:** \`${assessmentFile}\`` : null,
    "",
    "## [oracle] The outcome this work is meant to achieve",
    "",
    "Agreed with David before this loop started. Authority over intended behaviour, scope and acceptance.",
    "",
    oracle.trim(),
    "",
  ].filter((l) => l !== null);

  if (history.length) {
    lines.push("## What has happened so far, labelled by who said it", "");
    for (const entry of history) {
      if (!entry || !LABELS.includes(entry.label)) {
        throw new Error(`review-proxy: every history entry carries a label from ${LABELS.join(", ")}, got ${JSON.stringify(entry?.label)}`);
      }
      lines.push(`- **[${entry.label}]** ${flatten(entry.text)}`);
    }
    lines.push("");
  }

  lines.push("## [reviewer] This round's findings", "", "Cover every one, using these IDs exactly.", "");
  for (const f of findings) {
    lines.push(`### Finding \`${String(f.id).trim()}\``, "");
    if (f.path) lines.push(`- Location: \`${f.path}\`${f.line ? `:${f.line}` : ""}`);
    lines.push("", String(f.body ?? "").trim(), "");
  }

  lines.push(
    "## [builder] Where the builder says it is",
    "",
    builderNote.trim() ? cap(builderNote, MAX_NOTE_CHARS) : "(the builder supplied no note)",
    "",
    "A claim to evaluate, never authority.",
    "",
  );

  return lines.join("\n");
}

/**
 * Compose a focused follow-up.
 *
 * THIS RUNS ON THE SAME REVISION, WITH NO NEW COMMIT AND NO NEW CODEX ROUND.
 * That is the property the design turns on: a disagreement about reasoning
 * should cost one question, not a round trip through the whole loop.
 *
 * IT IS NARROW BY CONSTRUCTION. The earlier assessment is quoted so nothing has
 * to be remembered, and the brief says plainly that everything not asked about
 * keeps its earlier status -- including unresolved questions and decisions
 * waiting on David. A follow-up that silently cleared them would be worse than
 * no follow-up, because it would look like agreement.
 */
export function followUpBrief({
  source = "astra",
  pr,
  round,
  tier,
  reviewedCommit,
  oracle,
  findings,
  findingIds,
  question,
  fableReasoning,
  newEvidence = [],
  priorAssessment,
  assessmentFile,
}) {
  assertCoordinates(pr, round);
  for (const [name, value] of [["question", question], ["priorAssessment", priorAssessment]]) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`review-proxy: a follow-up needs ${name}; got ${JSON.stringify(value)}`);
    }
  }
  // THE FOLLOW-UP CARRIES THE ORACLE AND THE FINDING BODIES, because the
  // process answering it remembers nothing. `codex exec --ephemeral` starts
  // cold, and the prior assessment cannot stand in for the package: the brief
  // tells its author NOT to restate the pull request, the revision or the
  // finding list, so the one document being quoted back is the one guaranteed
  // to omit them. Without this, a follow-up could revise a recommendation
  // without the agreed intent it exists to preserve. (Codex, #120 round 3.)
  if (typeof oracle !== "string" || oracle.trim() === "") {
    throw new Error(
      "review-proxy: a follow-up carries the same oracle as the assessment it revisits; the process answering it " +
        "is ephemeral and the prior assessment is told not to restate metadata, so omitting it asks for a revision " +
        "against no agreed intent",
    );
  }
  if (!TIER_LENSES[tier]) {
    throw new Error(`review-proxy: tier must be one of ${TIERS.join(", ")}, got ${JSON.stringify(tier)}`);
  }
  if (!Array.isArray(findingIds) || findingIds.length === 0) {
    throw new Error("review-proxy: a follow-up names the finding IDs in dispute; there are none here");
  }
  const lines = [
    readBrief(),
    "",
    "---",
    "",
    identityBlock(source),
    "# A focused follow-up",
    "",
    "This is not a new assessment. Answer the question below directly: what the new evidence establishes, whether",
    "your recommendation changes, and what remains unresolved. **Everything you are not asked about keeps the status",
    "it already has**, including unresolved questions and decisions waiting on David. Do not repeat the assessment.",
    "",
    `- **Reviewed commit:** \`${reviewedCommit}\` — unchanged since your assessment; no new code has been written.`,
    `- **Findings in dispute:** ${findingIds.map((id) => `\`${String(id).trim()}\``).join(", ")}`,
    assessmentFile ? `- **Write your answer to:** \`${assessmentFile}\`` : null,
    "",
    ...TIER_LENSES[tier],
    "",
    "## [oracle] The outcome this work is meant to achieve",
    "",
    "The same oracle as your assessment, carried here because this process starts cold.",
    "",
    oracle.trim(),
    "",
    "## The question",
    "",
    question.trim(),
    "",
  ].filter((l) => l !== null);

  if (Array.isArray(findings) && findings.length) {
    lines.push("## [reviewer] The findings in dispute, in full", "");
    const wanted = new Set(findingIds.map((id) => String(id).trim()));
    for (const f of findings) {
      if (!wanted.has(String(f?.id ?? "").trim())) continue;
      lines.push(`### Finding \`${String(f.id).trim()}\``, "");
      if (f.path) lines.push(`- Location: \`${f.path}\`${f.line == null ? "" : `:${f.line}`}`, "");
      lines.push(String(f.body ?? "").trim(), "");
    }
  }

  if (fableReasoning && fableReasoning.trim()) {
    lines.push(`## [${source === "astra" ? "fable" : "astra"}] The other assessor's reasoning`, "", fableReasoning.trim(), "");
  }
  if (newEvidence.length) {
    lines.push("## New evidence, with its provenance", "");
    for (const e of newEvidence) lines.push(`- **[${e.source ?? "builder"}]** ${flatten(e.text ?? e)}`);
    lines.push("");
  }
  lines.push(`## [${source}] Your earlier assessment of this round, quoted`, "", priorAssessment.trim(), "");
  return lines.join("\n");
}

/**
 * Read an assessment.
 *
 * ALL THAT IS CHECKED IS THAT SOMETHING SUBSTANTIVE ARRIVED. There is no schema
 * any more, so there is nothing to validate against; prose is judged by reading
 * it. What still matters is that a missing or empty file is reported as a
 * FAILED dispatch in plain words, never as a quiet round -- the lesson from
 * #109, where a failed read rendered as "nothing to report".
 */
export function readAssessment(root, pr, round, opts = {}) {
  const file = assessmentPath(root, pr, round, opts);
  const failed = (reason) => ({ pr, round, source: opts.source, failed: true, reason });
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    return failed(`${opts.source} wrote no assessment file (${err.code === "ENOENT" ? "not found" : err.code})`);
  }
  if (raw.trim() === "") return failed(`${opts.source} wrote an empty assessment file`);
  return { pr, round, source: opts.source, followUp: opts.followUp ?? 0, markdown: raw.trim() };
}

const SOURCE_NAMES = { astra: "Astra", fable: "Fable" };

/**
 * The comment posted on the pull request.
 *
 * THE ASSESSMENT IS PASSED THROUGH VERBATIM. I do not summarise it, reorder it,
 * or drop the part I disagree with; my own view goes in my own comment, beside
 * it. The only thing this adds is the header, and the header is deliberately
 * the metadata the harness already owns -- pull request, revision, which
 * assessment, which findings -- because asking a model to restate facts nobody
 * was missing spends the reader's attention for nothing.
 */
export function prComment(result, { reviewedCommit = null, findingIds = [], model = null } = {}) {
  const who = SOURCE_NAMES[result.source] ?? result.source;
  const what = result.followUp ? `round ${result.round}, follow-up ${result.followUp}` : `round ${result.round}`;
  if (result.failed) {
    return [
      `## ${who} — ${what}: **dispatch failed**`,
      "",
      `No independent assessment from ${who} exists for this round: ${result.reason}.`,
      "",
      "This is a failure of the dispatch, not a report that the round was quiet, and it is not permission to",
      "proceed on one assessment alone.",
    ].join("\n");
  }
  const header = [`## ${who} — ${what}`, ""];
  const facts = [];
  if (reviewedCommit) facts.push(`Assessed at \`${reviewedCommit}\``);
  if (findingIds.length) facts.push(`findings ${findingIds.map((id) => `\`${String(id).trim()}\``).join(", ")}`);
  if (model) facts.push(`${model}`);
  if (facts.length) header.push(`*${facts.join(" · ")}*`, "");
  return [...header, result.markdown].join("\n");
}

/**
 * The next action, stated by me.
 *
 * NOTHING PARSES AN ASSESSMENT TO GET HERE. The oracle is explicit that the
 * harness acts on my explicit selection and never on a phrase inferred from an
 * assessment, and that agent agreement does not substitute for David's
 * approval. This renders that selection as a block a reader can find, in the
 * shape `plan-provenance` already uses in a PR body.
 */
export function actionBlock({ action, findingIds = [], note = "" }) {
  if (!ACTIONS.includes(action)) {
    throw new Error(`review-proxy: action must be one of ${ACTIONS.join(", ")}, got ${JSON.stringify(action)}`);
  }
  const lines = ["```review-action", `action: ${action}`];
  if (findingIds.length) lines.push(`findings: ${findingIds.map((id) => String(id).trim()).join(", ")}`);
  if (note.trim()) lines.push(`note: ${flatten(note)}`);
  lines.push("```");
  return lines.join("\n");
}

/**
 * Run Astra. The assessment is read from the file, never from this return
 * value and never from the transcript.
 */
export function dispatch({
  root,
  pr,
  round,
  prompt,
  reviewedCommit,
  followUp = 0,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  run = spawnSyncDefault,
  git = defaultGit,
  io = undefined,
}) {
  assertCheckout(root, reviewedCommit, { git });
  const status = signInStatus({ run });
  if (!status.signedIn) {
    return { ok: false, signIn: true, reason: status.missingBinary ? "no codex binary" : status.detail, instructions: SIGN_IN_INSTRUCTIONS };
  }
  const reviewer = modelTier("strongestCodex", io);
  const outFile = prepareAssessmentPath(root, pr, round, { source: "astra", followUp });
  const outcome = runCodex({
    prompt,
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
  "review-proxy — independent technical advice on one code-review round.",
  "",
  "  Assessment:",
  "    node core/scripts/review-proxy.mjs --pr <n> --round <n> --commit <sha> --tier <t> \\",
  "        --oracle-file <path> --findings-file <path.json> [--history-file <path.json>] [--note <text>]",
  "",
  "  Focused follow-up (same revision, no new commit, no new Codex round):",
  "    node core/scripts/review-proxy.mjs --pr <n> --round <n> --commit <sha> --tier <t> --follow-up <n> \\",
  "        --question <text> --findings <id,id> --prior-file <path> --oracle-file <path> \\",
  "        [--findings-file <path.json>] [--fable-file <path>]",
  "                  A follow-up carries the oracle, the tier and the disputed findings' bodies:",
  "                  the process answering it is ephemeral and remembers nothing.",
  "",
  `  --tier          one of ${TIERS.join(", ")} — what is downstream, not a threshold`,
  "  --oracle-file   the outcome David agreed BEFORE this loop started. Required; there is no default.",
  "  --findings-file JSON array of { id, body, path?, line? } — this round's findings.",
  "  --history-file  JSON array of { label, text } — labels: " + LABELS.join(", "),
  "  --note          the builder's 'where we are', capped at " + MAX_NOTE_CHARS + " characters.",
  `  --source        ${SOURCES.join(" | ")} (default astra). Selects the identity block and the output path.`,
  "  --prompt-only   print the package and run nothing — how the Fable subagent is given the same words.",
  "",
  `  Astra is pinned to the strongestCodex tier in the ${SANDBOX} sandbox, with no override, and the`,
  "  dispatch refuses unless the checkout is at --commit and clean. The Fable assessment is a subagent",
  "  dispatched by the builder, not by this script; both read the package this script composes, which",
  "  differs only in the identity block — so `--source fable` is only meaningful with `--prompt-only`.",
].join("\n");

const FLAGS = {
  pr: "pr",
  round: "round",
  commit: "commit",
  tier: "tier",
  "oracle-file": "oracleFile",
  "findings-file": "findingsFile",
  "history-file": "historyFile",
  note: "note",
  "follow-up": "followUp",
  question: "question",
  findings: "findings",
  "prior-file": "priorFile",
  "fable-file": "fableFile",
  "prompt-only": "promptOnly",
  source: "source",
};

const NUMERIC = new Set(["pr", "round", "followUp"]);
const BOOLEAN = new Set(["promptOnly"]);

export function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`review-proxy: unexpected argument ${JSON.stringify(arg)}`);
    const key = FLAGS[arg.slice(2)];
    if (!key) throw new Error(`review-proxy: unknown flag ${arg}`);
    if (BOOLEAN.has(key)) {
      flags[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`review-proxy: ${arg} needs a value`);
    flags[key] = NUMERIC.has(key) ? Number(value) : value;
    i += 1;
  }
  return flags;
}

export function main(argv = process.argv.slice(2), { root = process.cwd(), run = spawnSyncDefault, git = defaultGit, log = console.error } = {}) {
  let flags;
  try {
    flags = parseArgs(argv);
  } catch (err) {
    log(`${err.message}\n\n${USAGE}`);
    return 2;
  }
  const followUp = flags.followUp ?? 0;
  // THE SOURCE PICKS BOTH THE IDENTITY BLOCK AND THE OUTPUT PATH, and it has to
  // pick both or neither: a Fable package naming Astra's file would have the
  // subagent overwrite the answer this script is about to read. Only `--source
  // fable --prompt-only` is meaningful, because this script runs the Codex CLI
  // and nothing else -- the subagent is dispatched by the harness.
  const source = flags.source ?? "astra";
  if (source !== "astra" && !flags.promptOnly) {
    log(`review-proxy: --source ${source} composes a package for an assessor this script does not run; use --prompt-only\n\n${USAGE}`);
    return 2;
  }
  let prompt;
  // THE IDS ARE KEPT, NOT RE-DERIVED. They are parsed here to compose the
  // package and used again to stamp the rendered comment's header, so a reader
  // can see which findings the prose covers -- which matters most exactly when
  // there are several assessments and follow-ups on one pull request. They used
  // to be parsed and dropped one block later. (Codex, #120 round 3.)
  let findingIds = [];
  try {
    const file = assessmentPath(root, flags.pr, flags.round, { source, followUp });
    if (followUp) {
      findingIds = String(flags.findings ?? "").split(",").map((t) => t.trim()).filter(Boolean);
      prompt = followUpBrief({
        source,
        pr: flags.pr,
        round: flags.round,
        tier: flags.tier,
        reviewedCommit: flags.commit,
        oracle: fs.readFileSync(flags.oracleFile, "utf8"),
        findings: flags.findingsFile ? JSON.parse(fs.readFileSync(flags.findingsFile, "utf8")) : [],
        findingIds,
        question: flags.question,
        fableReasoning: flags.fableFile ? fs.readFileSync(flags.fableFile, "utf8") : "",
        priorAssessment: fs.readFileSync(flags.priorFile, "utf8"),
        assessmentFile: file,
      });
    } else {
      const findings = JSON.parse(fs.readFileSync(flags.findingsFile, "utf8"));
      findingIds = Array.isArray(findings) ? findings.map((f) => f?.id).filter((id) => id != null) : [];
      prompt = assessmentBrief({
        source,
        pr: flags.pr,
        round: flags.round,
        tier: flags.tier,
        reviewedCommit: flags.commit,
        oracle: fs.readFileSync(flags.oracleFile, "utf8"),
        findings,
        history: flags.historyFile ? JSON.parse(fs.readFileSync(flags.historyFile, "utf8")) : [],
        builderNote: flags.note ?? "",
        assessmentFile: file,
      });
    }
  } catch (err) {
    log(`${err.message}\n\n${USAGE}`);
    return 2;
  }
  // `--prompt-only` writes the package the Fable assessor gets, so both
  // assessors demonstrably receive the same words rather than two compositions
  // that happen to look alike.
  //
  // IT DOES THE SAME TWO THINGS `dispatch` DOES BEFORE STARTING A REVIEWER, and
  // for the same reasons. The branch used to do neither, because it "only
  // prints", which reads as harmless and is not:
  //
  //   - It CLEARS the destination. Otherwise a retried Fable dispatch whose
  //     subagent dies before writing leaves the previous attempt's file in
  //     place, and `readAssessment` accepts any non-empty file there. The worst
  //     instance is not a retry of the same package but a re-dispatch with a
  //     CORRECTED one -- a missed finding, a wrong oracle -- after which the
  //     stale file is posted under a header naming the right round and commit,
  //     with nothing to give it away. (Codex #120 round 4; both assessors
  //     concurred, and the Astra path has carried this since round 2.)
  //   - It VERIFIES THE CHECKOUT. The package it prints tells its reader the
  //     tree "is at this commit and is clean; the dispatch refuses otherwise".
  //     Emitting that sentence without checking is the one shape this
  //     repository's archive names as the worst available failure: a control
  //     reporting success having evaluated nothing. In the ordinary flow
  //     Astra's own refusal covers both, but a Fable-only re-dispatch never
  //     reaches it. (Codex #120 round 3.)
  if (flags.promptOnly) {
    // Reported in plain words and exit 2, the way every other refusal in this
    // CLI is. A raw stack trace here would be the operator's first sight of a
    // guard that is working correctly.
    try {
      assertCheckout(root, flags.commit, { git });
      prepareAssessmentPath(root, flags.pr, flags.round, { source, followUp });
    } catch (err) {
      log(`review-proxy: ${err.message}`);
      return 2;
    }
    process.stdout.write(`${prompt}\n`);
    return 0;
  }
  let result;
  try {
    result = dispatch({ root, pr: flags.pr, round: flags.round, prompt, reviewedCommit: flags.commit, followUp, run, git });
  } catch (err) {
    log(`review-proxy: ${err.message}`);
    return 2;
  }
  if (result.signIn) {
    log(`review-proxy: ${result.instructions}`);
    return 2;
  }
  log(`review-proxy: ${followUp ? `follow-up ${followUp} on ` : ""}round ${flags.round} on ${result.reviewer.id} (${result.reviewer.effort}, ${SANDBOX}) — ${result.seconds}s`);
  // A FAILED PROCESS IS NEVER AN ACCEPTED ASSESSMENT, even when a file is
  // sitting there: `codex exec` can write its last message and then exit
  // non-zero. (Codex, #120 round 1.)
  const read = result.ok
    ? readAssessment(root, flags.pr, flags.round, { source: "astra", followUp })
    : {
        pr: flags.pr,
        round: flags.round,
        source: "astra",
        failed: true,
        reason: `the reviewer process exited ${result.status ?? "(no status)"}${result.signal ? ` on signal ${result.signal}` : ""}`,
      };
  process.stdout.write(
    `${prComment(read, { reviewedCommit: flags.commit, findingIds, model: result.reviewer.id })}\n`,
  );
  return read.failed ? 1 : 0;
}

// `pathToFileURL`, never a hand-built `file://` string: the two differ whenever
// the checkout path needs escaping, and a script that never runs exits 0.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
