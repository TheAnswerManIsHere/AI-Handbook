// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
//
// D0's PAGE, on its own, after the #89 cut.
//
// `round-translation.test.mjs` covered the whole D0 pipeline: the record
// builder, the closeout waiter, the loop position, the delivery log, D2, D3
// and the dispatch wiring. Every one of those went in the cut, and the record
// builder went with the snapshot it read. What survives is the RENDERER --
// David keeps D0, and #95 rebuilds its input from GitHub with this page as the
// starting point -- so these are that file's own tests, carried over verbatim
// rather than rewritten, and nothing else.
//
// The receipt fixtures below are hand-built for the same reason: the builder
// that used to produce them is gone, and a renderer's test should describe the
// shape it renders anyway.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { facts, chatLine, renderPage, receiptsFor, writePage, publishPage, pagePath, unavailable } from "../round-translation-page.mjs";

const PR = 81;
const T = (iso) => new Date(iso).toISOString();


const receipt = (round, output, over = {}) => ({ role: "round-translation", pr: PR, round, output, finishedAt: T("2026-09-12T11:10:00Z"), ...over });
const answer = (over = {}) => ({
  summary_for_david: "The reviewer raised two points on this round.\nOne was fixed, one declined.\nNothing here should worry you.",
  what_happened: "The first point was a real ordering mistake and the builder fixed it. The second was about a value you type yourself, and the builder declined it.",
  disagreements: [],
  could_not_assess: null,
  recommendation: "Nothing to do.",
  ...over,
});

test("agrees is printed only when nothing was left unassessed", () => {
  assert.equal(chatLine(receipt(1, answer())), "round 1: agrees with the builder's account");
  assert.equal(
    chatLine(receipt(1, answer({ could_not_assess: "The diff was cut before the second file." }))),
    "round 1: partial — something could not be assessed",
    "could-not-observe is never turned into the favourable answer",
  );
});

test("any disagreement wins over both, and is counted", () => {
  const one = receipt(2, answer({ disagreements: [{ what: "a", why_it_matters: "b" }] }));
  assert.equal(chatLine(one), "round 2: differs on 1 point");
  const two = receipt(2, answer({ disagreements: [{ what: "a", why_it_matters: "b" }, { what: "c", why_it_matters: "d" }], could_not_assess: "also this" }));
  assert.equal(chatLine(two), "round 2: differs on 2 points");
});

test("a skipped round is distinguishable from all three", () => {
  const r = { role: "round-translation", pr: PR, round: 3, skipped: true, reason: "no findings and nothing pushed since the reviewed commit" };
  assert.equal(chatLine(r), "round 3: skipped — no findings and nothing pushed since the reviewed commit");
  assert.equal(facts(r).skipped, true);
});

test("an empty disagreement list is a real answer, not a missing one", () => {
  const f = facts(receipt(1, answer()));
  assert.equal(f.disagreements, 0);
  assert.equal(f.unassessed, false);
});

test("the failure notices are fixed text, not the builder's wording", () => {
  assert.equal(unavailable(4, "the snapshot was captured too early"), "round 4: translation unavailable — the snapshot was captured too early");
});

test("the page renders newest round first and shows only what the receipts hold", () => {
  const html = renderPage(
    [
      receipt(1, answer()),
      receipt(2, answer({ disagreements: [{ what: "The builder called this fixed; the diff changes a different function.", why_it_matters: "The reported problem may still be there." }] })),
    ],
    { pr: PR },
  );
  assert.ok(html.indexOf("Round 2") < html.indexOf("Round 1"), "newest first");
  assert.match(html, /The builder called this fixed/);
  assert.match(html, /verdict differs/);
  assert.match(html, /<title>Review rounds on PR #81<\/title>/);
  assert.doesNotMatch(html, /Class:|Worth:/, "the builder's thread shorthand never reaches the page");
});

test("the page marks a truncated diff independently of what the translator said", () => {
  const r = receipt(1, answer(), { record: { diff: { truncated: { keptChars: 1000, fullChars: 9000 } } } });
  assert.match(renderPage([r], { pr: PR }), /cut at 1000 of 9000 characters/);
});

test("the page escapes text rather than rendering it as markup", () => {
  const html = renderPage([receipt(1, answer({ recommendation: "<script>alert(1)</script>" }))], { pr: PR });
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
});

test("a skipped round renders as skipped, with its reason", () => {
  const html = renderPage([{ role: "round-translation", pr: PR, round: 1, skipped: true, reason: "no findings and nothing pushed since the reviewed commit" }], { pr: PR });
  assert.match(html, /Not translated/);
  assert.match(html, /verdict">skipped/);
});

test("the page names both themes' colours at the root, so neither renders on the other's ground", () => {
  const html = renderPage([receipt(1, answer())], { pr: PR });
  const root = html.slice(html.indexOf(":root {"), html.indexOf("@media"));
  for (const token of ["--bg:", "--ink:", "--card:", "--rule:", "--accent:", "--flag:"]) {
    assert.ok(root.includes(token), `${token} is defined on bare :root`);
  }
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /\[data-theme="dark"\]/);
});

// ---------------------------------------------------------------------------
// The page and receipts on disk
// ---------------------------------------------------------------------------

function tmpRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "d0-page-"));
  fs.mkdirSync(path.join(root, ".agents/receipts"), { recursive: true });
  return root;
}

test("the page is written into a directory git ignores, and refuses if it is not", () => {
  const root = tmpRepo();
  const rel = writePage(root, PR, "<p>x</p>", { runGit: () => ({ status: 0 }) });
  assert.equal(rel, path.join(".agents/reviews", `pr-${PR}`, "translation.html"));
  assert.equal(fs.readFileSync(path.join(root, ".agents/reviews/.gitignore"), "utf8"), "*\n");
  assert.throws(() => writePage(root, PR, "<p>x</p>", { runGit: () => ({ status: 1 }) }), /is not ignored by git/);
});

test("receiptsFor reads this PR's rounds in order and ignores everything else", () => {
  const root = tmpRepo();
  const w = (name, body) => fs.writeFileSync(path.join(root, ".agents/receipts", name), JSON.stringify(body));
  w("fable-round-translation-81-2.json", receipt(2, answer()));
  w("fable-round-translation-81-1.json", receipt(1, answer()));
  w("fable-round-translation-99-1.json", { ...receipt(1, answer()), pr: 99 });
  w("fable-probe-abc1234.json", { role: "probe" });
  const got = receiptsFor(root, PR);
  assert.deepEqual(got.map((r) => r.round), [1, 2]);
});

test("the page path is derived from the PR, never supplied", () => {
  assert.equal(pagePath("/r", 81), path.join("/r", ".agents/reviews", "pr-81", "translation.html"));
});

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Concurrent publishes
// ---------------------------------------------------------------------------

test("R16: a concurrent delivery's round cannot be overwritten out of the page", () => {
  // Every round is dispatched detached, so two deliveries overlap: A
  // enumerates its own receipt only, B writes its receipt and publishes the
  // complete page, then A's write lands from its stale list and B's round is
  // gone. Waiting on every exit file does not catch it -- both rounds ran.
  const root = tmpRepo();
  const receipts = path.join(root, ".agents", "receipts");
  fs.mkdirSync(receipts, { recursive: true });
  const put = (round) =>
    fs.writeFileSync(
      path.join(receipts, `fable-round-translation-${PR}-${round}.json`),
      JSON.stringify({ role: "round-translation", pr: PR, round, output: answer() }),
    );

  put(1);
  // A is inside publishPage having seen only round 1; B lands round 2 between
  // A's enumeration and A's re-read. `publishPage` re-reads after writing, so A
  // repairs the page it just made stale.
  const realRead = fs.readdirSync;
  let calls = 0;
  fs.readdirSync = (...args) => {
    calls += 1;
    if (calls === 2) put(2); // B's receipt appears after A's first enumeration
    return realRead(...args);
  };
  let rel;
  try {
    rel = publishPage(root, PR, { runGit: () => ({ status: 0 }) });
  } finally {
    fs.readdirSync = realRead;
  }

  const html = fs.readFileSync(path.join(root, rel), "utf8");
  assert.match(html, /Round 1/, "round 1 is on the page");
  assert.match(html, /Round 2/, "and so is the round that landed mid-publish");
});

test("R16: the page is written atomically, so no reader sees it half-built", () => {
  const src = fs.readFileSync(new URL("../round-translation-page.mjs", import.meta.url), "utf8");
  assert.match(src, /fs\.renameSync\(tmp, file\)/, "rename, not a truncating write into the live path");
  assert.ok(!/fs\.writeFileSync\(file, /.test(src), "nothing writes the live page path directly");
});
