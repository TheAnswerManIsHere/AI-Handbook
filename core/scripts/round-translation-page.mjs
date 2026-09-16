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
import { modelTier, validate, assertSchemaSupported } from "./machinery.mjs";

/** Where the page goes. Derived, never supplied — same rule as the receipt path. */
export const REVIEWS_DIR = ".agents/reviews";
export const pagePath = (root, pr) => path.join(root, REVIEWS_DIR, `pr-${pr}`, "translation.html");

// ---------------------------------------------------------------------------
// Composing the dispatch, and validating what comes back
// ---------------------------------------------------------------------------
/**
 * WHY THESE TWO LIVE HERE AND NOT IN A DISPATCHER. `fable-dispatch.mjs` was
 * 1,450 lines, and roughly 1,300 of them defended against the builder
 * tampering with the second Claude: a locked flag frame, a model observation,
 * a token bound, a fresh session id, 24 receipt fields. David's 2026-09-11
 * rule retires that whole class -- "I run every script in this machinery, so a
 * defence against my editing its inputs is a lock whose key is on the same
 * ring."
 *
 * What was NOT same-ring is the pair below: reading the role brief from its
 * file rather than from my memory of it, and refusing an answer whose shape is
 * wrong. Neither defends against me; both catch a real mistake. They are two
 * functions, so they live in the one file that was staying anyway rather than
 * in a second file whose only job is to not be the transport.
 *
 * WHAT IS GENUINELY GIVEN UP, stated rather than buried: the dispatcher
 * OBSERVED the model off the session's init line and refused on a mismatch.
 * A subagent dispatch cannot -- `model` is a request the harness honours, and
 * the runtime may fall back silently. So the model is DISCLOSED instead: the
 * role reports what it is actually running as, `modelNote` compares that to
 * what was asked for, and a mismatch is printed on David's page. Observed-or-
 * refused becomes observed-or-disclosed, which is weaker and is why it is
 * shown to him rather than swallowed.
 */

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The role brief and its schema, resolved from this file rather than from a caller. */
export const ROLE_DIR = path.resolve(SCRIPT_DIR, "..", ".agents", "fable-roles");
export const rolePath = (role) => path.join(ROLE_DIR, `${role}.md`);
export const schemaPath = (role) => path.join(ROLE_DIR, "schemas", `${role}.schema.json`);
export const ROLE = "fable-round-translation";

/**
 * The dispatch model, as a full id and as the name the Agent tool takes.
 *
 * The tier indirection is kept: `.agents/machinery.json` says which model
 * `strongestClaude` is, so a consumer that runs a different one changes one
 * config line rather than editing a script. The Agent tool takes a short name
 * rather than a full id, so the two are derived from each other here and the
 * full id is what gets compared against what answered.
 */
export function dispatchModel(io = undefined) {
  // `modelTier` returns the whole entry -- {tier, id, effort} -- not the id.
  const entry = modelTier("strongestClaude", io);
  const id = typeof entry === "string" ? entry : entry?.id;
  const m = typeof id === "string" ? /^claude-(fable|opus|sonnet|haiku)\b/.exec(id) : null;
  if (!m) {
    throw new Error(
      `.agents/machinery.json's models.strongestClaude.id is ${JSON.stringify(id)}, which is not a Claude model, ` +
        `so it cannot be dispatched as a subagent. The Agent tool takes one of fable, opus, sonnet, haiku.`,
    );
  }
  return { id, agentModel: m[1] };
}

/**
 * The prompt, with the role brief inserted VERBATIM.
 *
 * The brief is read from its file and not one word of it is composed here.
 * That is the property worth keeping from the old dispatcher: a role whose
 * instructions I could paraphrase is a role that says whatever I remember it
 * saying. What this function adds is only the round's coordinates -- which
 * pull request, which round, where the last round stopped -- because the role
 * cannot know those and they are what bounds its reading.
 */
export function composeBrief({ repo, pr, round, sinceCommit = null, finalRound = false, roleFile = rolePath(ROLE) }) {
  const brief = fs.readFileSync(roleFile, "utf8");
  const scope = sinceCommit
    ? `Everything on this pull request AFTER commit \`${sinceCommit}\`, which is where the last round you were ` +
      `given stopped. Threads with activity after it, and the diff of the commits since it.`
    : `This is the first round translated on this pull request, so there is no earlier commit to read from. ` +
      `Read the whole of it -- and if the diff is too large to read, say so in \`could_not_assess\` rather ` +
      `than guessing at the rest.`;
  return [
    brief.trim(),
    "",
    "---",
    "",
    "## This round",
    "",
    `- **Repository:** \`${repo}\``,
    `- **Pull request:** #${pr}`,
    `- **Round:** ${round}`,
    `- **What to read:** ${scope}`,
    `- **Final round:** ${finalRound ? "YES -- return `known_gaps` and `what_landed` as well." : "no -- omit `known_gaps` and `what_landed`."}`,
    "",
    "Return your answer as a single JSON object matching the schema in your role definition, and nothing else.",
    "",
  ].join("\n");
}

/**
 * Refuse an answer whose shape is wrong, rather than rendering it.
 *
 * NOT SAME-RING: this catches a malformed answer whoever wrote the prompt, and
 * the failure it prevents is a page that renders `undefined` at David. Returns
 * the problems rather than throwing, so a caller can put them on the page as a
 * failure notice -- D0 is off the critical path and a broken translation must
 * never be able to stop a review loop.
 */
export function validateAnswer(answer, { schemaFile = schemaPath(ROLE) } = {}) {
  const schema = JSON.parse(fs.readFileSync(schemaFile, "utf8"));
  assertSchemaSupported(schema, ROLE);
  return validate(answer, schema, ROLE);
}

/**
 * What the page says about the model, if anything.
 *
 * `null` when the answer came back as the model that was asked for -- the
 * ordinary case says nothing, because a line on every page saying "this ran on
 * the model it was supposed to" is noise that trains a reader to skip the
 * place the real notice would appear.
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
  if (receipt.skipped) return { skipped: true, reason: receipt.reason ?? "not dispatched" };
  const out = receipt.output ?? {};
  return {
    skipped: false,
    disagreements: Array.isArray(out.disagreements) ? out.disagreements.length : 0,
    unassessed: typeof out.could_not_assess === "string" && out.could_not_assess.trim() !== "",
    // WHETHER THERE IS A BUILDER ACCOUNT AT ALL, read off the record rather
    // than inferred from the prose. The record permits a round nobody has
    // replied to -- translating one is legitimate and reads as a round awaiting
    // a response. What is not legitimate is then printing "agrees with the
    // builder's account" over it, which is what the fall-through did: a clean
    // translation of an unanswered round has no disagreements and nothing
    // unassessed, so it landed on the favourable line while there was no
    // account to agree with. Round 5 of AI-Handbook #81 was exactly that round.
    //
    // `builderAnsweredAt`, NOT `respondedAt`. The first version of this read
    // `respondedAt`, which is the newest NON-REVIEWER comment -- so a
    // maintainer's comment on the round set it and the favourable line printed
    // anyway. The two questions are "is the capture fresh" (every comment
    // counts) and "did the builder answer" (only the builder's does), and one
    // field cannot answer both. (Codex, #81 round 8.)
    //
    // `=== null` rather than a falsy test, because a receipt predating this
    // field has no `record` at all and must read as "not established" rather
    // than "unanswered": inventing an unanswered round over an old receipt is
    // the same wrong account facing the other way.
    answered: receipt.record?.round?.builderAnsweredAt !== null,
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

const verdictChip = (f) =>
  f.skipped
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
export function renderPage(receipts, { pr, title = null } = {}) {
  const rounds = [...receipts].sort((a, b) => b.round - a.round);
  const latest = rounds[0];
  return [
    `<title>Review rounds on PR #${pr}</title>`,
    `<style>${STYLE}</style>`,
    '<div class="wrap">',
    `<div class="eyebrow">Independent account · pull request #${esc(pr)}</div>`,
    `<h1>${esc(title ?? `What the reviewer found, and what the builder did`)}</h1>`,
    `<p class="sub">Written by Fable from each round's own material — the reviewer's findings, the builder's replies, and the code actually pushed. It decides nothing; the loop never reads it.${latest ? ` Latest: ${esc(chatLine(latest))}.` : ""}</p>`,
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
