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

import {
  facts,
  chatLine,
  renderPage,
  receiptsFor,
  writePage,
  publishPage,
  pagePath,
  unavailable,
  composeBrief,
  validateAnswer,
  dispatchModel,
  modelNote,
  rolePath,
  schemaPath,
  ROLE,
} from "../round-translation-page.mjs";

const PR = 81;
const T = (iso) => new Date(iso).toISOString();


const receipt = (round, output, over = {}) => ({ role: "round-translation", pr: PR, round, output, finishedAt: T("2026-09-12T11:10:00Z"), ...over });
const answer = (over = {}) => ({
  summary_for_david: "The reviewer raised two points on this round.\nOne was fixed, one declined.\nNothing here should worry you.",
  what_happened: "The first point was a real ordering mistake and the builder fixed it. The second was about a value you type yourself, and the builder declined it.",
  disagreements: [],
  took_on_trust: "I took the builder's word that the test suite passes; I did not run it.",
  could_not_assess: null,
  recommendation: "Nothing to do.",
  model: "claude-fable-5-1",
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
  // Both halves of the filter, not just the prefix: a JSON file under another
  // prefix, and a matching prefix that is not JSON. (The fixture here used to
  // be a `fable-probe-` receipt, from a role the #95 rebuild deleted -- a
  // fixture naming something that no longer exists tests nothing and reads as
  // though it does.)
  w("something-else-81-1.json", { round: 7 });
  w("fable-round-translation-81-3.txt", "not json");
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


// ---------------------------------------------------------------------------
// #95: composing the dispatch, and refusing what comes back malformed
// ---------------------------------------------------------------------------

test("the brief is the role file verbatim, with only the round's coordinates appended", () => {
  const roleFile = rolePath(ROLE);
  const onDisk = fs.readFileSync(roleFile, "utf8").trim();
  const brief = composeBrief({ repo: "Owner/Repo", pr: 12, round: 3, sinceCommit: "abc1234" });

  // VERBATIM MEANS VERBATIM. This is the one property worth keeping from the
  // 1,450-line dispatcher: a role whose instructions the builder could
  // paraphrase is a role that says whatever the builder remembers it saying.
  assert.ok(brief.startsWith(onDisk), "the role file must open the brief unmodified");
  const appended = brief.slice(onDisk.length);
  assert.match(appended, /Owner\/Repo/);
  assert.match(appended, /#12/);
  assert.match(appended, /\*\*Round:\*\* 3/);
  // and nothing else: the appendix is coordinates, not instructions.
  assert.ok(appended.length < 900, `appendix should be short, was ${appended.length} chars`);
});

test("the brief bounds the reading to this round, and says so differently on the first", () => {
  const later = composeBrief({ repo: "Owner/Repo", pr: 12, round: 4, sinceCommit: "abc1234" });
  assert.match(later, /AFTER commit `abc1234`/);

  const first = composeBrief({ repo: "Owner/Repo", pr: 12, round: 1, sinceCommit: null });
  assert.match(first, /first round translated/);
  assert.doesNotMatch(first, /AFTER commit/);
  // An unbounded read is the expensive one, so the first round is told to
  // disclose a diff it could not finish rather than to guess at the rest.
  assert.match(first, /could_not_assess/);
});

test("the final-round sections are asked for only on the final round", () => {
  assert.match(composeBrief({ repo: "O/R", pr: 1, round: 9, finalRound: true }), /YES -- return `known_gaps`/);
  const ordinary = composeBrief({ repo: "O/R", pr: 1, round: 2, finalRound: false });
  assert.match(ordinary, /omit `known_gaps` and `what_landed`/);
});

test("validateAnswer runs against the role's REAL schema, so the two cannot drift apart", () => {
  // Deliberately not a fixture schema. If the shipped schema and the shipped
  // role brief stop agreeing, this test is where it shows up.
  assert.deepEqual(validateAnswer(answer()), []);
  assert.ok(fs.existsSync(schemaPath(ROLE)));
});

test("validateAnswer refuses a malformed answer, and returns the problems rather than throwing", () => {
  const { took_on_trust, ...missing } = answer();
  const problems = validateAnswer(missing);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /took_on_trust/);

  // Returned, never thrown: D0 is off the critical path, and a broken
  // translation must not be able to stop a review loop.
  assert.doesNotThrow(() => validateAnswer({ nonsense: true }));
  assert.ok(validateAnswer({ nonsense: true }).length > 0);
});

test("validateAnswer enforces the emptiness the schema claims to require", () => {
  assert.match(validateAnswer(answer({ recommendation: "" }))[0], /at least 1 is required/);
  // could_not_assess is a union type and both arms are real answers.
  assert.deepEqual(validateAnswer(answer({ could_not_assess: null })), []);
  assert.deepEqual(validateAnswer(answer({ could_not_assess: "the diff was too large to read" })), []);
  assert.match(validateAnswer(answer({ could_not_assess: 42 }))[0], /matched none of the permitted types/);
});

test("the final-round sections validate when present and are optional when absent", () => {
  assert.deepEqual(validateAnswer(answer()), []);
  assert.deepEqual(
    validateAnswer(
      answer({
        known_gaps: [{ what: "A stale comment stays", reasonable: true, why: "Nothing reads it." }],
        what_landed: { landed: "a", does_not_do: "b", now_trusting: "c" },
      }),
    ),
    [],
  );
  assert.ok(validateAnswer(answer({ known_gaps: [{ what: "x", why: "y" }] })).length > 0, "reasonable is required");
});

test("dispatchModel turns the configured tier into the name the Agent tool takes", () => {
  // DISTINCT ROOTS ON PURPOSE. `machineryConfig` caches on `io.root`, so two
  // fixtures sharing a root silently test the first one twice -- which is how
  // the refusal below first passed while checking nothing.
  const io = (root, id) => ({ root, read: () => JSON.stringify({ repo: "O/R", models: { strongestClaude: { id, effort: "xhigh" } } }) });
  assert.deepEqual(dispatchModel(io("/repo-fable", "claude-fable-5-1")), { id: "claude-fable-5-1", agentModel: "fable" });
  assert.deepEqual(dispatchModel(io("/repo-opus", "claude-opus-5")), { id: "claude-opus-5", agentModel: "opus" });

  // The Agent tool takes a Claude short name, so a non-Claude tier cannot be
  // dispatched this way at all -- and says so rather than guessing.
  assert.throws(() => dispatchModel(io("/repo-codex", "gpt-6-astra")), /not a Claude model/);
});

test("the model is disclosed rather than observed, and only a mismatch is printed", () => {
  // Silent on the ordinary case ON PURPOSE: a line on every page saying the
  // model was the right one trains a reader to skip the place the real notice
  // appears.
  assert.equal(modelNote({ askedModel: "claude-fable-5-1", output: { model: "claude-fable-5-1" } }), null);
  assert.match(modelNote({ askedModel: "claude-fable-5-1", output: { model: "claude-sonnet-5" } }), /not the claude-fable-5-1/);
  assert.match(modelNote({ askedModel: "claude-fable-5-1", output: {} }), /did not report which model/);
  // No asked-for model recorded at all -- an older receipt -- says nothing
  // rather than inventing a mismatch.
  assert.equal(modelNote({ output: { model: "claude-sonnet-5" } }), null);
});

test("a model mismatch reaches David's page", () => {
  const html = renderPage([receipt(1, answer({ model: "claude-sonnet-5" }), { askedModel: "claude-fable-5-1" })], { pr: PR });
  assert.match(html, /not the claude-fable-5-1 that was asked for/);
});

test("took_on_trust renders but does NOT make the round partial", () => {
  // The whole reason it is a separate field. `could_not_assess` means "I could
  // not look" and sets partial; `took_on_trust` means "I looked and took the
  // builder's word", which is true of nearly every round and would make the
  // partial signal fire constantly if the two were one field.
  const r = receipt(1, answer({ took_on_trust: "I did not run the test suite." }));
  assert.equal(facts(r).unassessed, false);
  assert.equal(chatLine(r), "round 1: agrees with the builder's account");
  const html = renderPage([r], { pr: PR });
  assert.match(html, /Taken on the builder's word/);
  assert.match(html, /I did not run the test suite\./);
});

test("the final round's gaps are rendered, and a disputed decline is set apart from an accepted one", () => {
  const html = renderPage(
    [
      receipt(7, answer({
        known_gaps: [
          { what: "A stale comment stays in a script", reasonable: true, why: "Nothing reads it." },
          { what: "A consumer keeps deleted files on re-sync", reasonable: false, why: "This one will bite the first consumer." },
        ],
        what_landed: { landed: "The accounting is gone.", does_not_do: "It does not rewrite the rulebook.", now_trusting: "The builder's own triage, unassisted." },
      })),
    ],
    { pr: PR },
  );
  assert.match(html, /Shipping unfixed/);
  assert.match(html, /Reasonable to ship: Nothing reads it\./);
  assert.match(html, /The translator disagrees with this decline: This one will bite/);
  assert.match(html, /What landed, against what was promised/);
  assert.match(html, /What you are now trusting/);
  assert.match(html, /The builder&#x27;s own triage|The builder's own triage/);
});

test("an ordinary round renders none of the final-round sections", () => {
  const html = renderPage([receipt(2, answer())], { pr: PR });
  assert.doesNotMatch(html, /Shipping unfixed/);
  assert.doesNotMatch(html, /What landed, against what was promised/);
});
