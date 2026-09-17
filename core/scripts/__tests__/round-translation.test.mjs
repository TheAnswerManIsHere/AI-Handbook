// SYNCED FROM AI-Handbook — do not edit in a consumer repo.
/**
 * D0's tests. The deliverable is a chat message, so these assert on text.
 *
 * Two rules under test throughout: **"agrees" is never printed over an
 * unassessed item, or over a round the builder has not answered** -- and the
 * report never says anything the translator did not. And one rule about the
 * tests themselves: **the boundary between the module's own functions is
 * exercised with real results, never with fixtures built by hand.** Every
 * fixture here used to build the report shape by hand, so a `readAnswer`
 * result that `chatReport` could not consume shipped past 23 green tests.
 * (Codex, #109 round 4, P1.)
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
  prepareAnswerPath,
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

const finalSections = {
  known_gaps: [{ what: "A mistyped flag is not caught.", reasonable: true, why: "You type it yourself." }],
  what_landed: { landed: "It reads the round from GitHub.", does_not_do: "It does not judge anything.", now_trusting: "That the translator read the whole diff." },
};

const disagreement = { what: "The builder called this fixed; the diff changes a different function.", why_it_matters: "The reported problem may still be there." };

const round = (n, a, over = {}) => ({ pr: PR, round: n, answer: a, ...over });

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "d0-"));

/** Write an answer where the translator would, then read it back the way the skill does. */
function writeAndRead(root, pr, n, a, opts = {}) {
  const file = prepareAnswerPath(root, pr, n);
  fs.writeFileSync(file, JSON.stringify(a));
  return readAnswer(root, pr, n, opts);
}

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

// A DISTINCT ROOT PER FIXTURE, because machineryConfig memoizes per root: two
// fixtures sharing one root would silently serve the first one's configuration
// to the second, and a test for a refusal would pass against the wrong file.
let fakeRoots = 0;
const fakeIo = (over = {}) => ({
  root: `/repo-fixture-${(fakeRoots += 1)}`,
  read: () =>
    JSON.stringify({
      repo: "Owner/Name",
      reviewer: { login: "some-reviewer[bot]" },
      models: { strongestClaude: { id: "claude-fable-5-1", effort: "xhigh" } },
      ...over,
    }),
});

test("the repository is derived, never passed in", () => {
  assert.match(roundBrief({ root: "/r", pr: 1, round: 1, head: "h", io: fakeIo() }), /Owner\/Name/);
});

test("the reviewer's identity is supplied as a coordinate, never inferred from a comment", () => {
  // Telling a role to filter on "the reviewer's login" without supplying it is
  // circular: the only evidence it has for who the reviewer is are the very
  // comments it is classifying, and any participant can post one carrying the
  // marker line -- the builder's own round summaries quote it routinely.
  // (Codex, #109 round 5; the round-4 translation raised the same gap itself.)
  const b = roundBrief({ root: "/r", pr: 1, round: 2, head: "h", io: fakeIo() });
  assert.match(b, /\*\*The code reviewer is `some-reviewer\[bot\]`\*\*/);
  assert.match(b, /the ONLY account whose comments and review submissions count/);
  assert.match(b, /Never infer this from a comment's content/);
  // And a configuration that does not say refuses rather than letting the role guess.
  assert.throws(
    () => roundBrief({ root: "/r", pr: 1, round: 2, head: "h", io: fakeIo({ reviewer: undefined }) }),
    /declares no "reviewer"\.login/,
  );
});

test("malformed coordinates are refused before a dispatch, not interpolated", () => {
  // Measured before the fix: `round: "two"` asked for "the twoth review" and
  // `pr: "12x"` addressed `pr-12x/`, where the read for #12 finds nothing and
  // reports a FAILED translation of a round that actually ran -- a typo
  // becoming an account of the wrong round. (Codex, #109 round 5.)
  for (const bad of [{ pr: "12x", round: 1 }, { pr: 0, round: 1 }, { pr: 1, round: "two" }, { pr: 1, round: 1.5 }, { pr: 1, round: 0 }]) {
    assert.throws(() => roundBrief({ root: "/r", head: "h", io: fakeIo(), ...bad }), /must be a positive integer/, JSON.stringify(bad));
  }
  // The check lives on the shared derivation, so every entry point inherits it.
  assert.throws(() => answerPath("/r", 1, "two"), /must be a positive integer/);
  assert.throws(() => readAnswer("/r", "12x", 1), /must be a positive integer/);
  // A REAL ROOT, because this one WRITES: the refusal must happen before any
  // directory is created, and asserting that against an unwritable path would
  // pass on the permission error instead of on the validation. CI found this
  // the hard way -- the container runs as root, where `mkdir /r` silently
  // succeeded and left a stray directory behind, while the runner got EACCES.
  const writable = tmpRoot();
  assert.throws(() => prepareAnswerPath(writable, 1, -1), /must be a positive integer/);
  assert.equal(fs.existsSync(path.join(writable, REVIEWS_DIR)), false, "a refused call must leave nothing behind");
  // The head is the evidence boundary; an empty one asks for an unbounded range.
  for (const head of ["", "   ", null, undefined]) {
    assert.throws(() => roundBrief({ root: "/r", pr: 1, round: 1, head, io: fakeIo() }), /head must be a non-empty commit identifier/);
  }
});

test("dispatchModel returns both the agent name and the full id, from one call", () => {
  const d = dispatchModel(fakeIo());
  // The Agent call takes `agentModel`; `chatReport` compares against `id`.
  // Naming them from two separate calls is how the skill lost the binding.
  // (Codex, #109 round 4.)
  assert.equal(d.agentModel, "fable");
  assert.equal(d.id, "claude-fable-5-1");
  assert.equal(d.effort, "xhigh");
  // A dial in the config that turns nothing is the same defect as a schema
  // keyword nothing enforces. Say so rather than dropping it silently.
  assert.equal(d.effortApplied, false);
});

test("a non-Claude dispatch model is refused, because the Agent tool cannot take it", () => {
  const io = fakeIo({ models: { strongestClaude: { id: "gpt-5", effort: "xhigh" } } });
  assert.throws(() => dispatchModel(io), /not a Claude model/);
});

test("the round's boundaries are located on the pull request, never remembered", () => {
  // The receipt store was silently carrying `since` and the previous head;
  // with it gone a resumed session read "from the start" and re-attributed
  // every earlier round to the current one. The remedy is not a smaller
  // store: the reviewer marks every round it returns, in two shapes, and the
  // Nth marker IS round N. (Codex, #109 round 4; measured on #115.)
  const b = roundBrief({ root: "/r", pr: 1, round: 4, head: "deadbee", now: () => new Date("2026-09-16T11:00:00Z") });
  assert.match(b, /\*\*Round:\*\* 4 — the 4th review the reviewer has returned/);
  assert.match(b, /formal review submission/);
  assert.match(b, /\*\*Reviewed commit:\*\*/);
  assert.match(b, /Locate this round's marker and, when 4 > 1, the previous round's/);
  assert.match(b, /do not guess a window/);
  // No coordinate is remembered by the caller: neither a lower timestamp
  // bound nor a previous head is accepted, so neither can be stale.
  assert.doesNotMatch(b, /Review activity, from|Previous head/);
  assert.match(b, /\*\*Review activity, until:\*\* `2026-09-16T11:00:00\.000Z` — the moment this dispatch was made/);
  assert.match(b, /IGNORE every comment, review and reply after this timestamp/);
});

test("the activity window's upper bound is derived, so there is no way to dispatch without one", () => {
  // Accepted as an input it was: `null` printed "none supplied" and left the
  // window open at the top, and "yesterday", 42 and "2026-13-45T99:99:99Z"
  // were interpolated verbatim as though they were timestamps. Either way a
  // detached round could absorb the next round's findings and file them under
  // this one. (Codex, #109 round 6.) The bound IS the moment of the dispatch,
  // and this function is that moment, so a caller could only get it wrong.
  const before = new Date();
  const b = roundBrief({ root: "/r", pr: 1, round: 2, head: "h" });
  const m = /\*\*Review activity, until:\*\* `([^`]+)`/.exec(b);
  assert.ok(m, "every brief carries an upper bound");
  const stamped = new Date(m[1]);
  assert.equal(Number.isNaN(stamped.getTime()), false, "and it is a real timestamp");
  assert.ok(stamped >= before && stamped <= new Date(), "taken at the moment of the dispatch");
  // The open-topped branch is gone, not merely unreachable.
  assert.doesNotMatch(b, /none supplied/);
  // A caller cannot supply one: the key is not read.
  assert.doesNotMatch(roundBrief({ root: "/r", pr: 1, round: 2, head: "h", until: "yesterday" }), /yesterday/);
});

test("a prior account from another pull request is refused, never quoted as this one's", () => {
  // One session can hold several PRs. Quoted here, a foreign result would be
  // presented to the translator as its OWN earlier work on THIS pull request
  // -- a foreign history steering the round David reads most carefully.
  // Refused rather than dropped: a silent drop would name the round as having
  // no account and bury the real reason. (Codex, #109 round 6.)
  const root = tmpRoot();
  const mine = writeAndRead(root, 12, 1, answer({ summary_for_david: "MINE" }));
  const theirs = writeAndRead(root, 99, 1, answer({ summary_for_david: "FOREIGN" }));
  assert.equal(theirs.pr, 99, "every read result carries the pull request it came from");
  assert.throws(
    () => roundBrief({ root, pr: 12, round: 2, head: "h", finalRound: true, priorAccounts: [theirs] }),
    /carries a result from pull request #99 .*this brief is for #12/s,
  );
  // This PR's own accounts are quoted as before.
  assert.match(roundBrief({ root, pr: 12, round: 2, head: "h", finalRound: true, priorAccounts: [mine] }), /MINE/);
});

test("the head is where the evidence stops, not the commit the reviewer reviewed", () => {
  // Pinned to the reviewed commit, the translator could never check a reply's
  // "fixed in <later sha>". (Astra, 2026-09-16.)
  const b = roundBrief({ root: "/r", pr: 1, round: 2, head: "deadbee" });
  const headLine = b.split("\n").find((l) => l.includes("**Head:**"));
  assert.match(headLine, /`deadbee` — where the evidence stops/);
  assert.match(headLine, /NOT necessarily the commit the reviewer reviewed/);
  // And no clock appears on it.
  assert.doesNotMatch(headLine, /\d{4}-\d{2}-\d{2}T/);
});

test("the brief carries the schema, nested field names included", () => {
  // The role holds no tool that can open the schema file, and neither the
  // role nor the coordinates named `why_it_matters`, `does_not_do` or
  // `now_trusting`. A validator the writer cannot see rejects honest answers.
  // (Astra, 2026-09-16.)
  const b = roundBrief({ root: "/r", pr: 1, round: 1, head: "h" });
  assert.match(b, /## The shape of your answer/);
  for (const key of ["why_it_matters", "does_not_do", "now_trusting", "builder_answered", "could_not_assess"]) {
    assert.ok(b.includes(`"${key}"`), `schema key ${key} missing from the brief`);
  }
  // The quoted schema is the shipped one, so the two cannot drift.
  assert.ok(b.includes(JSON.stringify(JSON.parse(fs.readFileSync(schemaPath(), "utf8")), null, 2)));
});

test("prior accounts are readAnswer results, quoted whole, on the final round only", () => {
  const root = tmpRoot();
  const one = writeAndRead(root, PR, 1, answer({ summary_for_david: "SUMMARY-ONE", what_happened: "HAPPENED-ONE", builder_answered: false, could_not_assess: "CNA-ONE", disagreements: [{ what: "D-ONE", why_it_matters: "WHY-ONE" }] }));
  const fin = roundBrief({ root, pr: PR, round: 3, head: "h", finalRound: true, priorAccounts: [one] });
  assert.match(fin, /navigation only/);
  // The round number comes from the readAnswer result, not from a bare answer
  // -- which carries none and rendered "### Round undefined". (Astra.)
  assert.match(fin, /### Round 1\n/);
  assert.doesNotMatch(fin, /undefined/);
  assert.match(fin, /SUMMARY-ONE/);
  assert.match(fin, /HAPPENED-ONE/);
  // The navigation fields the final round is REQUIRED to use, all quoted:
  // whether the builder had replied, the limitation, and each disagreement.
  // (Codex, #109 round 4.)
  assert.match(fin, /Builder had replied when this was written:\*\* no — treat its conclusions as provisional/);
  assert.match(fin, /Could not assess:\*\* CNA-ONE/);
  assert.match(fin, /Disagreed with the builder on 1:/);
  assert.match(fin, /D-ONE — WHY-ONE/);
  // NAMED AS FILES IS AN INSTRUCTION TO DO THE IMPOSSIBLE: the role holds no
  // Read tool, and a path specifier in `tools:` is not honoured, so there is
  // no narrow read grant to give it. Scoped to the section because the brief
  // legitimately names one .json path -- the answer file.
  const section = fin.slice(fin.indexOf("## Earlier accounts"), fin.indexOf("## The shape of your answer"));
  assert.doesNotMatch(section, /\.json/);

  const ordinary = roundBrief({ root, pr: PR, round: 2, head: "h", priorAccounts: [one] });
  assert.doesNotMatch(ordinary, /navigation only|SUMMARY-ONE/);
});

test("a missing or failed earlier account is named as such, never silently omitted", () => {
  // A resumed session holds NO earlier answer files (the directory is
  // ignored, the container is ephemeral), and the role is required to state a
  // missing account as a limitation -- which it can only do if told. The old
  // brief emitted no section at all, so the final round read as though there
  // had been no earlier rounds. (Fable, 2026-09-16.)
  const root = tmpRoot();
  const two = readAnswer(root, PR, 2); // nothing written: a FAILED result
  assert.equal(two.failed, true);
  const fin = roundBrief({ root, pr: PR, round: 4, head: "h", finalRound: true, priorAccounts: [two] });
  assert.match(fin, /### Round 1\n\nNo account of this round exists in this session/);
  assert.match(fin, /### Round 2\n\nThe translation of this round FAILED — the translator wrote no answer file/);
  assert.match(fin, /### Round 3\n\nNo account of this round exists/);
  assert.match(fin, /State this as a limitation/);
  // Nothing is ever said about the current round or a later one.
  assert.doesNotMatch(fin, /### Round 4/);
  // And with no prior accounts passed at all, the section still names every round.
  const none = roundBrief({ root, pr: PR, round: 3, head: "h", finalRound: true });
  assert.match(none, /### Round 1\n/);
  assert.match(none, /### Round 2\n/);
});

test("prepareAnswerPath clears a stale answer, so a re-dispatch cannot be read as its predecessor", () => {
  // `answerPath` is the same for every attempt of a round; waiting for
  // completion fixes an EARLY read but not a STALE one. (Astra, 2026-09-16.)
  const root = tmpRoot();
  const first = writeAndRead(root, PR, 5, answer({ recommendation: "FIRST ATTEMPT" }));
  assert.equal(first.answer.recommendation, "FIRST ATTEMPT");
  const file = prepareAnswerPath(root, PR, 5);
  assert.equal(file, answerPath(root, PR, 5));
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(path.dirname(file)), true);
  assert.equal(fs.readFileSync(path.join(root, REVIEWS_DIR, ".gitignore"), "utf8"), "*\n");
  // A second attempt that writes nothing is a FAILED round, not the first attempt's answer.
  const second = readAnswer(root, PR, 5);
  assert.equal(second.failed, true);
  assert.match(second.reason, /wrote no answer file/);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("validateAnswer runs against the REAL shipped schema, so brief and schema cannot drift", () => {
  assert.deepEqual(validateAnswer(answer()), []);
});

test("the final-round sections are required on the final round and refused otherwise", () => {
  assert.deepEqual(validateAnswer(answer(finalSections), { finalRound: true }), []);
  // Both directions, because an optional field nothing enforces is the defect
  // this machinery keeps paying for.
  assert.notDeepEqual(validateAnswer(answer(), { finalRound: true }), []);
  assert.notDeepEqual(validateAnswer(answer(finalSections)), []);
});

test("an empty or blank could_not_assess is refused, not read as 'nothing to report'", () => {
  // The validator accepted "" and the reader read "" as not-unassessed: two
  // checks disagreeing about what empty means, with the favourable state as
  // the result. (Codex, #109 round 2.) Then "   " passed `minLength` and was
  // trimmed into the favourable state one character away. (Astra, 2026-09-16.)
  assert.notDeepEqual(validateAnswer(answer({ could_not_assess: "" })), []);
  assert.match(validateAnswer(answer({ could_not_assess: "   " })).join("; "), /is blank/);
  assert.deepEqual(validateAnswer(answer({ could_not_assess: null })), []);
  assert.deepEqual(validateAnswer(answer({ could_not_assess: "The diff was cut." })), []);
  // And the reader side does not trim either: only null is fully assessed.
  assert.equal(facts(round(1, answer({ could_not_assess: "   " }))).unassessed, true);
});

test("an undeterminable model is null, never prose", () => {
  // The brief permitted prose, and every reader treats a non-empty string as a
  // model id -- so the honest answer printed as the model's name.
  assert.deepEqual(validateAnswer(answer({ model: null })), []);
  assert.notDeepEqual(validateAnswer(answer({ model: "" })), []);
});

test("the answer directory is kept ignored, because an answer must never be committed", () => {
  const root = tmpRoot();
  const ignore = ensureReviewsIgnored(root);
  assert.equal(fs.readFileSync(ignore, "utf8"), "*\n");
});

// ---------------------------------------------------------------------------
// The boundary: step 3's output IS step 4's input
// ---------------------------------------------------------------------------

test("a real readAnswer result feeds chatReport unchanged, on an ordinary and a final round", () => {
  // THE TEST WHOSE ABSENCE LET THE P1 THROUGH. `readAnswer` returned
  // `{ ok, answer }`, `chatReport` read `{ round, answer }`, and every fixture
  // built the second shape by hand. (Codex, #109 round 4.)
  const root = tmpRoot();
  const ordinary = writeAndRead(root, PR, 2, answer());
  const text = chatReport(ordinary, { askedModel: "claude-fable-5-1" });
  assert.ok(text.startsWith("**D0 — round 2: agrees with the builder's account**"));
  assert.doesNotMatch(text, /undefined/);

  const fin = writeAndRead(root, PR, 3, answer(finalSections), { finalRound: true });
  const finText = chatReport(fin);
  assert.ok(finText.startsWith("**D0 — round 3: agrees with the builder's account**"));
  assert.match(finText, /\*\*Shipping unfixed\*\*/);
  assert.match(finText, /\*\*What actually landed\*\*/);
  assert.doesNotMatch(finText, /undefined/);
});

test("every delivery failure reaches chatReport as a FAILED round, never as a benign state", () => {
  // A failed read used to render as "no builder account yet -- the round was
  // unanswered when this was read": a failure wearing a benign state's
  // clothes, the third instance on this PR. (Codex, #109 round 4.)
  const root = tmpRoot();
  const missing = readAnswer(root, PR, 4);
  assert.deepEqual(Object.keys(missing).sort(), ["failed", "pr", "reason", "round"]);
  assert.match(missing.reason, /wrote no answer file/);
  let text = chatReport(missing);
  assert.ok(text.startsWith("**D0 — round 4: translation failed — the translator wrote no answer file"));
  assert.doesNotMatch(text, /undefined|no builder account|agrees/);

  fs.writeFileSync(prepareAnswerPath(root, PR, 4), "not json at all");
  text = chatReport(readAnswer(root, PR, 4));
  assert.match(text, /^\*\*D0 — round 4: translation failed — the answer file is not valid JSON/);

  fs.writeFileSync(prepareAnswerPath(root, PR, 4), JSON.stringify({ summary_for_david: "x" }));
  text = chatReport(readAnswer(root, PR, 4));
  assert.match(text, /^\*\*D0 — round 4: translation failed — the answer did not match the expected shape/);
  assert.match(text, /No independent account of this round exists/);
});

test("a finalRound flag that differs between dispatch and read is named, not reported as a bad answer", () => {
  // The flag is supplied by hand twice; a mismatch renders a VALID answer as a
  // failed round, and "did not match the expected shape" points at the
  // translator. (Fable, 2026-09-16.)
  const root = tmpRoot();
  const readAsOrdinary = writeAndRead(root, PR, 6, answer(finalSections));
  assert.equal(readAsOrdinary.failed, true);
  assert.match(readAsOrdinary.reason, /written for the final round but read as an ordinary one/);
  assert.match(readAsOrdinary.reason, /finalRound flag differs/);
  const readAsFinal = writeAndRead(root, PR, 7, answer(), { finalRound: true });
  assert.match(readAsFinal.reason, /written for an ordinary round but read as the final one/);
  // A genuinely bad answer is still reported as one, even on a final round.
  const bad = writeAndRead(root, PR, 8, answer({ ...finalSections, model: "" }), { finalRound: true });
  assert.match(bad.reason, /did not match the expected shape/);
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

test("on an answered round any disagreement wins over both, and is counted", () => {
  assert.equal(chatLine(round(2, answer({ disagreements: [disagreement] }))), "round 2: differs on 1 point");
  assert.equal(
    chatLine(round(2, answer({ disagreements: [disagreement, { what: "c", why_it_matters: "d" }], could_not_assess: "also this" }))),
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

test("an unanswered round never has a position attributed to the builder", () => {
  // The role may raise "a risk nobody named" on a round nobody has replied to,
  // and the old order printed "differs on 1 point" plus "Where it disagrees
  // with the builder" over `builder_answered: false`. (Codex, #109 round 4.)
  const a = answer({ builder_answered: false, disagreements: [disagreement] });
  assert.equal(chatLine(round(3, a)), "round 3: no builder account yet — the translator raises 1 concern of its own");
  const text = chatReport(round(3, a));
  assert.match(text, /\*\*Concerns the translator raises on its own — the builder has not replied\*\* \(1\)/);
  assert.doesNotMatch(text, /disagrees with the builder|differs on/);
  // The concern itself still renders in full: mislabelling it would be bad,
  // suppressing it worse.
  assert.ok(text.includes(disagreement.what));
  assert.ok(text.includes(disagreement.why_it_matters));
  assert.equal(
    chatLine(round(3, answer({ builder_answered: false, disagreements: [disagreement], could_not_assess: "x" }))),
    "round 3: no builder account yet — the translator raises 1 concern of its own, and something could not be assessed",
  );
  assert.equal(
    chatLine(round(3, answer({ builder_answered: false, could_not_assess: "x" }))),
    "round 3: no builder account yet — partial, something could not be assessed",
  );
});

test("the verdict line and the section wording name the same fact in every state", () => {
  // Four times this component has paid for two claim sites reading different
  // facts (#81 round 8; #109 rounds 2, 3, 4). Enumerate every cell rather
  // than the reported one.
  const evaluative = /\b(good|fine|clean|reasonable|correct|safe|agrees?)\b/i;
  for (const answered of [true, false]) {
    for (const unassessed of [false, true]) {
      for (const n of [0, 1, 2]) {
        const a = answer({
          builder_answered: answered,
          could_not_assess: unassessed ? "One thread could not be fetched." : null,
          disagreements: Array.from({ length: n }, (_, i) => ({ what: `W${i}`, why_it_matters: `M${i}` })),
        });
        const line = chatLine(round(1, a));
        const text = chatReport(round(1, a));
        const label = `answered=${answered} unassessed=${unassessed} n=${n}`;
        if (!answered) {
          assert.match(line, /no builder account yet/, label);
          assert.doesNotMatch(text, /disagrees with the builder|differs on|agrees with/, label);
          if (n) assert.match(text, /Concerns the translator raises on its own — the builder has not replied\*\* \(\d\)/, label);
          else assert.match(text, /No concerns of its own reported; there is no builder account yet to disagree with/, label);
        } else if (n) {
          assert.match(line, new RegExp(`differs on ${n} point`), label);
          assert.match(text, new RegExp(`Where it disagrees with the builder\\*\\* \\(${n}\\)`), label);
        } else {
          assert.match(line, unassessed ? /partial/ : /agrees with the builder's account/, label);
          assert.match(text, unassessed ? /No disagreements reported on what could be assessed/ : /No disagreements reported with the builder's account/, label);
        }
        // "agrees" appears in the headline only in the one cell that earns it.
        assert.equal(/agrees/.test(line), answered && !unassessed && n === 0, label);
        // The empty-case label states a value and evaluates nothing.
        if (n === 0) {
          const emptyLine = text.split("\n").find((l) => /reported/.test(l));
          assert.doesNotMatch(emptyLine, evaluative, label);
        }
        // Partial is never silent.
        assert.equal(/Could not assess:/.test(text), unassessed, label);
      }
    }
  }
});

test("a failed round is its own state and is never reported as a quiet one", () => {
  const f = { pr: PR, round: 3, failed: true, reason: "the answer file never arrived" };
  assert.equal(facts(f).failed, true);
  assert.equal(facts(f).skipped, false);
  assert.match(chatLine(f), /^round 3: translation failed — the answer file never arrived$/);
  const skipped = { pr: PR, round: 4, skipped: true, reason: "the dispatch was refused: Agent type not found" };
  assert.match(chatLine(skipped), /^round 4: skipped — the dispatch was refused/);
  // Failure to launch and failure to answer are told apart in the report.
  assert.match(chatReport(skipped), /was not dispatched for this round — the dispatch was refused/);
  assert.match(chatReport(f), /was dispatched and produced nothing usable/);
});

// ---------------------------------------------------------------------------
// The deliverable
// ---------------------------------------------------------------------------

test("the chat report is the translator's words, not the builder's summary of them", () => {
  const a = answer({ disagreements: [disagreement] });
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
    what_landed: finalSections.what_landed,
  });
  const text = chatReport(round(9, a));
  assert.match(text, /\*\*Shipping unfixed\*\*/);
  assert.match(text, /\*\*Not reasonable\*\*: The retry can loop twice/);
  assert.match(text, /Reasonable: A mistyped flag/);
  assert.match(text, /\*\*What actually landed\*\*/);
  assert.ok(text.includes("It does not judge anything."));
  assert.ok(text.includes("That the translator read the whole diff."));
});

test("an empty gaps list on the final round renders an explicit result", () => {
  // The schema calls `known_gaps: []` "a real answer", and a length check
  // rendered nothing for it -- so David could not tell "nothing is shipping
  // unfixed" from "gaps were never assessed", with no side channel left
  // because builder prose around the report is forbidden. (Codex, #109
  // round 4.) The label is qualified when the assessment was partial.
  const text = chatReport(round(9, answer({ ...finalSections, known_gaps: [] })));
  assert.match(text, /\*\*Shipping unfixed\*\*\n\n\*No known gaps reported\.\*/);
  const partial = chatReport(round(9, answer({ ...finalSections, known_gaps: [], could_not_assess: "one thread" })));
  assert.match(partial, /\*No known gaps reported on what could be assessed\.\*/);
});

test("an ordinary round's report carries none of the final-round sections", () => {
  const text = chatReport(round(2, answer()));
  assert.doesNotMatch(text, /Shipping unfixed|What actually landed|known gaps/);
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
