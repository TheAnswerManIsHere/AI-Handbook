#!/usr/bin/env node
// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
/**
 * David's reading surface for D0: one page per pull request, and one line of
 * chat per round.
 *
 * BOTH ARE DERIVED, AND THAT IS THE POINT. The builder does not write the
 * translation, does not summarise it, and does not decide what the chat line
 * says -- it renders this file's output and pastes the line verbatim. A
 * builder-written summary of an independent account is just the builder's
 * account again, which is the thing D0 exists to stop being the only one.
 *
 * THREE FACTS, NOT A LEDGER. The page and the line read exactly three things
 * off each receipt: were there disagreements, how many, and was anything left
 * unassessed. There is no per-finding reconciliation and nothing refuses a
 * translation that skipped a finding -- the reader is a human reading prose,
 * and a paragraph missing a finding is a paragraph missing a finding (David,
 * 2026-09-12).
 *
 * The one rule the line obeys: **"agrees" is never printed over an
 * unassessed item, or over a round the builder has not answered.**
 * Could-not-observe is not the favourable answer, and neither is
 * nobody-said-anything-yet -- the same rule every receipt field in this
 * machinery already follows.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { modelTier, validate, assertSchemaSupported, repoSlug } from "./machinery.mjs";

/** Where the page goes. Derived, never supplied — same rule as the receipt path. */
export const REVIEWS_DIR = ".agents/reviews";
export const pagePath = (root, pr) => path.join(root, REVIEWS_DIR, `pr-${pr}`, "translation.html");

// ---------------------------------------------------------------------------
// Dispatching the round, and reading back what the translator wrote
// ---------------------------------------------------------------------------
/**
 * WHY THERE IS NO DISPATCHER HERE. `fable-dispatch.mjs` was 1,450 lines, and
 * roughly 1,300 of them defended against the builder tampering with the second
 * Claude. David's 2026-09-11 rule retires that whole class -- "I run every
 * script in this machinery, so a defence against my editing its inputs is a
 * lock whose key is on the same ring."
 *
 * WHAT REPLACED IT. The role is a real agent definition at
 * `core/.claude/agents/fable-round-translation.md`, symlinked into
 * `.claude/agents/`, and the HARNESS loads it -- so the brief is no longer
 * something this file reads and pastes. That deleted the one function that used
 * to do it. What is left here is the part the harness cannot know: which round,
 * which commits, where to write the answer.
 *
 * MEASURED, because the last attempt asserted this instead (PR #109 round 1):
 * a `tools:` frontmatter list is enforced as a hard upper bound. An agent
 * declaring `Read, Grep, Glob, Bash` holds exactly those plus the injected
 * `SubagentHandback` -- no `Write`, no MCP, and no `ToolSearch`, which is why
 * `ToolSearch` is on this role's list explicitly: without it the deferred
 * GitHub tools cannot be loaded at all.
 *
 * NOT MEASURED, and stated rather than assumed: whether a per-method MCP name
 * (`mcp__github__pull_request_read`) resolves in that list the way a plain tool
 * name does. The agent type is not loadable in the session that adds it -- the
 * harness enumerates types at session start -- so the first dispatch in a later
 * session is what establishes it.
 *
 * THE ANSWER COMES BACK IN A FILE, not from the dispatch. The harness pairs an
 * Agent call with a launch notice rather than the answer; the answer is
 * recoverable from the subagent transcript, but its location there has moved
 * three times in a month and the payload's own memory note about it was wrong.
 * So the role writes its answer to a path this module derives, and this module
 * reads that path. A missing or unparseable file is a FAILED round, which is a
 * state the page renders -- never a skipped one, and never a silent absence.
 */

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
 * `../.agents/...` is correct in both layouts, which is why it is relative to
 * this file rather than to a repository root.
 */
export const ROLE = "fable-round-translation";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const schemaPath = () =>
  path.resolve(SCRIPT_DIR, "..", ".agents", "fable-roles", "schemas", `${ROLE}.schema.json`);

/**
 * The dispatch model, as a full id and as the name the Agent tool takes.
 *
 * `effort` is returned and deliberately NOT applied: the Agent tool takes a
 * model name and no reasoning-effort argument, so the configured value has no
 * route to this dispatch. Returning it lets a caller say so out loud rather
 * than leaving a dial in the config that turns nothing -- which is the same
 * defect as a schema keyword nothing enforces, twice fixed in `machinery.mjs`.
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
 * `repo` is derived rather than accepted: `machinery.json` is this repository's
 * one identity source, and a mistyped owner/name would send the translator to a
 * different pull request while the receipt and page still looked normal. That
 * is the `derivable` arm of the Worth test, which says remove the input.
 */
export function roundBrief({ root, pr, round, head, since = null, until = null, finalRound = false, priorAccounts = [], io = undefined }) {
  const repo = repoSlug(io);
  // DERIVED, NOT ACCEPTED -- the second instance of the same rule that removed
  // `repo` last round, and it was sitting next to it. `readAnswer` calls
  // `answerPath` and ignores whatever a caller passed, so a mistyped
  // `answerFile` meant the translator wrote a valid answer somewhere the reader
  // never looked and the page reported a FAILED round over a successful one --
  // the failure state used to hide a success. (Codex, #109 round 2.)
  const answerFile = answerPath(root, pr, round);
  const lines = [
    "## This round",
    "",
    `- **Repository:** \`${repo}\``,
    `- **Pull request:** #${pr}`,
    `- **Round:** ${round}`,
    `- **Pinned head:** \`${head}\` — select this round's commits against this, not against the default branch.`,
    // BOUNDED ON BOTH SIDES. The comment reads are live and this dispatch is
    // deliberately detached from the loop, so a slow round-N translation could
    // read round N+1's findings and replies while its commits stayed pinned to
    // N's head -- an account of a round that never existed, filed under N's
    // number and indistinguishable from a correct one. `until` is captured when
    // the dispatch is made. (Codex, #109 round 2.)
    since
      ? `- **Cursor, lower bound:** \`${since}\` — review activity after this timestamp is this round's. Commits are selected by identity, not by this.`
      : `- **Cursor, lower bound:** none — this is the first round translated on this pull request, so read it from the start. If the change is too large to read, say so in \`could_not_assess\` rather than guessing at the rest.`,
    until
      ? `- **Cursor, upper bound:** \`${until}\` — IGNORE every comment, review and reply after this timestamp. They belong to a later round, and this dispatch runs detached, so later activity may well have landed while you were reading.`
      : `- **Cursor, upper bound:** none supplied — if you find activity that plainly belongs to a later round, say so in \`could_not_assess\` rather than folding it into this one.`,
    `- **Final round:** ${finalRound ? "YES — also return `known_gaps` and `what_landed`." : "no — omit `known_gaps` and `what_landed`."}`,
    `- **Write your answer to:** \`${answerFile}\``,
  ];
  // QUOTED INLINE, NOT NAMED AS FILES. These used to be passed as local paths
  // to a role holding no `Read` tool -- the final round was told to use files
  // it could not open. A narrow read grant is not available either: a path
  // specifier in an agent's `tools:` list is not honoured, so the only shapes
  // on offer are the whole tool or none of it. Quoting costs nothing here,
  // because this is the role's OWN earlier prose being handed back to it, and
  // it is told in the same breath to treat it as navigation rather than
  // evidence. (Codex, #109 round 2.)
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
 * Refuse an answer whose shape is wrong, rather than rendering it.
 *
 * `finalRound` is required because the two final-round sections are optional in
 * the schema -- they have to be, since an ordinary round must validate without
 * them -- so the context is what decides. Symmetric on purpose: a round that
 * VOLUNTEERS a gaps list has misread its instructions, and that should surface
 * rather than render.
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
 * Each returns `{ ok: false, why }` and each becomes a FAILED round on the page
 * -- visibly a failure, never the favourable "nothing to report" case.
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
 * What the page says about the model, if anything.
 *
 * Silent when the answer came back as the model asked for -- a line on every
 * page saying the model was the right one trains a reader to skip the place the
 * real notice would appear.
 */
export function modelNote(receipt) {
  const asked = receipt.askedModel ?? null;
  const got = receipt.output?.model ?? null;
  if (!asked) return null;
  if (!got) return `This round did not report which model wrote it; ${asked} was asked for.`;
  if (got.trim() === asked.trim()) return null;
  return `Written by ${got}, not the ${asked} that was asked for — the dispatch cannot enforce the model, only report what answered.`;
}

/**
 * The three facts, off one receipt.
 *
 * A skipped round has no output and says so; everything else reads the
 * validated document, whose shape the schema already guaranteed.
 */
export function facts(receipt) {
  // FAILED IS ITS OWN STATE, and it is checked first. A round whose answer
  // never arrived or did not parse is NOT a skipped round: `skipped` renders
  // "no findings were raised and nothing was pushed", which would turn a
  // failure into a clean bill of health -- the exact thing the rule below
  // ("agrees" is never printed over an unassessed item) exists to prevent.
  if (receipt.failed) return { failed: true, skipped: false, reason: receipt.reason ?? "the translation could not be produced" };
  if (receipt.skipped) return { skipped: true, failed: false, reason: receipt.reason ?? "not dispatched" };
  const out = receipt.output ?? {};
  return {
    skipped: false,
    disagreements: Array.isArray(out.disagreements) ? out.disagreements.length : 0,
    unassessed: typeof out.could_not_assess === "string" && out.could_not_assess.trim() !== "",
    // WHETHER THERE IS A BUILDER ACCOUNT AT ALL, read from the translator's
    // own observation rather than from a receipt field. It permits a round
    // nobody has replied to -- translating one is legitimate and reads as a
    // round awaiting a response. What is not legitimate is then printing
    // "agrees with the builder's account" over it, which is what the
    // fall-through did: a clean translation of an unanswered round has no
    // disagreements and nothing unassessed, so it landed on the favourable line
    // while there was no account to agree with. Round 5 of AI-Handbook #81 was
    // exactly that round.
    //
    // THIS READ USED TO BE `receipt.record?.round?.builderAnsweredAt !== null`,
    // and the record builder that populated it was deleted with the accounting
    // machinery. Nothing wrote the field afterwards, so `undefined !== null`
    // made EVERY round read as answered and the favourable line printed over
    // every unanswered one -- #81's defect restored by the removal of its fix.
    // (Codex, #109 round 2.) The translator is the right source: it is the
    // thing that read the comments, and the schema requires the field, so an
    // answer cannot obtain the favourable value by omitting it.
    //
    // `=== true`, so an absent or malformed value reads as UNANSWERED. The old
    // read defaulted the other way to protect receipts predating the field;
    // there are none, and of the two wrong accounts the false favourable is the
    // one this page must never print.
    answered: out.builder_answered === true,
  };
}

/**
 * The line I paste into chat, verbatim.
 *
 * Four shapes and two failure notices, and nothing else is ever said about a
 * round in chat -- which is what keeps one dispatch per round from becoming a
 * running commentary.
 */
export function chatLine(receipt) {
  const f = facts(receipt);
  const r = `round ${receipt.round}`;
  if (f.failed) return `${r}: translation failed — ${f.reason}`;
  if (f.skipped) return `${r}: skipped — ${f.reason}`;
  if (f.disagreements > 0) return `${r}: differs on ${f.disagreements} point${f.disagreements === 1 ? "" : "s"}`;
  if (f.unassessed) return `${r}: partial — something could not be assessed`;
  // LAST BEFORE "agrees", AND ONLY THERE, because "agrees" is the only shape
  // that asserts a builder account exists. "differs on N" and "partial" are
  // both supported by the receipt's own fields whether or not anyone replied,
  // and "skipped" says why it never ran -- so the class this closes has
  // exactly one member and this is the whole of it.
  if (!f.answered) return `${r}: no builder account yet — the round was unanswered when this was read`;
  return `${r}: agrees with the builder's account`;
}

/** What I say when there is no receipt to render. Fixed, so the wording is not mine either. */
export const unavailable = (round, why) => `round ${round}: translation unavailable — ${why}`;
export const unpublished = (round, why) => `round ${round}: translation unpublished — ${why}`;

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/** Prose to paragraphs. The translator writes text, not markup, so nothing is interpreted. */
const prose = (text) =>
  String(text ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");

const STYLE = `
:root { --bg:#f4f5f7; --card:#fff; --ink:#191d24; --muted:#5c6470; --rule:#dbe0e6; --accent:#7a4ec2; --accent-ink:#5d3a99; --flag:#b3451f; --flag-bg:#fbeae4; --warn-bg:#fbf3df; --warn-ink:#8a6011; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#13161b; --card:#1b1f26; --ink:#e7e9ed; --muted:#98a1ae; --rule:#2c323b; --accent:#b18ae8; --accent-ink:#c7a9f0; --flag:#f0906b; --flag-bg:#3a211a; --warn-bg:#332a14; --warn-ink:#e5bf72; } }
:root[data-theme="dark"] { --bg:#13161b; --card:#1b1f26; --ink:#e7e9ed; --muted:#98a1ae; --rule:#2c323b; --accent:#b18ae8; --accent-ink:#c7a9f0; --flag:#f0906b; --flag-bg:#3a211a; --warn-bg:#332a14; --warn-ink:#e5bf72; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; padding-inline:20px; padding-block:32px 64px; }
.wrap { max-width:72ch; margin:0 auto; }
.eyebrow { font:500 12px/1.4 ui-monospace,monospace; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
h1 { font-size:clamp(24px,4vw,32px); line-height:1.2; margin:8px 0 4px; text-wrap:balance; }
.sub { color:var(--muted); font-size:14.5px; margin:0 0 28px; }
.round { background:var(--card); border:1px solid var(--rule); border-radius:10px; padding:22px 24px; margin-bottom:20px; }
.round > header { display:flex; flex-wrap:wrap; align-items:baseline; gap:10px 14px; border-bottom:1px solid var(--rule); padding-bottom:12px; margin-bottom:16px; }
.round h2 { font-size:19px; margin:0; }
.when { color:var(--muted); font-size:13px; font-variant-numeric:tabular-nums; }
.verdict { margin-left:auto; font:500 12.5px/1 ui-monospace,monospace; padding:5px 10px; border-radius:99px; border:1px solid var(--rule); color:var(--muted); white-space:nowrap; }
.verdict.differs { background:var(--flag-bg); color:var(--flag); border-color:transparent; }
.verdict.partial { background:var(--warn-bg); color:var(--warn-ink); border-color:transparent; }
.verdict.failed { background:var(--flag-bg); color:var(--flag); border-color:transparent; }
h3 { font-size:13px; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); margin:22px 0 8px; }
p { margin:0 0 12px; }
.summary p { font-size:17.5px; line-height:1.55; }
.diff-item { border-left:3px solid var(--flag); background:var(--flag-bg); padding:12px 16px; border-radius:0 6px 6px 0; margin-bottom:12px; }
.diff-item p:last-child { margin-bottom:0; }
.diff-item .why { color:var(--muted); font-size:14.5px; }
.note { background:var(--warn-bg); color:var(--warn-ink); padding:10px 14px; border-radius:6px; font-size:14.5px; margin-bottom:12px; }
h3.sub-h3 { margin-top:16px; }
.rec { border-top:1px solid var(--rule); margin-top:18px; padding-top:14px; font-size:15px; }
.rec b { color:var(--accent-ink); }
.skipped { color:var(--muted); font-size:14.5px; margin:0; }
footer { color:var(--muted); font-size:13px; margin-top:32px; }
`.trim();

// FAILED IS FIRST, for the same reason it is first in `facts()`. Without this
// branch a failed round fell through to `unanswered` while the card body beside
// it said the translation failed -- two statuses on one card, in the state whose
// whole purpose is to be unambiguous. (Codex, #109 round 2.)
const verdictChip = (f) =>
  f.failed
    ? '<span class="verdict failed">no account</span>'
    : f.skipped
    ? '<span class="verdict">skipped</span>'
    : f.disagreements > 0
      ? `<span class="verdict differs">differs on ${f.disagreements}</span>`
      : f.unassessed
        ? '<span class="verdict partial">partial</span>'
        : !f.answered
          ? '<span class="verdict partial">unanswered</span>'
          : '<span class="verdict">agrees</span>';

function renderRound(receipt) {
  const f = facts(receipt);
  const head = [
    "<header>",
    `<h2>Round ${esc(receipt.round)}</h2>`,
    `<span class="when">${esc(receipt.finishedAt ?? receipt.startedAt ?? "")}</span>`,
    verdictChip(f),
    "</header>",
  ].join("");
  if (f.failed) {
    return (
      `<section class="round">${head}<div class="note">` +
      `<b>No account for this round.</b> The translator was dispatched and did not produce a usable answer — ${esc(f.reason)}. ` +
      `This is a failure of the translation, not a report that the round was quiet: there may well have been findings, and nobody has explained them here.` +
      `</div></section>`
    );
  }
  if (f.skipped) {
    return `<section class="round">${head}<p class="skipped">Not translated — ${esc(f.reason)}. No findings were raised and nothing was pushed, so there was no account to give.</p></section>`;
  }
  const o = receipt.output ?? {};
  const cut = receipt.record?.diff?.truncated;
  const parts = [head];
  parts.push(`<div class="summary">${prose(o.summary_for_david)}</div>`);
  if (cut) {
    parts.push(
      `<div class="note">The diff for this round was cut at ${esc(cut.keptChars)} of ${esc(cut.fullChars)} characters, so the account below rests on part of the change.</div>`,
    );
  }
  const mn = modelNote(receipt);
  if (mn) parts.push(`<div class="note">${esc(mn)}</div>`);
  parts.push("<h3>What happened</h3>", prose(o.what_happened));
  const d = Array.isArray(o.disagreements) ? o.disagreements : [];
  // BOTH THE HEADING AND THE PROSE ASSERT A BUILDER ACCOUNT, and on an
  // unanswered round both were false while the chip above them already said
  // `unanswered` -- the page contradicted itself five lines apart, and the
  // half a reader actually reads was the wrong half. Neither is reachable now
  // without `f.answered`. (Codex, #81 round 8.)
  //
  // The chip carries the same claim and contains none of these words, which is
  // why `R23` asserts over the RENDERED PAGE rather than over the strings named
  // here: a check written from my own enumeration of the claim sites is how
  // this survived round 8's fix in the first place.
  //
  // THE DISAGREEMENTS THEMSELVES ALWAYS RENDER. Only the two sentences that
  // assert an account vary -- an unanswered round with disagreements is a
  // contradiction in the translator's own output, and hiding what it wrote
  // would be this same class of defect a third time, losing paid-for content
  // instead of stating a falsehood.
  parts.push(
    f.answered
      ? `<h3>Where the translator differs from the builder${d.length ? "" : " — nothing"}</h3>`
      : "<h3>Where the translator differs from the builder — no account to compare</h3>",
  );
  for (const item of d) {
    parts.push(`<div class="diff-item">${prose(item.what)}<p class="why">${esc(item.why_it_matters)}</p></div>`);
  }
  if (!d.length) {
    parts.push(
      f.answered
        ? "<p class=\"skipped\">It read the round the same way the builder described it.</p>"
        : "<p class=\"skipped\">The builder had not answered this round when it was read, so there was no account to agree or disagree with.</p>",
    );
  }
  // TWO DIFFERENT ADMISSIONS, RENDERED DIFFERENTLY ON PURPOSE. `could_not_assess`
  // is what the translator could not REACH, and it sets "partial" -- the chip,
  // the chat line, everything. `took_on_trust` is what it read and did not
  // independently verify, which is true of almost every round and would be a
  // false alarm if it moved the verdict. Collapsing them would either make
  // "partial" meaningless (it would fire every time) or lose the distinction
  // between "I could not look" and "I looked and took the builder's word".
  if (o.took_on_trust) {
    parts.push("<h3>Taken on the builder's word</h3>", prose(o.took_on_trust));
  }
  if (f.unassessed) parts.push(`<div class="note">Could not assess: ${esc(o.could_not_assess)}</div>`);
  const gaps = Array.isArray(o.known_gaps) ? o.known_gaps : null;
  if (gaps) {
    parts.push(`<h3>Shipping unfixed${gaps.length ? "" : " — nothing"}</h3>`);
    for (const g of gaps) {
      parts.push(
        `<div class="${g.reasonable ? "note" : "diff-item"}">${prose(g.what)}` +
          `<p class="why">${g.reasonable ? "Reasonable to ship: " : "The translator disagrees with this decline: "}${esc(g.why)}</p></div>`,
      );
    }
    if (!gaps.length) parts.push('<p class="skipped">Nothing is shipping unfixed.</p>');
  }
  const landed = o.what_landed;
  if (landed) {
    parts.push(
      "<h3>What landed, against what was promised</h3>",
      prose(landed.landed),
      '<h3 class="sub-h3">What it does not do</h3>',
      prose(landed.does_not_do),
      '<h3 class="sub-h3">What you are now trusting</h3>',
      prose(landed.now_trusting),
    );
  }
  parts.push(`<p class="rec"><b>Recommendation:</b> ${esc(o.recommendation)}</p>`);
  return `<section class="round">${parts.join("\n")}</section>`;
}

/**
 * The whole page, newest round first.
 *
 * Rebuilt from every receipt on every render, so a round whose publish failed
 * appears on the next one rather than being lost.
 */
/**
 * Who actually wrote the accounts on this page, read off the receipts.
 *
 * One model across every round names it. More than one names none of them and
 * points at the per-round notices, because a page-level claim cannot be true of
 * all of them.
 */
export function attribution(rounds) {
  const models = [...new Set(rounds.map((r) => r.output?.model).filter((m) => typeof m === "string" && m.trim()))];
  if (models.length === 1) return ` Written by ${esc(models[0])}.`;
  if (models.length > 1) return " Rounds here were written by more than one model — each says which, below.";
  return "";
}

export function renderPage(receipts, { pr, title = null } = {}) {
  const rounds = [...receipts].sort((a, b) => b.round - a.round);
  const latest = rounds[0];
  return [
    `<title>Review rounds on PR #${pr}</title>`,
    `<style>${STYLE}</style>`,
    '<div class="wrap">',
    `<div class="eyebrow">Independent account · pull request #${esc(pr)}</div>`,
    `<h1>${esc(title ?? `What the reviewer found, and what the builder did`)}</h1>`,
    // ATTRIBUTION IS DERIVED, never asserted. Saying "written by Fable" here
    // while `modelNote` prints a mismatch two inches below was this page
    // contradicting itself a third time (Codex, #109 round 1) -- the same
    // defect #81 round 8 fixed for the verdict chip. Every claim this page
    // makes about a round now reads the receipts.
    `<p class="sub">An independent account of each round, read from the round's own material — the reviewer's findings, the builder's replies, and the code actually pushed.${attribution(rounds)} It decides nothing; the loop never reads it.${latest ? ` Latest: ${esc(chatLine(latest))}.` : ""}</p>`,
    ...rounds.map(renderRound),
    `<footer>${rounds.length} round${rounds.length === 1 ? "" : "s"} on this pull request. This page is redeployed in place each round, so this link stays current.</footer>`,
    "</div>",
  ].join("\n");
}

/**
 * Make `.agents/reviews/` ignored before anything writes into it.
 *
 * EXTRACTED BECAUSE NINE SCRIPTS WRITE HERE AND TWO SEEDED THE RULE. These are
 * session artifacts, not repository history, and a consumer that has never run
 * a translation has no `.gitignore` to inherit -- so whichever writer happens
 * to go first leaves untracked files a routine `git add -A` will commit.
 *
 * I declined this on #88 as a rare ordering and the adjudicator agreed, and
 * the reviewer raised the same class again on #90. Re-triaged on the new
 * instance, per `claude-core.md` review-loop rule 5: the mis-sized half was the
 * LIKELIHOOD. It is not a rare ordering -- it is seven of nine writers, and
 * every David-facing role adds another. Sharing one copy is cheaper than the
 * bookkeeping of carrying it as a gap.
 */
export function ensureReviewsIgnored(root) {
  const dir = path.join(root, REVIEWS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(dir, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n");
  return ignore;
}

/** Write the page, keeping its directory ignored. */
export function writePage(root, pr, html, { runGit = (a) => spawnSync("git", a, { cwd: root, encoding: "utf8" }) } = {}) {
  const dir = path.dirname(pagePath(root, pr));
  fs.mkdirSync(dir, { recursive: true });
  ensureReviewsIgnored(root);
  const file = pagePath(root, pr);
  // Written through a temporary file and renamed, because the rounds are
  // dispatched detached and two deliveries can be inside this function at
  // once. `rename` is atomic on the same filesystem, so a concurrent reader --
  // or the publish that follows -- sees the old page or the new one, never a
  // half-written one. The temporary name carries the pid so two writers do not
  // collide on it either.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${html}\n`);
  fs.renameSync(tmp, file);
  const rel = path.relative(root, file);
  const check = runGit(["check-ignore", "-q", rel]);
  if (check.status !== 0) {
    throw new Error(
      `${rel} is not ignored by git, and this page is a session artifact that must not be committed. ` +
        `Check ${REVIEWS_DIR}/.gitignore for a later negation -- a .gitignore is an ordered program and the last ` +
        `matching rule wins.`,
    );
  }
  return rel;
}

/**
 * Render and write the page, then make sure the page on disk is the one the
 * receipts on disk imply.
 *
 * THE RACE THIS CLOSES. Every round is dispatched detached and the loop
 * proceeds immediately, so two deliveries overlap: A enumerates and sees only
 * its own receipt, B writes its receipt, enumerates both and publishes the
 * complete page -- and then A's write lands, rebuilt from its stale list, and
 * the round B just delivered is gone from David's page. Waiting on every exit
 * file at close-out does not catch it: both rounds ran, and the page is still
 * missing one. (Codex, #81, the mechanical round.)
 *
 * A LOCK IS THE WRONG TOOL. A lock file adds a stale-lock failure mode to a
 * path whose entire job is to still produce a line when something goes wrong,
 * and a delivery that dies holding one would strand every later round. This
 * re-reads instead: after writing, enumerate again, and if the set changed
 * under us, render and write the newer set. A writer therefore repairs its own
 * overwrite. Bounded rather than unbounded because a loop that cannot finish is
 * worse than a page one round behind -- and the receipts are all still on disk
 * either way.
 *
 * COMPARING THE SET'S SIZE IS COMPARING ITS CONTENTS, and that holds because
 * of a rule enforced elsewhere rather than because sets generally behave that
 * way. NO PATH WRITES A DIFFERENT RECEIPT FOR A ROUND THAT ALREADY HAS ONE
 * (David, 2026-09-13: a re-run fills a hole, it never replaces an account) --
 * `runTranslation` republishes from the existing account instead of dispatching
 * again -- so the set can only grow, and a changed count is the only change
 * available. Without that rule this comparison would miss a re-run that
 * replaced a receipt in place: same count, different account, which is what D0
 * found when it was asked to look for an interleaving that settles on a stale
 * page. The two are one design, so the dependency is stated here: anything
 * that lets a round's receipt be REWRITTEN breaks this comparison, while
 * republishing from an unchanged one does not.
 */
export function publishPage(root, pr, { attempts = 5, ...opts } = {}) {
  let rel = null;
  for (let i = 0; i < attempts; i += 1) {
    const before = receiptsFor(root, pr);
    rel = writePage(root, pr, renderPage(before, { pr }), opts);
    const after = receiptsFor(root, pr);
    if (after.length === before.length) return rel;
  }
  return rel;
}

/** Every translation receipt for one PR, newest round last. */
export function receiptsFor(root, pr, receiptsDir = ".agents/receipts") {
  const dir = path.join(root, receiptsDir);
  if (!fs.existsSync(dir)) return [];
  const prefix = `fable-round-translation-${pr}-`;
  return fs
    .readdirSync(dir)
    .filter((n) => n.startsWith(prefix) && n.endsWith(".json"))
    .map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")))
    .filter((r) => Number.isFinite(r.round))
    .sort((a, b) => a.round - b.round);
}
