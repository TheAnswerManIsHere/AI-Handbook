// SYNCED FROM AI-Handbook — do not edit in a consumer repo.
/**
 * D0's tests. The deliverable is a chat message, so these assert on text.
 *
 * The rule under test throughout: **"agrees" is never printed over an
 * unassessed item, or over a round the builder has not answered** -- and the
 * report never says anything the translator did not.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  REVIEWS_DIR,
  answerPath,
  schemaPath,
  ROLE,
  ensureReviewsIgnored,
  dispatchModel,
  roundBrief,
  validateAnswer,
  readAnswer,
  facts,
  chatLine,
  chatReport,
} from "../round-translation.mjs";

const PR = 81;

const answer = (over = {}) => ({
  summary_for_david:
    "The reviewer raised two points on this round.\nOne was fixed, one declined.\nNothing here should worry you.",
  what_happened:
    "The first point was a real ordering mistake and the builder fixed it. The second was about a value you type yourself, and the builder declined it.",
  disagreements: [],
  took_on_trust: "I took the builder's word that the test suite passes; I did not run it.",
  could_not_assess: null,
  recommendation: "Nothing to do.",
  model: "claude-fable-5-1",
  builder_answered: true,
  ...over,
});

const round = (n, a, over = {}) => ({ pr: PR, round: n, answer: a, ...over });

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "d0-"));

// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------

test("the answer path is derived, and derived the same way by writer and reader", () => {
  assert.equal(answerPath("/r", 12, 3), path.join("/r", REVIEWS_DIR, "pr-12", "round-3.answer.json"));
  // The brief must name EXACTLY the path readAnswer will open. When the brief
  // accepted a path from a caller, a mistyped one meant a valid answer written
  // where nothing looked -- reported as a failed round. (Codex, #109 round 2.)
  const b = roundBrief({ root: "/r", pr: 12, round: 3, head: "abc1234" });
  assert.ok(b.includes(answerPath("/r", 12, 3)));
});

test("the schema resolves relative to the module, not to a caller's root", () => {
  // Resolving it under the ANSWER FILE's root works in this repo and breaks in
  // a consumer, where this file sits at `scripts/` rather than `core/scripts/`.
  assert.ok(fs.existsSync(schemaPath()));
  assert.ok(schemaPath().endsWith(path.join(".agents", "fable-roles", "schemas", `${ROLE}.schema.json`)));
});

test("the repository is derived, never passed in", () => {
  const io = {
    root: "/repo-derive",
    read: () => JSON.stringify({ repo: "Owner/Name", models: { strongestClaude: { id: "claude-fable-5-1", effort: "xhigh" } } }),
  };
  assert.match(roundBrief({ root: "/r", pr: 1, round: 1, head: "h", io }), /Owner\/Name/);
});

test("dispatchModel returns the agent name and reports that effort is not applied", () => {
  const io = {
    root: "/repo-model",
    read: () => JSON.stringify({ repo: "O/N", models: { strongestClaude: { id: "claude-fable-5-1", effort: "xhigh" } } }),
  };
  const d = dispatchModel(io);
  assert.equal(d.agentModel, "fable");
  assert.equal(d.id, "claude-fable-5-1");
  assert.equal(d.effort, "xhigh");
  // A dial in the config that turns nothing is the same defect as a schema
  // keyword nothing enforces. Say so rather than dropping it silently.
  assert.equal(d.effortApplied, false);
});

test("a non-Claude dispatch model is refused, because the Agent tool cannot take it", () => {
  const io = { root: "/repo-bad", read: () => JSON.stringify({ repo: "O/N", models: { strongestClaude: { id: "gpt-5", effort: "xhigh" } } }) };
  assert.throws(() => dispatchModel(io), /not a Claude model/);
});

test("commits are selected by ancestry and review activity by clock, and they are separate coordinates", () => {
  // This was ONE `since` timestamp doing both jobs, which was wrong in both
  // directions: unbounded it walked the branch's whole ancestry, and bounded it
  // filtered on author date, silently dropping a cherry-pick pushed during the
  // round. (Codex, #109 round 3.)
  const later = roundBrief({
    root: "/r",
    pr: 1,
    round: 4,
    head: "deadbee",
    previousHead: "cafe123",
    since: "2026-09-16T10:00:00Z",
    until: "2026-09-16T11:00:00Z",
  });
  assert.match(later, /\*\*Previous head:\*\* `cafe123`/);
  assert.match(later, /Ancestry, not timestamps/);
  assert.match(later, /\*\*Review activity, from:\*\* `2026-09-16T10:00:00Z`/);
  assert.match(later, /\*\*Review activity, until:\*\* `2026-09-16T11:00:00Z`/);
  assert.match(later, /IGNORE every comment, review and reply after this timestamp/);
  // No clock may appear in the commit coordinate.
  const commitLine = later.split("\n").find((l) => l.includes("Previous head:"));
  assert.doesNotMatch(commitLine, /\d{4}-\d{2}-\d{2}T/);
});

test("the first round is bounded by the pull request, never by the branch's history", () => {
  const first = roundBrief({ root: "/r", pr: 1, round: 1, head: "deadbee" });
  assert.match(first, /\*\*Previous head:\*\* none/);
  assert.match(first, /every commit on the pull request/);
  assert.match(first, /never by the branch's history/);
});

test("prior accounts are quoted inline on the final round only", () => {
  const prior = [{ round: 1, summary_for_david: "SUMMARY-ONE", what_happened: "HAPPENED-ONE" }];
  const fin = roundBrief({ root: "/r", pr: 1, round: 9, head: "h", finalRound: true, priorAccounts: prior });
  assert.match(fin, /navigation only/);
  assert.match(fin, /SUMMARY-ONE/);
  assert.match(fin, /HAPPENED-ONE/);
  // NAMED AS FILES IS AN INSTRUCTION TO DO THE IMPOSSIBLE: the role holds no
  // Read tool, and a path specifier in `tools:` is not honoured, so there is
  // no narrow read grant to give it. Scoped to the section because the brief
  // legitimately names one .json path -- the answer file.
  assert.doesNotMatch(fin.slice(fin.indexOf("## Earlier accounts")), /\.json/);

  const ordinary = roundBrief({ root: "/r", pr: 1, round: 2, head: "h", priorAccounts: prior });
  assert.doesNotMatch(ordinary, /navigation only/);
  assert.doesNotMatch(ordinary, /SUMMARY-ONE/);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("validateAnswer runs against the REAL shipped schema, so brief and schema cannot drift", () => {
  assert.deepEqual(validateAnswer(answer()), []);
});

test("the final-round sections are required on the final round and refused otherwise", () => {
  const gaps = [{ what: "x", reasonable: true, why: "y" }];
  const landed = { landed: "a", does_not_do: "b", now_trusting: "c" };
  assert.deepEqual(validateAnswer(answer({ known_gaps: gaps, what_landed: landed }), { finalRound: true }), []);
  // Both directions, because an optional field nothing enforces is the defect
  // this machinery keeps paying for.
  assert.notDeepEqual(validateAnswer(answer(), { finalRound: true }), []);
  assert.notDeepEqual(validateAnswer(answer({ known_gaps: gaps, what_landed: landed })), []);
});

test("an empty could_not_assess is refused, not read as 'nothing to report'", () => {
  // The validator accepted "" and the reader read "" as not-unassessed: two
  // checks disagreeing about what empty means, with the favourable state as
  // the result. (Codex, #109 round 2.)
  assert.notDeepEqual(validateAnswer(answer({ could_not_assess: "" })), []);
  assert.deepEqual(validateAnswer(answer({ could_not_assess: null })), []);
  assert.deepEqual(validateAnswer(answer({ could_not_assess: "The diff was cut." })), []);
});

test("an undeterminable model is null, never prose", () => {
  // The brief permitted prose, and every reader treats a non-empty string as a
  // model id -- so the honest answer printed as the model's name.
  assert.deepEqual(validateAnswer(answer({ model: null })), []);
  assert.notDeepEqual(validateAnswer(answer({ model: "" })), []);
});

test("readAnswer turns all three delivery failures into one honest shape", () => {
  const root = tmpRoot();
  fs.mkdirSync(path.dirname(answerPath(root, 7, 1)), { recursive: true });

  assert.match(readAnswer(root, 7, 1).why, /wrote no answer file/);

  fs.writeFileSync(answerPath(root, 7, 1), "not json at all");
  assert.match(readAnswer(root, 7, 1).why, /not valid JSON/);

  fs.writeFileSync(answerPath(root, 7, 1), JSON.stringify({ summary_for_david: "x" }));
  assert.match(readAnswer(root, 7, 1).why, /did not match the expected shape/);

  fs.writeFileSync(answerPath(root, 7, 1), JSON.stringify(answer()));
  const ok = readAnswer(root, 7, 1);
  assert.equal(ok.ok, true);
  assert.equal(ok.answer.recommendation, "Nothing to do.");
});

test("the answer directory is kept ignored, because an answer must never be committed", () => {
  const root = tmpRoot();
  const ignore = ensureReviewsIgnored(root);
  assert.equal(fs.readFileSync(ignore, "utf8"), "*\n");
});

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

test("agrees is printed only when nothing was left unassessed", () => {
  assert.equal(chatLine(round(1, answer())), "round 1: agrees with the builder's account");
  assert.equal(
    chatLine(round(1, answer({ could_not_assess: "The diff was cut before the second file." }))),
    "round 1: partial — something could not be assessed",
  );
});

test("any disagreement wins over both, and is counted", () => {
  assert.equal(chatLine(round(2, answer({ disagreements: [{ what: "a", why_it_matters: "b" }] }))), "round 2: differs on 1 point");
  assert.equal(
    chatLine(round(2, answer({ disagreements: [{ what: "a", why_it_matters: "b" }, { what: "c", why_it_matters: "d" }], could_not_assess: "also this" }))),
    "round 2: differs on 2 points",
  );
});

test("the favourable line needs the translator to have SEEN a builder reply", () => {
  // `answered` used to be read off a receipt field whose only writer was the
  // record builder the #89 cut deleted, so every round read as answered.
  assert.equal(
    chatLine(round(1, answer({ builder_answered: false }))),
    "round 1: no builder account yet — the round was unanswered when this was read",
  );
  const { builder_answered, ...withoutField } = answer();
  assert.equal(facts(round(1, withoutField)).answered, false);
});

test("a failed round is its own state and is never reported as a quiet one", () => {
  const f = { pr: PR, round: 3, failed: true, reason: "the answer file never arrived" };
  assert.equal(facts(f).failed, true);
  assert.equal(facts(f).skipped, false);
  assert.match(chatLine(f), /^round 3: translation failed — the answer file never arrived$/);
  const skipped = { pr: PR, round: 4, skipped: true, reason: "not dispatched" };
  assert.match(chatLine(skipped), /^round 4: skipped — not dispatched$/);
});

// ---------------------------------------------------------------------------
// The deliverable
// ---------------------------------------------------------------------------

test("the chat report is the translator's words, not the builder's summary of them", () => {
  const a = answer({
    disagreements: [{ what: "The builder called this fixed; the diff changes a different function.", why_it_matters: "The reported problem may still be there." }],
  });
  const text = chatReport(round(2, a), { askedModel: "claude-fable-5-1" });

  // Every prose field appears VERBATIM. This is the one property worth having
  // machinery for: a builder-written summary of an independent account is just
  // the builder's account again.
  assert.ok(text.includes(a.summary_for_david));
  assert.ok(text.includes(a.what_happened));
  assert.ok(text.includes(a.disagreements[0].what));
  assert.ok(text.includes(a.disagreements[0].why_it_matters));
  assert.ok(text.includes(a.took_on_trust));
  assert.ok(text.includes(a.recommendation));
  // And the verdict leads, so the headline cannot disagree with the body.
  assert.ok(text.startsWith("**D0 — round 2: differs on 1 point**"));
  // The builder's thread shorthand never reaches David.
  assert.doesNotMatch(text, /Class:|Worth:|Oracle:/);
});

test("a failed report says nobody explained the round, not that it was quiet", () => {
  const text = chatReport({ pr: PR, round: 3, failed: true, reason: "the answer file never arrived" });
  assert.match(text, /No independent account of this round exists/);
  assert.match(text, /not a report that the round was quiet/);
  // It must not borrow the quiet-round wording, which would be a false clean
  // bill of health.
  assert.doesNotMatch(text, /agrees/);
});

test("the final round's sections render, and a disputed gap is marked as disputed", () => {
  const a = answer({
    known_gaps: [
      { what: "A mistyped flag is not caught.", reasonable: true, why: "You type it yourself." },
      { what: "The retry can loop twice.", reasonable: false, why: "I think this one should have been fixed." },
    ],
    what_landed: { landed: "It reads the round from GitHub.", does_not_do: "It does not judge anything.", now_trusting: "That the translator read the whole diff." },
  });
  const text = chatReport(round(9, a));
  assert.match(text, /\*\*Shipping unfixed\*\*/);
  assert.match(text, /\*\*Not reasonable\*\*: The retry can loop twice/);
  assert.match(text, /Reasonable: A mistyped flag/);
  assert.match(text, /\*\*What actually landed\*\*/);
  assert.ok(text.includes("It does not judge anything."));
  assert.ok(text.includes("That the translator read the whole diff."));
});

test("an ordinary round's report carries none of the final-round sections", () => {
  const text = chatReport(round(2, answer()));
  assert.doesNotMatch(text, /Shipping unfixed|What actually landed/);
});

test("the model is mentioned only when it is worth a reader's attention", () => {
  // Silent on a match: a line on every round saying the model was right trains
  // a reader to skip the place the real notice would appear.
  assert.doesNotMatch(chatReport(round(1, answer()), { askedModel: "claude-fable-5-1" }), /Written by|did not report which model/);
  assert.match(
    chatReport(round(1, answer({ model: "claude-sonnet-5" })), { askedModel: "claude-fable-5-1" }),
    /Written by claude-sonnet-5, not the claude-fable-5-1 that was asked for/,
  );
  assert.match(chatReport(round(1, answer({ model: null })), { askedModel: "claude-fable-5-1" }), /did not report which model wrote it/);
});
