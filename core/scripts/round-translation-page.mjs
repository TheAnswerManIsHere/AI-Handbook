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
 * unassessed item.** Could-not-observe is not the favourable answer -- the
 * same rule every receipt field in this machinery already follows.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** Where the page goes. Derived, never supplied — same rule as the receipt path. */
export const REVIEWS_DIR = ".agents/reviews";
export const pagePath = (root, pr) => path.join(root, REVIEWS_DIR, `pr-${pr}`, "translation.html");

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
  parts.push("<h3>What happened</h3>", prose(o.what_happened));
  const d = Array.isArray(o.disagreements) ? o.disagreements : [];
  parts.push(`<h3>Where the translator differs from the builder${d.length ? "" : " — nothing"}</h3>`);
  if (d.length) {
    for (const item of d) {
      parts.push(`<div class="diff-item">${prose(item.what)}<p class="why">${esc(item.why_it_matters)}</p></div>`);
    }
  } else {
    parts.push("<p class=\"skipped\">It read the round the same way the builder described it.</p>");
  }
  if (f.unassessed) parts.push(`<div class="note">Could not assess: ${esc(o.could_not_assess)}</div>`);
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
 * Write the page, keeping its directory ignored.
 *
 * Same shape `plan-review.mjs` uses for its own directory, and for the same
 * reason: these are session artifacts, not repository history, and a consumer
 * that has never run one has no `.gitignore` to inherit.
 */
export function writePage(root, pr, html, { runGit = (a) => spawnSync("git", a, { cwd: root, encoding: "utf8" }) } = {}) {
  const dir = path.dirname(pagePath(root, pr));
  fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(root, REVIEWS_DIR, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n");
  const file = pagePath(root, pr);
  fs.writeFileSync(file, `${html}\n`);
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
