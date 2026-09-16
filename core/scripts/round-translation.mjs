#!/usr/bin/env node
// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
/**
 * David's reading surface for D0: a message in chat. That is the whole surface.
 *
 * THERE IS NO PAGE, AND REMOVING IT WAS THE POINT (David, 2026-09-16, on #109
 * round 3). This module used to render an HTML page, write it to a gitignored
 * path, and hand back a relative filename -- so the "delivery" was a file
 * nobody could open, and the contract's "page link posted on the PR" described
 * a link that never existed. Three of that round's four findings were the
 * inside of that hole: no receipt producer, no deploy step, no synchronisation.
 * David's ruling, verbatim in substance: he lives in the chat, a page is
 * something he would have to go and copy-paste into a browser, and building a
 * delivery system for what is fundamentally one agent telling him the answer
 * would be undoing the #89 cut by hand. So: `chatReport` and nothing else.
 *
 * WHAT SURVIVES IS THE ONE PROPERTY WORTH MACHINERY. The builder does not
 * write the translation, does not summarise it, and does not decide what the
 * chat message says. `chatReport` composes it from the validated answer's own
 * fields, verbatim, and I paste that. A builder-written summary of an
 * independent account is just the builder's account again, which is the thing
 * D0 exists to stop being the only one. That is why the report is a function
 * rather than an instruction to me to "explain the round".
 *
 * THREE FACTS, NOT A LEDGER. The verdict line reads exactly three things off
 * the answer: were there disagreements, how many, and was anything left
 * unassessed. There is no per-finding reconciliation and nothing refuses a
 * translation that skipped a finding -- the reader is a human reading prose,
 * and a paragraph missing a finding is a paragraph missing a finding (David,
 * 2026-09-12).
 *
 * The one rule the verdict obeys: **"agrees" is never printed over an
 * unassessed item, or over a round the builder has not answered.**
 * Could-not-observe is not the favourable answer, and neither is
 * nobody-said-anything-yet.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { modelTier, validate, assertSchemaSupported, repoSlug } from "./machinery.mjs";

export const REVIEWS_DIR = ".agents/reviews";

/** Where the translator writes its answer. Derived, never supplied. */
export const answerPath = (root, pr, round) =>
  path.join(root, REVIEWS_DIR, `pr-${pr}`, `round-${round}.answer.json`);

/**
 * The role's agent type, and the schema its answer must satisfy.
 *
 * RESOLVED FROM THIS MODULE, NOT FROM A CALLER'S ROOT. The answer file lives in
 * the repository being reviewed; the schema is payload and lives beside this
 * script. Those are different roots, and conflating them broke the moment a
 * test passed a temporary directory -- it would have broken identically in a
 * consumer, where this file sits at `scripts/` rather than `core/scripts/`.
 */
export const ROLE = "fable-round-translation";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const schemaPath = () =>
  path.resolve(SCRIPT_DIR, "..", ".agents", "fable-roles", "schemas", `${ROLE}.schema.json`);

/**
 * Keep the answer directory ignored, because an answer file must never be
 * committed -- it is a session artifact, and the role that writes it reads
 * every comment on the pull request.
 */
export function ensureReviewsIgnored(root) {
  const dir = path.join(root, REVIEWS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(dir, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n");
  return ignore;
}

/**
 * The dispatch model, as a full id and as the name the Agent tool takes.
 *
 * `effort` is returned and deliberately NOT applied: the Agent tool takes a
 * model name and no reasoning-effort argument, so the configured value has no
 * route to this dispatch. Returning it lets a caller say so out loud rather
 * than leaving a dial in the config that turns nothing.
 */
export function dispatchModel(io = undefined) {
  const entry = modelTier("strongestClaude", io);
  const id = typeof entry === "string" ? entry : entry?.id;
  const effort = typeof entry === "object" ? (entry?.effort ?? null) : null;
  const m = typeof id === "string" ? /^claude-(fable|opus|sonnet|haiku)\b/.exec(id) : null;
  if (!m) {
    throw new Error(
      `.agents/machinery.json's models.strongestClaude.id is ${JSON.stringify(id)}, which is not a Claude model, ` +
        `so it cannot be dispatched as a subagent. The Agent tool takes one of fable, opus, sonnet, haiku.`,
    );
  }
  return { id, agentModel: m[1], effort, effortApplied: false };
}

/**
 * The round's coordinates. NOT the brief -- the harness supplies that.
 *
 * `repo` and the answer path are DERIVED rather than accepted: a mistyped
 * owner/name would send the translator to a different pull request, and a
 * mistyped answer path would mean a valid answer written where `readAnswer`
 * never looks -- reported as a failed round, the failure state hiding a
 * success. That is the `derivable` arm of the Worth test, which says remove
 * the input.
 */
export function roundBrief({
  root,
  pr,
  round,
  head,
  previousHead = null,
  since = null,
  until = null,
  finalRound = false,
  priorAccounts = [],
  io = undefined,
}) {
  const repo = repoSlug(io);
  const answerFile = answerPath(root, pr, round);
  const lines = [
    "## This round",
    "",
    `- **Repository:** \`${repo}\``,
    `- **Pull request:** #${pr}`,
    `- **Round:** ${round}`,
    `- **Head:** \`${head}\` — the last commit this round reviewed.`,
    // COMMITS BY ANCESTRY, NEVER BY CLOCK. This used to be a `since` timestamp
    // on `list_commits`, which was wrong in both directions: with no lower
    // bound it walked the branch's entire ancestry and asked for every
    // historical full patch, and with one it filtered on AUTHOR DATE -- so a
    // cherry-pick or a rebase-and-push during a round carried an older date
    // and was silently dropped from the account. The contract meanwhile
    // claimed commits were "selected by commit identity", which the protocol
    // did not do. A previous-head coordinate is that claim made true, and it
    // bounds the first round by the pull request rather than by history.
    // (Codex, #109 round 3.)
    previousHead
      ? `- **Previous head:** \`${previousHead}\` — this round's commits are the ones AFTER this in the pull request's own ordered commit list, up to and including the head. Ancestry, not timestamps.`
      : `- **Previous head:** none — this is the first round translated, so this round's commits are every commit on the pull request, up to the head. Still bounded by the pull request, never by the branch's history.`,
    // TIMESTAMPS BOUND REVIEW ACTIVITY ONLY, and at both ends. The comment
    // reads are live and this dispatch runs detached by design, so a slow
    // round-N translation could read round N+1's findings and replies while
    // its commits stayed pinned to N's range -- an account of a round that
    // never existed, filed under N's number and indistinguishable from a
    // correct one. `until` is captured when the dispatch is made.
    since
      ? `- **Review activity, from:** \`${since}\` — comments, reviews and replies after this timestamp are this round's.`
      : `- **Review activity, from:** the start of the pull request — this is the first round translated on it.`,
    until
      ? `- **Review activity, until:** \`${until}\` — IGNORE every comment, review and reply after this timestamp. They belong to a later round, and this dispatch runs detached, so later activity may well have landed while you were reading.`
      : `- **Review activity, until:** none supplied — if you find activity that plainly belongs to a later round, say so in \`could_not_assess\` rather than folding it into this one.`,
    `- **Final round:** ${finalRound ? "YES — also return `known_gaps` and `what_landed`." : "no — omit `known_gaps` and `what_landed`."}`,
    `- **Write your answer to:** \`${answerFile}\``,
  ];
  // QUOTED INLINE, NOT NAMED AS FILES. These used to be passed as local paths
  // to a role holding no `Read` tool -- the final round was told to use files
  // it could not open. A narrow read grant is not available either: a path
  // specifier in an agent's `tools:` list is not honoured. Quoting costs
  // nothing, because this is the role's OWN earlier prose handed back to it,
  // and it is told in the same breath to treat it as navigation.
  if (finalRound && priorAccounts.length) {
    lines.push("", "## Earlier accounts of this pull request, for navigation only", "");
    lines.push(
      "These are your own earlier rounds, quoted. They tell you where to look. Check the current threads and the code before repeating any of it — an earlier account can be wrong, and repeating it would launder the error into the round David reads most carefully.",
      "",
    );
    for (const a of priorAccounts) {
      lines.push(`### Round ${a.round}`, "", a.summary_for_david ?? "", "", a.what_happened ?? "", "");
    }
  }
  lines.push("", "Write the JSON object to that path and nothing else to it.", "");
  return lines.join("\n");
}

/**
 * Validate an answer against the shipped schema.
 *
 * CONTEXTUAL IN BOTH DIRECTIONS: the final round must carry `known_gaps` and
 * `what_landed`, and an ordinary round must not. An optional field nothing
 * enforces is the defect this machinery keeps paying for.
 *
 * Returns the problems rather than throwing. D0 is off the critical path and a
 * broken translation must never be able to stop a review loop.
 */
export function validateAnswer(answer, { finalRound = false } = {}) {
  const schema = JSON.parse(fs.readFileSync(schemaPath(), "utf8"));
  assertSchemaSupported(schema, ROLE);
  const problems = validate(answer, schema, ROLE);
  const has = (k) => answer && typeof answer === "object" && Object.prototype.hasOwnProperty.call(answer, k);
  for (const k of ["known_gaps", "what_landed"]) {
    if (finalRound && !has(k)) problems.push(`${ROLE}: the final round must return "${k}"`);
    if (!finalRound && has(k)) problems.push(`${ROLE}: "${k}" belongs to the final round only`);
  }
  return problems;
}

/**
 * Read what the translator wrote, and say plainly when there is nothing usable.
 *
 * Three failures, one shape: no file, unparseable file, schema-invalid answer.
 * Each returns `{ ok: false, why }` and each becomes a FAILED round -- visibly
 * a failure, never the favourable "nothing to report" case.
 */
export function readAnswer(root, pr, round, { finalRound = false } = {}) {
  const file = answerPath(root, pr, round);
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    return { ok: false, why: `the translator wrote no answer file (${err.code === "ENOENT" ? "not found" : err.code})` };
  }
  let answer;
  try {
    answer = JSON.parse(raw);
  } catch (err) {
    return { ok: false, why: `the answer file is not valid JSON: ${err.message}` };
  }
  const problems = validateAnswer(answer, { finalRound });
  if (problems.length) return { ok: false, why: `the answer did not match the expected shape: ${problems.join("; ")}` };
  return { ok: true, answer };
}

/**
 * The three facts, off one round.
 *
 * A failed round is checked FIRST and is its own state. A round whose answer
 * never arrived or did not parse is not a quiet round: reporting it as one
 * would turn a failure into a clean bill of health, which is the exact thing
 * the "agrees" rule exists to prevent.
 */
export function facts(round) {
  if (round.failed) {
    return { failed: true, skipped: false, reason: round.reason ?? "the translation could not be produced" };
  }
  if (round.skipped) return { skipped: true, failed: false, reason: round.reason ?? "not dispatched" };
  const out = round.answer ?? {};
  return {
    skipped: false,
    failed: false,
    disagreements: Array.isArray(out.disagreements) ? out.disagreements.length : 0,
    unassessed: typeof out.could_not_assess === "string" && out.could_not_assess.trim() !== "",
    // WHETHER THERE IS A BUILDER ACCOUNT AT ALL, read from the translator's own
    // observation. It permits a round nobody has replied to -- translating one
    // is legitimate and reads as a round awaiting a response. What is not
    // legitimate is printing "agrees with the builder's account" over it, which
    // is what the fall-through did: a clean translation of an unanswered round
    // has no disagreements and nothing unassessed, so it landed on the
    // favourable line while there was no account to agree with. Round 5 of
    // AI-Handbook #81 was exactly that round.
    //
    // `=== true`, so an absent or malformed value reads as UNANSWERED. Of the
    // two possible wrong accounts, the false favourable is the one that must
    // never print.
    answered: out.builder_answered === true,
  };
}

/** The verdict, in one line. The headline of the chat report. */
export function chatLine(round) {
  const f = facts(round);
  const r = `round ${round.round}`;
  if (f.failed) return `${r}: translation failed — ${f.reason}`;
  if (f.skipped) return `${r}: skipped — ${f.reason}`;
  if (f.disagreements > 0) return `${r}: differs on ${f.disagreements} point${f.disagreements === 1 ? "" : "s"}`;
  if (f.unassessed) return `${r}: partial — something could not be assessed`;
  // LAST BEFORE "agrees", AND ONLY THERE, because "agrees" is the only shape
  // that asserts a builder account exists.
  if (!f.answered) return `${r}: no builder account yet — the round was unanswered when this was read`;
  return `${r}: agrees with the builder's account`;
}

/**
 * THE DELIVERABLE. What I paste into chat, and the only thing I say about the
 * round.
 *
 * Composed from the answer's own fields, in the answer's own words. I do not
 * summarise it, reorder its argument, or drop a section I disagree with --
 * which is the whole reason this is a function and not a note telling me to
 * explain the round. The only text here that is not the translator's is the
 * labels.
 *
 * `model` prints only when it is worth a reader's attention: a mismatch
 * against the model asked for, or an answer that could not name its own model.
 * A line on every round saying the model was the right one trains a reader to
 * skip the place the real notice would appear.
 */
export function chatReport(round, { askedModel = null } = {}) {
  const f = facts(round);
  const out = [`**D0 — ${chatLine(round)}**`, ""];

  if (f.failed || f.skipped) {
    out.push(
      f.failed
        ? `No independent account of this round exists. The translator was dispatched and produced nothing usable — ${f.reason}. This is a failure of the translation, not a report that the round was quiet: there may well have been findings, and nobody has explained them here.`
        : `The translator was not dispatched for this round — ${f.reason}.`,
    );
    return out.join("\n");
  }

  const a = round.answer ?? {};
  out.push(a.summary_for_david ?? "", "", "**What happened**", "", a.what_happened ?? "");

  if (Array.isArray(a.disagreements) && a.disagreements.length) {
    out.push("", `**Where it disagrees with the builder** (${a.disagreements.length})`, "");
    for (const d of a.disagreements) out.push(`- **${d.what}** — ${d.why_it_matters}`);
  }

  if (Array.isArray(a.known_gaps) && a.known_gaps.length) {
    out.push("", "**Shipping unfixed**", "");
    for (const g of a.known_gaps) {
      out.push(`- ${g.reasonable ? "Reasonable" : "**Not reasonable**"}: ${g.what} — ${g.why}`);
    }
  }

  if (a.what_landed) {
    out.push(
      "",
      "**What actually landed**",
      "",
      a.what_landed.landed,
      "",
      `*Does not do:* ${a.what_landed.does_not_do}`,
      "",
      `*You are now trusting:* ${a.what_landed.now_trusting}`,
    );
  }

  if (a.took_on_trust) out.push("", `*Taken on trust, not checked:* ${a.took_on_trust}`);
  if (f.unassessed) out.push("", `*Could not assess:* ${a.could_not_assess}`);

  const got = a.model ?? null;
  if (!got) out.push("", `*This round did not report which model wrote it${askedModel ? `; ${askedModel} was asked for` : ""}.*`);
  else if (askedModel && got.trim() !== askedModel.trim()) {
    out.push("", `*Written by ${got}, not the ${askedModel} that was asked for — the dispatch cannot enforce the model, only report what answered.*`);
  }

  out.push("", `**${a.recommendation}**`);
  return out.join("\n");
}
