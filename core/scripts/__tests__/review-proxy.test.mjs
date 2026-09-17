// SYNCED FROM AI-Handbook — do not edit in a consumer repo.
/**
 * The review proxy's tests.
 *
 * The property under test throughout: **an answer the builder executes without
 * re-weighing must not be able to be incoherent.** A schema cannot say "a
 * decline may not carry a fix" or "a finish may not leave a question for
 * David", and those are exactly the shapes that would do damage, because the
 * builder acts on them. So the semantic checks are tested as behaviour, one
 * test per rule, with the real shipped schema rather than a fixture -- the
 * lesson from #109 round 4, where every fixture built the report shape by hand
 * and a real read that the renderer could not consume shipped past 23 green
 * tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ROLE,
  SANDBOX,
  TIERS,
  MAX_NOTE_CHARS,
  briefPath,
  schemaPath,
  answerPath,
  prepareAnswerPath,
  proxyBrief,
  validateAnswer,
  readAnswer,
  dispositions,
  prComment,
  dispatch,
  parseArgs,
  USAGE,
} from "../review-proxy.mjs";

const PR = 120;
const COMMIT = "abc1234";
const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "proxy-"));

const finding = (over = {}) => ({ id: "c1", body: "The flag could be mistyped.", author: "codex", path: "a.mjs", line: 3, ...over });

const brief = (over = {}) =>
  proxyBrief({
    pr: PR,
    round: 1,
    tier: "internal",
    reviewedCommit: COMMIT,
    oracle: "ORACLE-TEXT: stop the builder writing for every finding.",
    findings: [finding()],
    ...over,
  });

const disposition = (over = {}) => ({ id: "c1", disposition: "decline", worth: "Nobody would feel it.", correction: "", acceptance_check: "", ...over });

const answer = (over = {}) => ({
  outcome: "finish",
  should_this_exist: "Yes",
  should_this_exist_reason: "It removes a measured failure.",
  next_action: "Merge on this head.",
  findings: [disposition()],
  batch_assessment: "One finding, repairing rather than growing.",
  product_decisions_for_david: [],
  verified_claims: ["Read a.mjs:3 and the flag is the operator's own."],
  unable_to_verify: [],
  summary_for_david: "One finding. Not worth a round. Nothing needed from you.",
  reviewed_commit: COMMIT,
  ...over,
});

const question = { question: "Should this ship narrower?", options: ["Ship as is", "Narrow it"], recommendation: "Ship as is." };

const writeDisp = (over = {}) =>
  disposition({ disposition: "write", correction: "Derive the value instead of taking it.", acceptance_check: "The flag no longer appears in the signature.", ...over });

function writeAndRead(root, pr, round, a, opts = {}) {
  const file = prepareAnswerPath(root, pr, round);
  fs.writeFileSync(file, JSON.stringify(a));
  return readAnswer(root, pr, round, opts);
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

test("the role brief reaches the model verbatim, so the instruction David reviews is the one that runs", () => {
  // David's first named requirement on #96 is the prompt itself: he reads it,
  // not a description of it. A brief assembled in the script would make the
  // file he reviewed a document about the real instruction rather than it.
  const onDisk = fs.readFileSync(briefPath(), "utf8").trim();
  assert.ok(brief().startsWith(onDisk));
  assert.ok(onDisk.includes("You are David's step-back"));
});

test("an oracle is required, because it is agreed before the loop starts and never derived from the PR", () => {
  // David, 2026-09-17: "We should officially agree on an oracle before any
  // round starts." Refusing here is what makes that happen before the loop
  // rather than being noticed after it. The PR body is the builder's own
  // prose and may never stand in for it (#39 gap 3).
  for (const bad of [undefined, "", "   "]) {
    assert.throws(() => brief({ oracle: bad }), /oracle is required and must be agreed with David/);
  }
  assert.match(brief(), /ORACLE-TEXT/);
  assert.match(brief(), /\[oracle\] What this work is for/);
});

test("the tier selects a rubric that actually reaches the model, never just a validated label", () => {
  // `plan-review.mjs` paid for this on #102 round 1: a tier that is validated,
  // pinned and logged while never reaching the reviewer selects nothing, and
  // all three tiers generate the same instructions.
  const seen = new Set();
  for (const tier of TIERS) {
    const text = brief({ tier });
    assert.match(text, new RegExp(`\\*\\*Tier: ${tier}\\.\\*\\*`));
    seen.add(text);
  }
  assert.equal(seen.size, TIERS.length, "two tiers produced identical prompts");
  assert.throws(() => brief({ tier: "trivial" }), /tier must be one of/);
  assert.match(brief({ tier: "internal" }), /expect most of this\nround to be declines/);
});

test("findings need stable unique ids, because the ids key the answer back to the round", () => {
  assert.throws(() => brief({ findings: [finding({ id: "" })] }), /stable id/);
  assert.throws(() => brief({ findings: [finding(), finding()] }), /appears twice/);
  assert.match(brief(), /### Finding `c1`/);
});

test("the proxy is dispatched on a round that returned findings, and refuses an empty one", () => {
  // The trigger is a moment, not a count: every round that RETURNS findings,
  // before anything is written for them. A dispatch with none is a caller bug.
  assert.throws(() => brief({ findings: [] }), /RETURNED findings/);
});

test("every history entry is labelled, and the labels reach the model", () => {
  // The old adjudicator excluded the builder's reasoning entirely -- the
  // "untouchable context" doctrine David retired -- and so judged rounds whose
  // argument it could not see. The correction is labelling, not exclusion.
  const text = brief({
    history: [
      { label: "David", text: "Astra for the proxy." },
      { label: "reviewer", text: "Raised this in round 1." },
    ],
  });
  assert.match(text, /\*\*\[David\]\*\* Astra for the proxy\./);
  assert.match(text, /\*\*\[reviewer\]\*\* Raised this in round 1\./);
  assert.throws(() => brief({ history: [{ label: "codex", text: "x" }] }), /carries a label from/);
});

test("the builder's note is capped, so the judged party's framing cannot fill the prompt", () => {
  // A bound on proportion, not a defence: the builder writing the note is the
  // same party that would remove the cap. The plan runner caps disposition
  // notes for the same reason.
  const long = "x".repeat(MAX_NOTE_CHARS * 2);
  const text = brief({ builderNote: long });
  assert.ok(!text.includes(long));
  assert.match(text, /x{10}…/);
  assert.match(brief(), /\(the builder supplied no note\)/);
});

// ---------------------------------------------------------------------------
// The answer, and what a schema cannot say
// ---------------------------------------------------------------------------

test("validateAnswer runs against the REAL shipped schema, so the brief and the schema cannot drift", () => {
  assert.deepEqual(validateAnswer(answer()), []);
  const shipped = JSON.parse(fs.readFileSync(schemaPath(), "utf8"));
  for (const key of shipped.required) {
    const { [key]: _dropped, ...without } = answer();
    assert.ok(validateAnswer(without).length > 0, `an answer missing ${key} was accepted`);
  }
});

test("every finding raised this round gets a disposition, and no others", () => {
  // The builder executes dispositions. A finding with none is silently
  // dropped: the reviewer raised it, nobody ruled, and nothing says so.
  assert.deepEqual(validateAnswer(answer(), { findingIds: ["c1"] }), []);
  assert.ok(validateAnswer(answer(), { findingIds: ["c1", "c2"] }).some((p) => /"c2" was raised this round and has no disposition/.test(p)));
  assert.ok(validateAnswer(answer({ findings: [disposition({ id: "c9" })] }), { findingIds: ["c1"] }).some((p) => /"c9" was not in this round/.test(p)));
  assert.ok(validateAnswer(answer({ findings: [disposition(), disposition()] })).some((p) => /dispositioned twice/.test(p)));
});

test("a write carries a correction and an observable acceptance check, or it is a wish", () => {
  assert.deepEqual(validateAnswer(answer({ outcome: "write", findings: [writeDisp()] })), []);
  assert.ok(validateAnswer(answer({ outcome: "write", findings: [writeDisp({ correction: "" })] })).some((p) => /no correction/.test(p)));
  assert.ok(validateAnswer(answer({ outcome: "write", findings: [writeDisp({ acceptance_check: " " })] })).some((p) => /no acceptance check/.test(p)));
});

test("a decline carrying a fix is refused, because the builder would read the fix and write it", () => {
  // This is the failure being removed, wearing a decline's clothes: a
  // disposition that says "not worth it" while handing over the patch.
  for (const d of ["decline", "no_change_needed", "to_david"]) {
    const problems = validateAnswer(answer({ findings: [disposition({ disposition: d, correction: "just add a check" })] }));
    assert.ok(problems.some((p) => /carries a correction or acceptance check/.test(p)), d);
  }
});

test("a finish cannot leave a fix unwritten or a question unanswered", () => {
  // A clean reviewer round never erases an outstanding human decision.
  assert.ok(validateAnswer(answer({ outcome: "finish", findings: [writeDisp()] })).some((p) => /still to write/.test(p)));
  assert.ok(
    validateAnswer(answer({ outcome: "finish", product_decisions_for_david: [question] })).some((p) => /unanswered question/.test(p)),
  );
});

test("each outcome must be backed by the findings it claims", () => {
  assert.ok(validateAnswer(answer({ outcome: "write" })).some((p) => /no finding is dispositioned "write"/.test(p)));
  assert.ok(validateAnswer(answer({ outcome: "ask_david" })).some((p) => /no question is recorded/.test(p)));
  // A finding parked with David and no question is a finding nobody holds.
  assert.ok(
    validateAnswer(answer({ outcome: "ask_david", findings: [disposition({ disposition: "to_david" })] })).some((p) =>
      /sent to David but no question/.test(p),
    ),
  );
  assert.deepEqual(
    validateAnswer(answer({ outcome: "ask_david", findings: [disposition({ disposition: "to_david" })], product_decisions_for_david: [question] })),
    [],
  );
});

test("an answer that names a different commit than the round judged is refused", () => {
  // A false premise produces a confidently wrong verdict, and this one is
  // checkable: the answer says which head it read.
  assert.ok(validateAnswer(answer(), { reviewedCommit: "deadbee" }).some((p) => /but this round judged/.test(p)));
  assert.deepEqual(validateAnswer(answer(), { reviewedCommit: COMMIT }), []);
});

// ---------------------------------------------------------------------------
// Reading and rendering
// ---------------------------------------------------------------------------

test("all three delivery failures are one honest failed state, never a quiet round", () => {
  const root = tmpRoot();
  const missing = readAnswer(root, PR, 7);
  assert.equal(missing.failed, true);
  assert.match(missing.reason, /wrote no answer file/);

  fs.writeFileSync(prepareAnswerPath(root, PR, 8), "{ not json");
  assert.match(readAnswer(root, PR, 8).reason, /not valid JSON/);

  fs.writeFileSync(prepareAnswerPath(root, PR, 9), JSON.stringify({ outcome: "finish" }));
  assert.match(readAnswer(root, PR, 9).reason, /did not match the expected shape/);

  for (const round of [7, 8, 9]) {
    const text = prComment(readAnswer(root, PR, round));
    assert.match(text, /dispatch failed/);
    assert.match(text, /not a report that the round was quiet/);
    assert.doesNotMatch(text, /nothing left to write/);
  }
});

test("a real read feeds the renderer unchanged, and the disposition list is derived from the same answer", () => {
  const root = tmpRoot();
  const result = writeAndRead(root, PR, 1, answer({ outcome: "write", findings: [writeDisp(), disposition({ id: "c2" })] }), {
    findingIds: ["c1", "c2"],
    reviewedCommit: COMMIT,
  });
  assert.equal(result.failed, undefined);
  const d = dispositions(result);
  assert.equal(d.writes.length, 1);
  assert.equal(d.declines.length, 1);
  const text = prComment(result);
  assert.doesNotMatch(text, /undefined/);
  assert.match(text, /write the fixes below/);
});

test("a stale answer is cleared, so a re-dispatch can never be read as its predecessor", () => {
  const root = tmpRoot();
  fs.writeFileSync(prepareAnswerPath(root, PR, 1), JSON.stringify(answer({ summary_for_david: "OLD" })));
  const file = prepareAnswerPath(root, PR, 1);
  assert.equal(fs.existsSync(file), false);
  // And the answer directory is kept ignored: an answer is a session artifact.
  assert.match(fs.readFileSync(path.join(root, ".agents", "reviews", ".gitignore"), "utf8"), /\*/);
});

test("every decline is printed in full, never folded into a count", () => {
  // A decline is the proxy overruling the reviewer on David's behalf, and he
  // asked to see what is being chosen against rather than how many.
  const root = tmpRoot();
  const result = writeAndRead(
    root,
    PR,
    2,
    answer({ findings: [disposition({ id: "c1", worth: "WORTH-ONE" }), disposition({ id: "c2", worth: "WORTH-TWO" })] }),
  );
  const text = prComment(result);
  assert.match(text, /Shipping as recorded gaps \(2\)/);
  assert.ok(text.includes("WORTH-ONE"));
  assert.ok(text.includes("WORTH-TWO"));
});

test("the comment is composed from the answer's own fields, never paraphrased", () => {
  const a = answer({ outcome: "ask_david", findings: [disposition({ disposition: "to_david" })], product_decisions_for_david: [question] });
  const text = prComment({ pr: PR, round: 3, answer: a });
  for (const verbatim of [a.summary_for_david, a.should_this_exist_reason, a.next_action, a.batch_assessment, a.findings[0].worth, question.question, question.recommendation, ...question.options, ...a.verified_claims]) {
    assert.ok(text.includes(verbatim), `missing verbatim: ${verbatim}`);
  }
  assert.match(text, /David has to decide before this goes further/);
});

test("an empty verification list renders as its own explicit result", () => {
  // The same rule the round report follows: David must be able to tell "it
  // checked nothing" from "the field was never written".
  const text = prComment({ pr: PR, round: 1, answer: answer({ verified_claims: [], unable_to_verify: [] }) });
  assert.match(text, /Verified: nothing recorded/);
  assert.match(text, /Unable to verify: nothing reported/);
});

// ---------------------------------------------------------------------------
// The dispatch
// ---------------------------------------------------------------------------

test("the sandbox is read-only and no flag relaxes it", () => {
  // The plan runner permits workspace-write under `--unpinned`. This reviews
  // the LIVE checkout, so it must not copy that escape hatch.
  assert.equal(SANDBOX, "read-only");
  assert.throws(() => parseArgs(["--sandbox", "workspace-write"]), /unknown flag/);
  assert.throws(() => parseArgs(["--unpinned", "because"]), /unknown flag/);
  assert.doesNotMatch(USAGE, /--sandbox|--unpinned/);

  const root = tmpRoot();
  const calls = [];
  const run = (bin, args) => {
    calls.push({ bin, args });
    return args[0] === "login" ? { status: 0, stdout: "Logged in using ChatGPT", stderr: "" } : { status: 0 };
  };
  const result = dispatch({ root, pr: PR, round: 1, prompt: "x", run });
  const exec = calls.find((c) => c.args[0] === "exec");
  assert.equal(exec.args[exec.args.indexOf("--sandbox") + 1], "read-only");
  // The pinned reviewer, and the flags that make the schema binding.
  assert.equal(exec.args[exec.args.indexOf("--model") + 1], result.reviewer.id);
  for (const flag of ["--ignore-user-config", "--ephemeral", "--output-schema", "--output-last-message"]) {
    assert.ok(exec.args.includes(flag), `missing ${flag}`);
  }
  assert.ok(exec.args[exec.args.indexOf("--output-schema") + 1].endsWith(`${ROLE}.schema.json`));
});

test("no sign-in is reported as no sign-in, and never as a round that found nothing", () => {
  // A reviewer that cannot run is never permission to ship.
  const run = (_bin, args) => (args[0] === "login" ? { status: 1, stdout: "Not logged in", stderr: "" } : { status: 0 });
  const result = dispatch({ root: tmpRoot(), pr: PR, round: 1, prompt: "x", run });
  assert.equal(result.ok, false);
  assert.equal(result.signIn, true);
  assert.match(result.instructions, /No ChatGPT sign-in/);
});

test("the CLI refuses an unknown flag or a flag with no value rather than guessing", () => {
  assert.throws(() => parseArgs(["--pr"]), /needs a value/);
  assert.throws(() => parseArgs(["--pr", "--round"]), /needs a value/);
  assert.throws(() => parseArgs(["--nope", "1"]), /unknown flag/);
  assert.throws(() => parseArgs(["pr", "1"]), /unexpected argument/);
  assert.deepEqual(parseArgs(["--pr", "120", "--round", "2", "--tier", "internal"]), { pr: 120, round: 2, tier: "internal" });
});
