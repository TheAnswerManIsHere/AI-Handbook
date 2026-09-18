// SYNCED FROM AI-Handbook — do not edit in a consumer repo.
/**
 * The review proxy's tests, rewritten for the advisory model (#96, 2026-09-17).
 *
 * WHAT THE OLD SUITE TESTED AND WHY IT IS GONE. It asserted that a JSON answer
 * could not be internally incoherent -- a decline carrying a fix, a "finish"
 * leaving a question unanswered, an outcome contradicting its dispositions.
 * Those tests were correct about the design they guarded, and the design is
 * replaced: nothing is binding, nothing is parsed, and the assessment is prose.
 * Three consecutive rounds each found a new way for that JSON to contradict
 * itself, which is what a validator built by enumerating forbidden combinations
 * does. Removing the field removed the class.
 *
 * WHAT THIS SUITE TESTS INSTEAD. The properties the oracle actually names: both
 * assessors get the same package; the instructions David reviewed are the ones
 * that run; the assessment reaches him unedited; the dispatch refuses to assess
 * a revision the checkout is not at; a follow-up costs no commit and no review
 * round; and nothing an assessor writes can authorise work.
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
  ACTIONS,
  SOURCES,
  MAX_NOTE_CHARS,
  briefPath,
  judgmentPath,
  assessmentPath,
  prepareAssessmentPath,
  assertCheckout,
  identityBlock,
  INVOCATION,
  assessmentBrief,
  followUpBrief,
  readAssessment,
  prComment,
  actionBlock,
  dispatch,
  parseArgs,
  main,
  USAGE,
} from "../review-proxy.mjs";

const PR = 120;
const COMMIT = "f1c89d2";
const FULL = "f1c89d2ba3e1487457c8c30f9a8b6c66814845f2";
const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "proxy-"));

const finding = (over = {}) => ({ id: "c1", body: "The flag could be mistyped.", path: "a.mjs", line: 3, ...over });

const brief = (over = {}) =>
  assessmentBrief({
    pr: PR,
    round: 1,
    tier: "internal",
    reviewedCommit: COMMIT,
    oracle: "ORACLE-TEXT: judgement, by more than one mind, that David can follow.",
    findings: [finding()],
    ...over,
  });

const followUp = (over = {}) =>
  followUpBrief({
    pr: PR,
    round: 1,
    tier: "internal",
    reviewedCommit: COMMIT,
    oracle: "ORACLE-TEXT: judgement, by more than one mind, that David can follow.",
    findings: [finding()],
    findingIds: ["c1"],
    question: "Does the scope of the correction change given the new evidence?",
    priorAssessment: "PRIOR-ASSESSMENT-TEXT",
    ...over,
  });

/** A git that reports a clean checkout at the commit under assessment. */
const cleanGit = (head = FULL) => (args) => {
  if (args[0] === "rev-parse") return { status: 0, stdout: `${head}\n`, stderr: "" };
  if (args[0] === "status") return { status: 0, stdout: "", stderr: "" };
  throw new Error(`unexpected git ${args.join(" ")}`);
};

// ---------------------------------------------------------------------------
// The package both assessors receive
// ---------------------------------------------------------------------------

test("the brief and the Worth rule reach the model verbatim from their files", () => {
  // David's first named requirement is the prompt itself: he reads it, not a
  // description of it. A brief assembled in the script would make the file he
  // reviewed a document ABOUT the real instruction rather than it.
  const text = brief();
  assert.ok(text.startsWith(fs.readFileSync(briefPath(), "utf8").trim()));
  const judgment = fs.readFileSync(judgmentPath(), "utf8").replace(/^<!--[\s\S]*?-->\s*/, "").trim();
  assert.ok(text.includes(judgment), "the Worth rule is not quoted verbatim");
  // And it is quoted from the ONE file, so the rule cannot drift between the
  // two assessors and the contracts that point at it.
  assert.ok(judgmentPath().endsWith(path.join("docs", "ai-context", "review-judgment.md")));
});

test("the package carries no quota in either direction", () => {
  // The whole redesign: the old rubric told the assessor to decline most
  // findings, which is the mirror image of the builder fixing everything.
  const text = brief();
  assert.doesNotMatch(text, /expect most of this round to be declines/i);
  assert.doesNotMatch(text, /very high chance of a CRITICAL flaw/i);
  // The phrase wraps across lines in both source files, so the assertion has
  // to tolerate a newline where a reader sees a space.
  assert.match(text, /no\s+target\s+acceptance\s+rate\s+or\s+decline\s+rate/i);
  assert.match(text, /no\s+target\s+rate\s+of\s+accepting\s+or\s+declining/i);
});

test("an oracle is required, because it is agreed before the loop starts and never taken from the PR", () => {
  for (const bad of [undefined, "", "   "]) {
    assert.throws(() => brief({ oracle: bad }), /oracle is required and must be agreed with David/);
  }
  assert.match(brief(), /ORACLE-TEXT/);
  assert.match(brief(), /\[oracle\] The outcome this work is meant to achieve/);
});

test("the tier tells the assessor what is downstream, and never sets a threshold", () => {
  // `plan-review.mjs` paid for the first half on #102 round 1: a tier that is
  // validated, pinned and logged while never reaching the assessor selects
  // nothing. The second half is this redesign: it is a lens, not a rubric.
  const seen = new Set();
  for (const tier of TIERS) {
    const text = brief({ tier });
    assert.match(text, /\*\*What is downstream/);
    seen.add(text);
  }
  assert.equal(seen.size, TIERS.length, "two tiers produced identical packages");
  assert.throws(() => brief({ tier: "trivial" }), /tier must be one of/);
  assert.match(brief({ tier: "sensitive" }), /This does not make every finding in these areas worthwhile/);
});

test("a GitHub comment id is a number, and the composer takes it as one", () => {
  // `get_review_comments` returns integer ids and JSON keeps them integers.
  // (Codex, #120 round 1.)
  assert.match(brief({ findings: [finding({ id: 4033623440 })] }), /### Finding `4033623440`/);
  assert.throws(() => brief({ findings: [finding({ id: 7 }), finding({ id: "7" })] }), /appears twice/);
  for (const bad of [null, undefined, "", "  "]) {
    assert.throws(() => brief({ findings: [finding({ id: bad })] }), /stable id/);
  }
});

test("the assessors are dispatched on a round that returned findings", () => {
  assert.throws(() => brief({ findings: [] }), /RETURNED findings/);
});

test("history is labelled by who said it, including both assessors", () => {
  const text = brief({
    history: [
      { label: "David", text: "Astra advises; Fable can settle a technical tie." },
      { label: "astra", text: "Recommended a narrower correction in round 1." },
    ],
  });
  assert.match(text, /\*\*\[David\]\*\* Astra advises/);
  assert.match(text, /\*\*\[astra\]\*\* Recommended a narrower correction/);
  assert.throws(() => brief({ history: [{ label: "codex", text: "x" }] }), /carries a label from/);
});

test("the builder's note is capped, so the assessed party's framing cannot fill the package", () => {
  const long = "x".repeat(MAX_NOTE_CHARS * 2);
  assert.ok(!brief({ builderNote: long }).includes(long));
  assert.match(brief({ builderNote: long }), /x{10}…/);
  assert.match(brief(), /\(the builder supplied no note\)/);
});

test("both assessors get the same brief, Worth rule and round, differing only in who they are", () => {
  // Independence is only meaningful over a common factual basis. A difference
  // between the two answers has to be a difference of judgement, so everything
  // except the identity block is byte-identical -- and that block exists
  // because the brief cannot both stay generic and tell each reader which of
  // them holds the tie-break.
  const args = { tier: "product", history: [{ label: "oracle", text: "Ship the thing." }], builderNote: "Round 1." };
  const astra = brief({ ...args, source: "astra" });
  const fable = brief({ ...args, source: "fable" });
  assert.notEqual(astra, fable, "the two packages are identical, so neither reader is told which role it holds");
  assert.equal(
    astra.replace(identityBlock("astra"), ""),
    fable.replace(identityBlock("fable"), ""),
    "the packages differ somewhere other than the identity block",
  );
  assert.equal(brief({ ...args, source: "astra" }), astra, "the same source composed twice differs");
  // Default to Astra: the Codex CLI path is the one the script runs itself.
  assert.equal(brief(args), astra);
});

test("each assessor is told who it is, who the other is, and which of them settles a technical tie", () => {
  // The defect this replaces: Astra's brief went to the Fable subagent
  // unchanged, so it read that it discussed with Fable and that Fable settled
  // ties -- a role talking to itself about a third party that is also itself.
  const astra = identityBlock("astra");
  assert.match(astra, /\*\*You are Astra\*\*/);
  assert.match(astra, /\*\*The other assessor is the Fable assessor\*\*/);
  assert.match(astra, /\*\*The tie-break is the Fable assessor's\*\*, not yours/);

  const fable = identityBlock("fable");
  assert.match(fable, /\*\*You are the Fable assessor\*\*/);
  assert.match(fable, /\*\*The other assessor is Astra\*\*/);
  assert.match(fable, /\*\*The tie-break is yours\*\*/);

  for (const block of [astra, fable]) {
    assert.match(block, /Neither of you sees the other's assessment/);
    assert.match(block, /Neither of you can settle anything reserved for David/);
  }
  assert.throws(() => identityBlock("codex"), /source must be one of/);
});

test("the brief itself names no role, so one file serves both readers", () => {
  // The brief says "the other assessor" throughout. A role name left in it
  // would be wrong for exactly one of the two, silently.
  const text = fs.readFileSync(briefPath(), "utf8");
  assert.doesNotMatch(text, /Astra|Fable/, "the shared brief names a specific assessor");
  assert.match(brief({ source: "fable" }), /the other\nassessor|the other assessor/);
});

test("a follow-up names the other assessor correctly for whoever is reading it", () => {
  assert.match(followUp({ source: "astra", fableReasoning: "X" }), /\[fable\] The other assessor's reasoning/);
  assert.match(followUp({ source: "fable", fableReasoning: "X" }), /\[astra\] The other assessor's reasoning/);
  assert.ok(followUp({ source: "fable" }).includes(identityBlock("fable")));
});

// ---------------------------------------------------------------------------
// Assessing the revision that was actually reviewed
// ---------------------------------------------------------------------------

test("the dispatch refuses unless the checkout is at the reviewed commit and clean", () => {
  // Both assessors read the live tree while the package names a commit. Until
  // this existed, a delayed webhook or an earlier push meant advice about code
  // the reviewer never saw, with the requested revision named back as though it
  // had been read. (Codex, #120 round 2.)
  const root = tmpRoot();
  assert.equal(assertCheckout(root, COMMIT, { git: cleanGit() }), FULL);
  assert.equal(assertCheckout(root, FULL, { git: cleanGit() }), FULL, "a full sha matches itself");

  assert.throws(
    () => assertCheckout(root, "deadbee", { git: cleanGit() }),
    /the checkout is at f1c89d2ba3 but this assessment is of deadbee/,
  );
  const dirty = (args) =>
    args[0] === "rev-parse" ? { status: 0, stdout: `${FULL}\n` } : { status: 0, stdout: " M core/scripts/review-proxy.mjs\n" };
  assert.throws(() => assertCheckout(root, COMMIT, { git: dirty }), /uncommitted changes/);
  const broken = () => ({ status: 128, stdout: "", stderr: "not a git repository" });
  assert.throws(() => assertCheckout(root, COMMIT, { git: broken }), /cannot read HEAD/);
});

test("a refused checkout stops the dispatch before the reviewer is ever started", () => {
  const calls = [];
  const run = (bin, args) => {
    calls.push(args[0]);
    return { status: 0, stdout: "Logged in using ChatGPT" };
  };
  assert.throws(
    () => dispatch({ root: tmpRoot(), pr: PR, round: 1, prompt: "x", reviewedCommit: "deadbee", run, git: cleanGit() }),
    /this assessment is of deadbee/,
  );
  assert.deepEqual(calls, [], "the reviewer was started for a revision the checkout is not at");
});

// ---------------------------------------------------------------------------
// The focused follow-up
// ---------------------------------------------------------------------------

test("a follow-up runs on the same revision, with no new commit and no new review round", () => {
  // The property the design turns on: a disagreement about reasoning costs one
  // question, not a round trip through the whole loop.
  const text = followUp();
  assert.match(text, /no new code has been written/);
  assert.match(text, /Reviewed commit:\*\* `f1c89d2`/);
  assert.match(text, /This is not a new assessment/);
  assert.ok(text.includes("PRIOR-ASSESSMENT-TEXT"), "the earlier assessment is quoted, so nothing must be remembered");
});

test("a follow-up preserves everything it does not ask about", () => {
  // A narrow follow-up that silently cleared an unresolved question would be
  // worse than no follow-up, because it would look like agreement.
  assert.match(followUp(), /Everything you are not asked about keeps the status\nit already has/);
  assert.match(followUp(), /decisions waiting on David/);
});

test("a follow-up names the dispute, and refuses to be composed without one", () => {
  assert.match(followUp(), /Findings in dispute:\*\* `c1`/);
  assert.match(followUp({ fableReasoning: "FABLE-SAYS" }), /\[fable\] The other assessor's reasoning/);
  for (const bad of [{ question: "" }, { priorAssessment: "  " }]) {
    assert.throws(() => followUp(bad), /a follow-up needs/);
  }
  assert.throws(() => followUp({ findingIds: [] }), /names the finding IDs in dispute/);
});

test("a follow-up carries the same brief and Worth rule as the assessment it revisits", () => {
  assert.ok(followUp().startsWith(fs.readFileSync(briefPath(), "utf8").trim()));
});

test("a follow-up refuses unless every disputed finding has text behind its id", () => {
  // The round-4 commit CLAIMED this guarantee and enforced only the oracle half,
  // so the advertised command composed a package naming ids with no bodies. The
  // assessor would revise a recommendation about a finding it had never read,
  // and the posted answer would look like any other. (Codex, #120 round 5.)
  assert.throws(() => followUp({ findings: [] }), /c1 had no entry with text/);
  assert.throws(() => followUp({ findings: undefined }), /c1 had no entry with text/);
  assert.throws(
    () => followUp({ findings: [finding({ id: "other" })] }),
    /carries the body of every finding in dispute; c1/,
  );
  // Present but empty is the same defect wearing a hat.
  assert.throws(() => followUp({ findings: [finding({ body: "   " })] }), /c1 had no entry with text/);
  // Two disputed, one supplied: the error names the one that is missing.
  assert.throws(
    () => followUp({ findingIds: ["c1", "c2"], findings: [finding()] }),
    /dispute; c2 had no entry/,
  );
  // And the CLI cannot route around the composer.
  assert.doesNotMatch(USAGE, /\[--findings-file/, "the follow-up still advertises the flag as optional");
});

test("the invocation in the usage text is computed, so it is right in both layouts", () => {
  // The sync routes `core/X -> X`, so a literal path is wrong in one of the two
  // repos — and it prints on every argument error, telling an operator who just
  // mistyped a flag to run a file that is not there. (Codex, #120 round 5.)
  // The property is that the path is DERIVED, not that it has a given value:
  // in this repo the correct derived value happens to be `core/scripts/...`,
  // and in a consumer it is `scripts/...`. Asserting either literal would be
  // the defect under test.
  assert.ok(INVOCATION.endsWith("scripts/review-proxy.mjs"), INVOCATION);
  assert.ok(!path.isAbsolute(INVOCATION), "the invocation must be repo-relative");
  assert.ok(USAGE.includes(`node ${INVOCATION} --pr`), "the usage text does not use the computed invocation");
  assert.ok(USAGE.includes(`node ${INVOCATION} --pr <n> --round <n> --commit <sha> --tier <t> --follow-up`));
});

test("a follow-up carries the oracle, the tier and the disputed findings, because the process is ephemeral", () => {
  // `codex exec --ephemeral` starts cold, and the prior assessment cannot stand
  // in for the package: the brief tells its author NOT to restate the revision
  // or the finding list, so the one document quoted back is the one guaranteed
  // to omit them. Without this a follow-up revises a recommendation against no
  // agreed intent. (Codex, #120 round 3.)
  const text = followUp();
  assert.match(text, /ORACLE-TEXT/);
  assert.match(text, /\*\*What is downstream/, "the tier lens is missing");
  assert.match(text, /### Finding `c1`/);
  assert.ok(text.includes("The flag could be mistyped."), "the disputed finding's body is missing");

  for (const bad of [undefined, "", "   "]) {
    assert.throws(() => followUp({ oracle: bad }), /carries the same oracle as the assessment/);
  }
  assert.throws(() => followUp({ tier: "trivial" }), /tier must be one of/);

  // Only the findings in dispute, so a follow-up stays focused.
  const two = followUp({ findings: [finding(), finding({ id: "c2", body: "A SECOND FINDING BODY" })] });
  assert.doesNotMatch(two, /A SECOND FINDING BODY/, "a finding not in dispute was carried in");
});

test("--prompt-only clears the destination and verifies the checkout, exactly as a dispatch does", () => {
  // The branch "only prints", which reads as harmless and is not. It emits a
  // package telling its reader the tree is at the reviewed commit and clean,
  // and it names a file a subagent will write. Clearing nothing lets a retried
  // dispatch post its predecessor's assessment under the new header; checking
  // nothing makes the package's own sentence a claim of success by something
  // that evaluated nothing. (Codex, #120 rounds 3 and 4.)
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-in-"));
  const write = (name, value) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    return file;
  };
  const argv = (...extra) => [
    "--pr", String(PR), "--round", "1", "--commit", COMMIT, "--tier", "internal",
    "--source", "fable", "--prompt-only",
    "--oracle-file", write("o.md", "ORACLE-FROM-FILE"),
    "--findings-file", write("f.json", [{ id: "c1", body: "b" }]),
    ...extra,
  ];
  const stale = prepareAssessmentPath(root, PR, 1, { source: "fable" });
  fs.writeFileSync(stale, "A PREVIOUS ATTEMPT'S ASSESSMENT");
  assert.equal(readAssessment(root, PR, 1, { source: "fable" }).markdown, "A PREVIOUS ATTEMPT'S ASSESSMENT");

  const stdout = process.stdout.write;
  process.stdout.write = () => true;
  try {
    assert.equal(main(argv(), { root, run: () => ({ status: 0 }), git: cleanGit(), log: () => {} }), 0);
  } finally {
    process.stdout.write = stdout;
  }
  // The retry's subagent dies before writing: the read must report a failure,
  // never the predecessor.
  const after = readAssessment(root, PR, 1, { source: "fable" });
  assert.equal(after.failed, true, "a stale assessment survived and would be posted as fresh");
  assert.match(after.reason, /wrote no assessment file/);

  // And the checkout is verified before the package is emitted.
  let logged = "";
  assert.equal(
    main(argv(), { root, run: () => ({ status: 0 }), git: cleanGit("0000000000abcdef"), log: (m) => (logged += m) }),
    2,
  );
  assert.match(logged, /the checkout is at 0000000000 but this assessment is of f1c89d2/);
});

// ---------------------------------------------------------------------------
// Reading, presenting, and who authorises what
// ---------------------------------------------------------------------------

test("each assessment has its own path, keyed by source and follow-up", () => {
  assert.ok(assessmentPath("/r", PR, 2, { source: "astra" }).endsWith(path.join("pr-120", "round-2.astra.md")));
  assert.ok(assessmentPath("/r", PR, 2, { source: "fable" }).endsWith(path.join("pr-120", "round-2.fable.md")));
  assert.ok(assessmentPath("/r", PR, 2, { source: "astra", followUp: 1 }).endsWith("round-2.astra.followup-1.md"));
  assert.throws(() => assessmentPath("/r", PR, 2, { source: "codex" }), /source must be one of/);
  for (const bad of ["12x", 0, -1, 1.5, null]) {
    assert.throws(() => assessmentPath("/r", bad, 1, { source: "astra" }), /pr must be a positive integer/);
    assert.throws(() => assessmentPath("/r", PR, bad, { source: "astra" }), /round must be a positive integer/);
  }
});

test("a missing or empty assessment is a failed dispatch in plain words, never a quiet round", () => {
  const root = tmpRoot();
  const missing = readAssessment(root, PR, 7, { source: "astra" });
  assert.equal(missing.failed, true);
  assert.match(missing.reason, /wrote no assessment file/);

  fs.writeFileSync(prepareAssessmentPath(root, PR, 8, { source: "fable" }), "   \n");
  const empty = readAssessment(root, PR, 8, { source: "fable" });
  assert.match(empty.reason, /wrote an empty assessment file/);

  for (const r of [missing, empty]) {
    const text = prComment(r);
    assert.match(text, /dispatch failed/);
    assert.match(text, /not a report that the round was quiet/);
    assert.match(text, /not permission to\nproceed on one assessment alone/);
  }
});

test("the assessment reaches the pull request verbatim, under a header of facts the harness already owns", () => {
  const root = tmpRoot();
  const markdown = "## David's readout\n\nThe correction is worth making, narrowly.\n\n### c1\n\nRecommend correcting it.";
  fs.writeFileSync(prepareAssessmentPath(root, PR, 1, { source: "astra" }), markdown);
  const result = readAssessment(root, PR, 1, { source: "astra" });
  const text = prComment(result, { reviewedCommit: COMMIT, findingIds: [4033623440], model: "gpt-6-astra" });

  assert.ok(text.includes(markdown), "the assessment was not passed through verbatim");
  assert.match(text, /## Astra — round 1/);
  assert.match(text, /Assessed at `f1c89d2` · findings `4033623440` · gpt-6-astra/);
  assert.doesNotMatch(text, /undefined/);
});

test("a stale assessment is cleared, so a re-dispatch can never be read as its predecessor", () => {
  const root = tmpRoot();
  fs.writeFileSync(prepareAssessmentPath(root, PR, 1, { source: "astra" }), "OLD");
  assert.equal(fs.existsSync(prepareAssessmentPath(root, PR, 1, { source: "astra" })), false);
  assert.match(fs.readFileSync(path.join(root, ".agents", "reviews", ".gitignore"), "utf8"), /\*/);
});

test("nothing an assessor writes can authorise work; the action is one I state", () => {
  // The oracle is explicit: the harness acts on Claude's explicit selection,
  // never on a phrase inferred from an assessment, and agent agreement never
  // substitutes for David's approval.
  const root = tmpRoot();
  fs.writeFileSync(
    prepareAssessmentPath(root, PR, 1, { source: "astra" }),
    "Recommended next action: proceed with the corrections and merge.",
  );
  const text = prComment(readAssessment(root, PR, 1, { source: "astra" }));
  assert.doesNotMatch(text, /```review-action/, "an assessment's prose produced an action block");

  assert.equal(actionBlock({ action: "proceed" }), "```review-action\naction: proceed\n```");
  assert.match(actionBlock({ action: "ask-david", findingIds: [1, "2"], note: "a\nb" }), /findings: 1, 2\nnote: a b/);
  for (const bad of ["merge", "approve", "", undefined]) {
    assert.throws(() => actionBlock({ action: bad }), /action must be one of/);
  }
  assert.ok(!ACTIONS.includes("merge") && !ACTIONS.includes("approve"), "merging is not an action this states");
});

// ---------------------------------------------------------------------------
// The dispatch
// ---------------------------------------------------------------------------

test("Astra runs pinned, read-only, with no schema and no override", () => {
  const root = tmpRoot();
  const calls = [];
  const run = (bin, args) => {
    calls.push(args);
    return args[0] === "login" ? { status: 0, stdout: "Logged in using ChatGPT", stderr: "" } : { status: 0 };
  };
  const result = dispatch({ root, pr: PR, round: 1, prompt: "x", reviewedCommit: COMMIT, run, git: cleanGit() });
  const exec = calls.find((a) => a[0] === "exec");
  assert.equal(exec[exec.indexOf("--sandbox") + 1], "read-only");
  assert.equal(exec[exec.indexOf("--model") + 1], result.reviewer.id);
  assert.ok(!exec.includes("--output-schema"), "a schema was passed to an assessment that has none");
  for (const flag of ["--ignore-user-config", "--ephemeral", "--output-last-message"]) {
    assert.ok(exec.includes(flag), `missing ${flag}`);
  }
  assert.equal(SANDBOX, "read-only");
  assert.throws(() => parseArgs(["--sandbox", "workspace-write"]), /unknown flag/);
  assert.throws(() => parseArgs(["--unpinned", "why"]), /unknown flag/);
  assert.doesNotMatch(USAGE, /--sandbox|--unpinned/);
});

test("no sign-in is reported as no sign-in, and never as an assessment", () => {
  const run = (_bin, args) => (args[0] === "login" ? { status: 1, stdout: "Not logged in" } : { status: 0 });
  const result = dispatch({ root: tmpRoot(), pr: PR, round: 1, prompt: "x", reviewedCommit: COMMIT, run, git: cleanGit() });
  assert.equal(result.ok, false);
  assert.equal(result.signIn, true);
  assert.match(result.instructions, /No ChatGPT sign-in/);
});

test("a reviewer process that failed is never an accepted assessment, even with a file on disk", () => {
  // `codex exec` can write its last message and then exit non-zero. (Codex,
  // #120 round 1.)
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-in-"));
  const write = (name, value) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    return file;
  };
  const argv = [
    "--pr", String(PR), "--round", "1", "--commit", COMMIT, "--tier", "internal",
    "--oracle-file", write("o.md", "ORACLE"),
    "--findings-file", write("f.json", [{ id: "c1", body: "b" }]),
  ];
  let printed = "";
  const stdout = process.stdout.write;
  process.stdout.write = (chunk) => ((printed += chunk), true);
  try {
    const run = (_bin, args) => {
      if (args[0] === "login") return { status: 0, stdout: "Logged in using ChatGPT" };
      fs.writeFileSync(args[args.indexOf("--output-last-message") + 1], "## A readout that will not be believed");
      return { status: 3 };
    };
    assert.equal(main(argv, { root, run, git: cleanGit(), log: () => {} }), 1);
  } finally {
    process.stdout.write = stdout;
  }
  assert.match(printed, /dispatch failed/);
  assert.match(printed, /exited 3/);
  assert.doesNotMatch(printed, /readout that will not be believed/);
});

test("--prompt-only emits the package without running anything, so the Fable assessor gets the same words", () => {
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-in-"));
  const write = (name, value) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    return file;
  };
  const argv = [
    "--pr", String(PR), "--round", "1", "--commit", COMMIT, "--tier", "internal", "--prompt-only",
    "--oracle-file", write("o.md", "ORACLE-FROM-FILE"),
    "--findings-file", write("f.json", [{ id: "c1", body: "b" }]),
  ];
  let printed = "";
  const stdout = process.stdout.write;
  process.stdout.write = (chunk) => ((printed += chunk), true);
  const calls = [];
  try {
    assert.equal(main(argv, { root, run: (...a) => (calls.push(a), { status: 0 }), git: cleanGit(), log: () => {} }), 0);
  } finally {
    process.stdout.write = stdout;
  }
  assert.deepEqual(calls, [], "--prompt-only started a process");
  assert.match(printed, /ORACLE-FROM-FILE/);
  assert.ok(printed.includes(fs.readFileSync(briefPath(), "utf8").trim()));
});

test("--source picks the identity block and the output path together, or the CLI refuses", () => {
  // The two have to move together. A Fable package naming Astra's file would
  // have the subagent overwrite the answer the script is about to read, and the
  // mismatch would be invisible: both files exist and both hold Markdown.
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-in-"));
  const write = (name, value) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    return file;
  };
  const argv = (...extra) => [
    "--pr", String(PR), "--round", "1", "--commit", COMMIT, "--tier", "internal",
    "--oracle-file", write("o.md", "ORACLE-FROM-FILE"),
    "--findings-file", write("f.json", [{ id: "c1", body: "b" }]),
    ...extra,
  ];
  const capture = (args) => {
    let printed = "";
    const stdout = process.stdout.write;
    process.stdout.write = (chunk) => ((printed += chunk), true);
    let code;
    try {
      code = main(args, { root, run: () => ({ status: 0 }), git: cleanGit(), log: () => {} });
    } finally {
      process.stdout.write = stdout;
    }
    return { code, printed };
  };

  const fable = capture(argv("--source", "fable", "--prompt-only"));
  assert.equal(fable.code, 0);
  assert.ok(fable.printed.includes(identityBlock("fable")), "the fable package carries Astra's identity block");
  assert.match(fable.printed, /round-1\.fable\.md/);
  assert.doesNotMatch(fable.printed, /round-1\.astra\.md/);

  const astra = capture(argv("--prompt-only"));
  assert.match(astra.printed, /round-1\.astra\.md/);

  // The script runs the Codex CLI and nothing else, so a fable dispatch is a
  // request it cannot honour -- refused, rather than silently run as Astra.
  let logged = "";
  assert.equal(main(argv("--source", "fable"), { root, run: () => ({ status: 0 }), git: cleanGit(), log: (m) => (logged += m) }), 2);
  assert.match(logged, /this script does not run; use --prompt-only/);
  assert.match(USAGE, /--source/);
});

test("the CLI drives a whole follow-up, which is the path three rounds of findings walked through", () => {
  // THE GAP THAT PRODUCED THREE ROUNDS. `followUpBrief` was unit-tested as a
  // function while nothing exercised flags -> package -> dispatch -> read ->
  // comment, so each round a reviewer diffed the rich composer against the thin
  // CLI and found a different instance of the same shortfall. This is that path.
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-in-"));
  const write = (name, value) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    return file;
  };
  const argv = [
    "--pr", String(PR), "--round", "6", "--commit", COMMIT, "--tier", "internal",
    "--follow-up", "1", "--findings", "c1",
    "--question", "Does the new evidence change the scope?\n\n    a quoted line\n",
    "--oracle-file", write("o.md", "ORACLE-FROM-FILE"),
    "--findings-file", write("f.json", [finding({ body: "THE DISPUTED BODY" })]),
    "--prior-file", write("prior.md", "PRIOR-ASSESSMENT"),
    "--fable-file", write("fable.md", "THE OTHER ASSESSOR SAID THIS"),
  ];

  let sent = "";
  const run = (_bin, args, opts = {}) => {
    if (args[0] === "login") return { status: 0, stdout: "Logged in using ChatGPT" };
    // The package reaches `codex exec` on stdin, not as a path in argv.
    sent = opts.input ?? "";
    fs.writeFileSync(args[args.indexOf("--output-last-message") + 1], "My recommendation changes, and here is why.");
    return { status: 0 };
  };
  let printed = "";
  let logged = "";
  const stdout = process.stdout.write;
  process.stdout.write = (chunk) => ((printed += chunk), true);
  try {
    assert.equal(main(argv, { root, run, git: cleanGit(), log: (m) => (logged += m) }), 0, logged);
  } finally {
    process.stdout.write = stdout;
  }

  // The answer is read from the follow-up's own path and rendered as one.
  assert.match(printed, /## Astra — round 6, follow-up 1/);
  assert.match(printed, /My recommendation changes, and here is why\./);
  assert.equal(readAssessment(root, PR, 6, { source: "astra", followUp: 1 }).failed, undefined);

  // And the package the process actually received carried every party's words.
  for (const needed of ["ORACLE-FROM-FILE", "THE DISPUTED BODY", "PRIOR-ASSESSMENT", "THE OTHER ASSESSOR SAID THIS"]) {
    assert.ok(sent.includes(needed), `the follow-up package omitted ${needed}`);
  }
  // The question's own structure survives, which is what lets it carry quoted
  // evidence now that there is no separate evidence input.
  assert.ok(sent.includes("    a quoted line"), "the question was flattened");
});

test("a failed follow-up is reported as a failed follow-up, never as a round with no assessment", () => {
  // Restoring the number on the result fixes the heading and leaves the body
  // lying, which is the trap the assessment named. Both are checked here.
  const root = tmpRoot();
  const missing = readAssessment(root, PR, 6, { source: "astra", followUp: 2 });
  assert.equal(missing.failed, true);
  assert.equal(missing.followUp, 2, "the attempt's identity did not survive its failure");

  const text = prComment(missing);
  assert.match(text, /## Astra — round 6, follow-up 2: \*\*dispatch failed\*\*/);
  assert.match(text, /Follow-up 2 to Astra on round 6 produced no answer/);
  assert.match(text, /assessment of the round itself is unaffected and still stands/);
  assert.doesNotMatch(text, /No independent assessment from Astra exists for this round/);

  // A base-round failure still says the round has none, which is true there.
  const base = readAssessment(root, PR, 6, { source: "astra" });
  assert.equal(base.followUp, 0);
  assert.match(prComment(base), /No independent assessment from Astra exists for this round/);
});

test("a follow-up whose PROCESS fails is reported as a failed follow-up, through main()", () => {
  // THE TEST THAT WAS MISSING, and its absence is why round 7 happened. The
  // finding named two failure paths; the fix took one; and the test written for
  // that fix drove `readAssessment` and `prComment` directly, so it was shaped
  // to the fix rather than to the finding and passed while the other path was
  // still wrong. This one goes through `main()` with a process that fails.
  const root = tmpRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-in-"));
  const write = (name, value) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    return file;
  };
  const argv = [
    "--pr", String(PR), "--round", "6", "--commit", COMMIT, "--tier", "internal",
    "--follow-up", "1", "--findings", "c1",
    "--question", "Does the new evidence change the scope?",
    "--oracle-file", write("o.md", "ORACLE"),
    "--findings-file", write("f.json", [finding({ body: "THE DISPUTED BODY" })]),
    "--prior-file", write("prior.md", "PRIOR"),
  ];
  const run = (_bin, args) =>
    args[0] === "login" ? { status: 0, stdout: "Logged in using ChatGPT" } : { status: 3 };

  let printed = "";
  const stdout = process.stdout.write;
  process.stdout.write = (chunk) => ((printed += chunk), true);
  try {
    assert.equal(main(argv, { root, run, git: cleanGit(), log: () => {} }), 1);
  } finally {
    process.stdout.write = stdout;
  }
  assert.match(printed, /## Astra — round 6, follow-up 1: \*\*dispatch failed\*\*/);
  assert.match(printed, /Follow-up 1 to Astra on round 6 produced no answer/);
  assert.match(printed, /exited 3/);
  assert.doesNotMatch(
    printed,
    /No independent assessment from Astra exists for this round/,
    "a failed follow-up is still being reported as a round with no assessment",
  );
});

test("a finding with no body is refused before either assessor is dispatched", () => {
  // The follow-up path got this check in round 5 and the base path did not, so
  // an id with a blank body dispatched both assessors without the reviewer's
  // argument — which neither can recover from the checkout. (Codex, #120 round 7.)
  for (const bad of ["", "   ", null, undefined]) {
    assert.throws(() => brief({ findings: [finding({ body: bad })] }), /has no body/);
  }
  assert.throws(
    () => brief({ findings: [finding(), finding({ id: "c2", body: "" })] }),
    /finding c2 has no body/,
  );
  assert.doesNotThrow(() => brief({ findings: [finding()] }));
});

test("history is refused in the wrong container, the way findings already are", () => {
  // `history.length` on an object is undefined, so a preparation mistake
  // composed a package with no history and no complaint. Neither assessor can
  // notice a section it never saw. (Codex, #120 round 6.)
  assert.throws(() => brief({ history: { label: "David", text: "one entry, not in an array" } }), /history must be an array/);
  assert.throws(() => brief({ history: "David said so" }), /history must be an array/);
  assert.doesNotThrow(() => brief({ history: [] }));
  assert.match(brief({ history: [{ label: "David", text: "SAID THIS" }] }), /\*\*\[David\]\*\* SAID THIS/);
});

test("the CLI refuses an unknown flag or a flag with no value rather than guessing", () => {
  assert.throws(() => parseArgs(["--pr"]), /needs a value/);
  assert.throws(() => parseArgs(["--pr", "--round"]), /needs a value/);
  assert.throws(() => parseArgs(["--nope", "1"]), /unknown flag/);
  assert.throws(() => parseArgs(["pr", "1"]), /unexpected argument/);
  assert.deepEqual(parseArgs(["--pr", "120", "--round", "2", "--prompt-only"]), { pr: 120, round: 2, promptOnly: true });
  assert.deepEqual(SOURCES, ["astra", "fable"]);
  assert.equal(ROLE, "review-proxy");
});
