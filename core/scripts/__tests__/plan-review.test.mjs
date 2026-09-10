// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PLAN_ASSESSMENT_SCHEMA,
  SCOPE_ASSESSMENT_SCHEMA,
  schemaFor,
  assertSchemaSupported,
  validate,
  parseAssessment,
  assertSlug,
  slugFromPlanPath,
  extractFenced,
  oracleFrom,
  normalizePriors,
  readContract,
  stablePrefix,
  roundContext,
  assemblePrompt,
  signInStatus,
  runCodex,
  ensureRoundDir,
  main,
  reconciliationProblems,
  convergence,
  allowanceFor,
  readGrants,
  roundsRun,
  pinOracle,
  ensurePlansIgnored,
  BLOCKING_STATUSES,
  TIER_BUDGETS,
  TIERS,
  LEASH,
  CONTRACT_PATH,
  DISPOSITIONS,
  MAX_NOTE_CHARS,
  DEFAULT_MODEL,
  DEFAULT_EFFORT,
} from "../plan-review.mjs";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "plan-review.mjs");

// ── fixtures ───────────────────────────────────────────────────────────────

/**
 * The shape of a real round, kept in the same order as the schema.
 *
 * Derived from the measured pilot output (the handbook's
 * docs/research/pilot/astra-round1.json, which validates against
 * PLAN_ASSESSMENT_SCHEMA unchanged) rather than invented, but embedded here:
 * this test ships to every consumer, where docs/research/ does not exist.
 */
const assessment = (over = {}) => ({
  review_status: "Substantive technical concerns",
  lens_applied: "authority, bypass, and sync/bootstrap ordering",
  summary_for_david: "It builds the thing. It is nearly safe to approve. Watch the one decision below.",
  what_is_strong: ["The inventory oracles are stated as commands, not claims."],
  required_revisions: [
    {
      id: "R1",
      title: "The always-run rail validates receipts with io:null",
      why_it_matters: "A clean pass never opens the cited record, so the check is bypassable.",
      what_should_change: "Pass a real io on the rail path, or refuse when io is null.",
      acceptance_check: "node --test core/scripts/__tests__/pr-ready.test.mjs covers a null-io rail",
      evidence: ["core/scripts/pr-ready.mjs:1592-1610", "core/scripts/review-budget.mjs:1054"],
      class: "a check satisfiable without the thing it exists to check",
    },
  ],
  product_decisions_for_david: [
    { question: "Preserve PR #10's chain, or repair it?", options: ["Preserve", "Repair"], recommendation: "Repair" },
  ],
  recommended_improvements: [{ title: "Name the cap", what: "State the byte cap", why: "It is checkable" }],
  verified_claims: [{ claim: "loadLoop reads every committed receipt", how_verified: "ran it over .agents/receipts" }],
  unable_to_verify: [{ claim: "the suite passes", why: "the read-only sandbox blocks /tmp" }],
  previous_findings: [{ id: "R2", status: "Resolved", reason: "the plan now reads the definition at head" }],
  ...over,
});

const scopeAssessment = (over = {}) => ({
  review_status: "Scope is right with changes",
  summary_for_david: "It proposes a reviewer that runs here. It is worth building. Decide whether round 0 blocks.",
  should_this_exist: "Yes, but narrower",
  should_this_exist_why: "The transport is the cost; the reviewer is not.",
  scope_assessment: "Now is right. Move the code-review reuse to next.",
  scope_concerns: [
    { id: "S1", title: "No stop condition stated", why_it_matters: "The loop cannot terminate", what_should_change: "State it", evidence: ["issue #66"] },
  ],
  missing_from_scope: [{ title: "Allowance measurement", why: "Unmeasured limit", belongs_in: "next" }],
  product_decisions_for_david: [{ question: "Wait at v1?", options: ["Wait", "Proceed"], recommendation: "Proceed" }],
  verified_claims: [{ claim: "the CLI carries the model", how_verified: "codex --version and the model catalogue" }],
  unable_to_verify: [{ claim: "weekly allowance", why: "not exposed by the CLI" }],
  ...over,
});

const ORACLE = "**Direction.** #66.\n**Product intent.** Move plan review in-session.\n**Must not change.** The code loop.";

/** A throwaway repo root carrying only what the script reads. */
function fixtureRoot({ contractAt = `core/${CONTRACT_PATH}`, plan = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "plan-review-test-"));
  const contract = join(root, contractAt);
  mkdirSync(dirname(contract), { recursive: true });
  writeFileSync(contract, "# Plan-review contract\n");
  if (plan) {
    const abs = join(root, plan.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, plan.text);
  }
  return root;
}

const drop = (root) => rmSync(root, { recursive: true, force: true });

/** A `spawnSync` stand-in: records calls, returns whatever the test scripted. */
function fakeRun(script) {
  const calls = [];
  const run = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    const next = script.shift();
    if (typeof next === "function") return next({ bin, args, opts });
    return next ?? { status: 0, stdout: "", stderr: "" };
  };
  run.calls = calls;
  return run;
}

// ── the schemas ────────────────────────────────────────────────────────────

test("both schemas use only keywords the validator actually enforces", () => {
  // A keyword sent to the model but unchecked here means an output could be
  // accepted that does not satisfy the schema. Better to refuse the schema.
  assertSchemaSupported(PLAN_ASSESSMENT_SCHEMA);
  assertSchemaSupported(SCOPE_ASSESSMENT_SCHEMA);
});

test("assertSchemaSupported refuses a keyword it cannot enforce", () => {
  assert.throws(
    () => assertSchemaSupported({ type: "object", properties: { a: { type: "string", minLength: 3 } } }),
    /minLength/,
  );
});

test("round 0 gets the scope schema, every later round the full assessment", () => {
  assert.equal(schemaFor(0), SCOPE_ASSESSMENT_SCHEMA);
  for (const n of [1, 2, 7]) assert.equal(schemaFor(n), PLAN_ASSESSMENT_SCHEMA);
});

test("a well-formed assessment of either shape validates clean", () => {
  assert.deepEqual(validate(assessment(), PLAN_ASSESSMENT_SCHEMA), []);
  assert.deepEqual(validate(scopeAssessment(), SCOPE_ASSESSMENT_SCHEMA), []);
});

test("every section is required, so a reviewer cannot quietly omit one", () => {
  // The contract's own rule: an empty section is an empty list, never a
  // missing key. A reviewer having a bad round must still say what is strong,
  // and must still reconcile the previous findings.
  for (const key of PLAN_ASSESSMENT_SCHEMA.required) {
    const bad = assessment();
    delete bad[key];
    assert.ok(
      validate(bad, PLAN_ASSESSMENT_SCHEMA).some((p) => p.includes(`missing required key "${key}"`)),
      `omitting ${key} should be rejected`,
    );
  }
});

test("an invented status label is rejected", () => {
  const problems = validate(assessment({ review_status: "Looks good to me" }), PLAN_ASSESSMENT_SCHEMA);
  assert.ok(problems.some((p) => p.includes("review_status")), problems.join("\n"));
});

test("an extra top-level key is rejected", () => {
  const problems = validate(assessment({ overall_score: 8 }), PLAN_ASSESSMENT_SCHEMA);
  assert.ok(problems.some((p) => p.includes('unexpected key "overall_score"')), problems.join("\n"));
});

test("a finding missing its evidence or acceptance check is rejected, by index", () => {
  const bad = assessment();
  delete bad.required_revisions[0].evidence;
  delete bad.required_revisions[0].acceptance_check;
  const problems = validate(bad, PLAN_ASSESSMENT_SCHEMA);
  assert.ok(problems.some((p) => p.startsWith("$.required_revisions[0]") && p.includes("evidence")));
  assert.ok(problems.some((p) => p.includes("acceptance_check")));
});

test("a prior-finding status outside the three is rejected", () => {
  const bad = assessment({ previous_findings: [{ id: "R1", status: "Partially resolved", reason: "some of it" }] });
  assert.ok(validate(bad, PLAN_ASSESSMENT_SCHEMA).some((p) => p.includes("Partially resolved")));
});

test("wrong types are named, not coerced", () => {
  assert.ok(validate(assessment({ what_is_strong: "the inventory" }), PLAN_ASSESSMENT_SCHEMA).some((p) => p.includes("expected an array")));
  assert.ok(validate(assessment({ summary_for_david: null }), PLAN_ASSESSMENT_SCHEMA).some((p) => p.includes("expected a string")));
  assert.ok(validate([], PLAN_ASSESSMENT_SCHEMA).some((p) => p.includes("expected an object")));
});

test("missing_from_scope only accepts the three now/next/never buckets", () => {
  const bad = scopeAssessment({ missing_from_scope: [{ title: "x", why: "y", belongs_in: "later" }] });
  assert.ok(validate(bad, SCOPE_ASSESSMENT_SCHEMA).some((p) => p.includes("later")));
});

// ── parsing what came back ─────────────────────────────────────────────────

test("a bare JSON document parses", () => {
  assert.deepEqual(parseAssessment(JSON.stringify({ a: 1 })), { a: 1 });
});

test("one helpful code fence is stripped", () => {
  assert.deepEqual(parseAssessment('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseAssessment('```\n{"a":1}\n```'), { a: 1 });
});

test("an empty or non-JSON final message is a stated failure, not a guess", () => {
  assert.throws(() => parseAssessment(""), /empty final message/);
  assert.throws(() => parseAssessment("   "), /empty final message/);
  assert.throws(() => parseAssessment("Here is my review: it is fine."), /not JSON/);
});

// ── slugs, which become paths ──────────────────────────────────────────────

test("a slug that is not a safe path segment is refused", () => {
  for (const bad of ["../escape", "a/b", "Plan", "-lead", "", null, "with space", "a..b"]) {
    assert.throws(() => assertSlug(bad), /--slug/, `should refuse ${JSON.stringify(bad)}`);
  }
  for (const good of ["plan-review-in-session", "a", "x1-2"]) assert.equal(assertSlug(good), good);
});

test("a slug is derived from the plan filename so the common case needs no flag", () => {
  assert.equal(slugFromPlanPath("docs/plans/PLAN_FABLE_REVIEW_FOUNDATIONS.md"), "fable-review-foundations");
  assert.equal(slugFromPlanPath("PLAN_X.md"), "x");
  assert.throws(() => slugFromPlanPath("PLAN_.md"), /cannot derive a slug/);
});

// ── the oracle ─────────────────────────────────────────────────────────────

test("a fenced block is lifted out of the file that carries it", () => {
  assert.equal(extractFenced("intro\n\n```plan-oracle\nbody\nmore\n```\n\ntail", "plan-oracle"), "body\nmore");
  assert.equal(extractFenced("no block here", "plan-oracle"), null);
});

test("the oracle comes from the plan's own fenced block when there is one", () => {
  assert.equal(oracleFrom({ planText: "# Plan\n\n```plan-oracle\nDIRECTION\n```\n\nbody" }), "DIRECTION");
});

test("an explicit --oracle file wins over the plan's block", () => {
  const found = oracleFrom({
    oracleText: "```plan-oracle\nFROM THE FILE\n```",
    planText: "```plan-oracle\nFROM THE PLAN\n```",
  });
  assert.equal(found, "FROM THE FILE");
});

test("an --oracle file with no fence is taken whole", () => {
  assert.equal(oracleFrom({ oracleText: "  DIRECTION AND INTENT  " }), "DIRECTION AND INTENT");
});

test("no oracle is a refusal, because a plan reviewed against itself is not the contract", () => {
  assert.throws(() => oracleFrom({ planText: "# Plan\n\nbody with no oracle" }), /no review oracle/);
  assert.throws(() => oracleFrom({ oracleText: "   ", planText: "body" }), /no review oracle/);
});

// ── prior findings ─────────────────────────────────────────────────────────

test("prior findings cross as id, title and disposition — never the body", () => {
  const [only] = normalizePriors([
    {
      id: "R1",
      title: "The rail validates with io:null",
      disposition: "declined",
      note: "  the rail is\nnot reachable  ",
      why_it_matters: "SHOULD NOT CROSS",
      evidence: ["core/scripts/pr-ready.mjs:1592"],
      what_should_change: "SHOULD NOT CROSS",
    },
  ]);
  assert.deepEqual(Object.keys(only).sort(), ["disposition", "id", "note", "title"]);
  assert.equal(only.note, "the rail is not reachable");
});

test("a disposition note is capped, so a decline cannot smuggle the argument across", () => {
  const [only] = normalizePriors([{ id: "R1", title: "t", disposition: "declined", note: "x".repeat(MAX_NOTE_CHARS + 50) }]);
  assert.ok(only.note.length <= MAX_NOTE_CHARS + 20);
  assert.match(only.note, /truncated/);
});

test("every disposition in the documented set is accepted", () => {
  for (const disposition of DISPOSITIONS) {
    assert.equal(normalizePriors([{ id: "R1", title: "t", disposition }])[0].disposition, disposition);
  }
});

test("an unrecognised disposition is refused rather than passed through", () => {
  assert.throws(() => normalizePriors([{ id: "R1", title: "t", disposition: "wontfix" }]), /must be one of/);
  assert.throws(() => normalizePriors([{ id: "R1", title: "t" }]), /must be one of/);
});

test("a malformed prior-findings file is refused with the index that is wrong", () => {
  assert.throws(() => normalizePriors({ id: "R1" }), /must contain a JSON array/);
  assert.throws(() => normalizePriors([{ title: "t", disposition: "fixed" }]), /--prior\[0\] has no "id"/);
  assert.throws(() => normalizePriors([{ id: "R1", disposition: "fixed" }]), /has no "title"/);
  assert.throws(() => normalizePriors(["R1"]), /is not an object/);
});

// ── the contract, in either layout ─────────────────────────────────────────

test("the contract is found at the consumer path and, failing that, under core/", () => {
  const consumer = fixtureRoot({ contractAt: CONTRACT_PATH });
  assert.equal(readContract(consumer).path, CONTRACT_PATH);
  drop(consumer);

  const handbook = fixtureRoot();
  assert.equal(readContract(handbook).path, `core/${CONTRACT_PATH}`);
  drop(handbook);
});

test("no contract in either layout is a refusal naming both attempts", () => {
  const root = mkdtempSync(join(tmpdir(), "plan-review-test-"));
  assert.throws(() => readContract(root), /either payload layout/);
  drop(root);
});

// ── the prompt ─────────────────────────────────────────────────────────────

const prefixArgs = { round: 1, contractPath: `core/${CONTRACT_PATH}`, oracle: ORACLE, planPath: "docs/plans/PLAN_X.md" };

test("the stable prefix is byte-identical across the rounds of a loop", () => {
  // This is the whole token-discipline claim, and it is cheap to assert. The
  // pilot served 2.89M of 3.09M input tokens from cache because everything
  // before "## This round" repeats exactly. If a round number, a lens or a
  // finding ever leaks into the prefix, the cache stops paying and nothing
  // else in the system notices.
  const a = stablePrefix({ ...prefixArgs, round: 1 });
  for (const round of [2, 3, 9]) assert.equal(stablePrefix({ ...prefixArgs, round }), a);
});

test("the plan is handed over as a path, never inlined — which is what keeps the prefix stable", () => {
  const text = stablePrefix(prefixArgs);
  assert.match(text, /`docs\/plans\/PLAN_X\.md` in the current checkout/);
  assert.ok(!text.includes("## This round"));
});

test("round 0's prefix says there is no plan and asks the scope question", () => {
  const zero = stablePrefix({ ...prefixArgs, round: 0, planPath: null });
  assert.match(zero, /NO PLAN YET/);
  assert.match(zero, /should this exist at all/);
  assert.match(zero, /scope_concern/);
  assert.notEqual(zero, stablePrefix(prefixArgs));
});

test("the oracle reaches the reviewer whole", () => {
  assert.ok(stablePrefix(prefixArgs).includes(ORACLE));
});

test("prior findings reach the round context as a titled list with their dispositions", () => {
  const priors = normalizePriors([
    { id: "R1", title: "The rail bypass", disposition: "declined", note: "unreachable" },
    { id: "R4", title: "The size policy", disposition: "fixed" },
  ]);
  const text = roundContext({ round: 3, lens: null, priors, inventory: null });
  assert.match(text, /\*\*R1\*\* — The rail bypass — DECLINED by the builder: unreachable/);
  assert.match(text, /\*\*R4\*\* — The size policy — fixed/);
  assert.match(text, /Titles and dispositions only/);
});

test("the reviewer is told the builder's note is not evidence", () => {
  const priors = normalizePriors([{ id: "R1", title: "t", disposition: "declined", note: "because" }]);
  assert.match(roundContext({ round: 2, lens: null, priors, inventory: null }), /It is not evidence/);
});

test("a round with no priors says so, rather than leaving the section out", () => {
  assert.match(roundContext({ round: 2, lens: null, priors: [], inventory: null }), /No previous findings were carried over/);
  assert.match(roundContext({ round: 0, lens: null, priors: [], inventory: null }), /round 0, the scope gate/);
});

test("after round 2, new ground on unchanged text is a recommendation unless shown otherwise", () => {
  assert.doesNotMatch(roundContext({ round: 2, lens: null, priors: [], inventory: null }), /New ground after round 2/);
  const late = roundContext({ round: 3, lens: null, priors: [], inventory: null });
  assert.match(late, /New ground after round 2/);
  assert.match(late, /unless you can show/);
});

test("a lens directs emphasis and says so, and its absence is stated too", () => {
  const with_ = roundContext({ round: 1, lens: "authority and bypass", priors: [], inventory: null });
  assert.match(with_, /Lens for this round: authority and bypass/);
  assert.match(with_, /EMPHASIS, not scope/);
  assert.match(roundContext({ round: 1, lens: null, priors: [], inventory: null }), /assess the whole plan evenly/);
});

test("the plan's affected-file inventory is handed over as a map, not a boundary", () => {
  const text = roundContext({ round: 1, lens: null, priors: [], inventory: "- core/scripts/plan-review.mjs" });
  assert.match(text, /starting map, not a boundary/);
  assert.match(text, /core\/scripts\/plan-review\.mjs/);
});

test("the re-ask carries the schema errors and the reviewer's own output, not a fresh brief", () => {
  const text = assemblePrompt({
    ...prefixArgs,
    priors: [],
    inventory: null,
    lens: null,
    reaskErrors: ["$: missing required key \"what_is_strong\""],
    previousOutput: '{"review_status":"…"}',
  });
  assert.match(text, /previous attempt did not match the schema/);
  assert.match(text, /missing required key/);
  assert.match(text, /fix the shape/);
  assert.ok(text.startsWith(stablePrefix(prefixArgs)), "the re-ask keeps the same cached prefix");
});

test("a huge previous output is truncated before it is echoed back", () => {
  const text = assemblePrompt({
    ...prefixArgs,
    priors: [],
    inventory: null,
    lens: null,
    reaskErrors: ["x"],
    previousOutput: "y".repeat(500_000),
  });
  assert.ok(text.length < 400_000, `re-ask prompt was ${text.length} chars`);
  assert.match(text, /truncated/);
});

// ── sign-in ────────────────────────────────────────────────────────────────

test("not signed in is read from both the exit code and the text", () => {
  assert.equal(signInStatus({ run: () => ({ status: 1, stdout: "Not logged in", stderr: "" }) }).signedIn, false);
  // A future CLI that exits 0 while saying so must not read as signed in.
  assert.equal(signInStatus({ run: () => ({ status: 0, stdout: "Not logged in", stderr: "" }) }).signedIn, false);
});

test("a real sign-in reads as signed in", () => {
  const status = signInStatus({ run: () => ({ status: 0, stdout: "Logged in using ChatGPT\n", stderr: "" }) });
  assert.equal(status.signedIn, true);
});

test("a missing codex binary is distinguished from a missing sign-in", () => {
  const status = signInStatus({ run: () => ({ error: Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" }) }) });
  assert.equal(status.signedIn, false);
  assert.equal(status.missingBinary, true);
});

test("the sign-in check never names the credential file it would read", () => {
  // The bundle is David's whole ChatGPT account. Nothing here reads, prints or
  // copies it, and the surest way to keep that true is that no code path
  // mentions the path at all.
  const src = readFileSync(SCRIPT, "utf8");
  const codeOnly = src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
  assert.doesNotMatch(codeOnly, /auth\.json/);
});

// ── the codex invocation ───────────────────────────────────────────────────

test("every load-bearing exec flag is passed, and the prompt goes in on stdin", () => {
  const run = fakeRun([{ status: 0 }]);
  runCodex({
    prompt: "PROMPT",
    schemaFile: "/w/s.json",
    outFile: "/w/o.txt",
    model: DEFAULT_MODEL,
    effort: DEFAULT_EFFORT,
    sandbox: "read-only",
    cwd: "/w",
    timeoutMs: 1000,
    run,
  });
  const { args, opts } = run.calls[0];
  const after = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(after("--model"), DEFAULT_MODEL);
  assert.equal(after("-c"), `model_reasoning_effort="${DEFAULT_EFFORT}"`);
  assert.equal(after("--sandbox"), "read-only");
  assert.equal(after("--output-schema"), "/w/s.json");
  assert.equal(after("--output-last-message"), "/w/o.txt");
  assert.equal(after("--cd"), "/w");
  // --ignore-user-config is not tidiness: --output-schema is ignored when MCP
  // tools are active, and user config is how MCP tools get turned on.
  for (const flag of ["--ephemeral", "--ignore-user-config", "--ignore-rules"]) {
    assert.ok(args.includes(flag), `missing ${flag}`);
  }
  // `-` last: codex exec waits forever on an open stdin in this harness.
  assert.equal(args.at(-1), "-");
  assert.equal(opts.input, "PROMPT");
  assert.equal(opts.stdio[0], "pipe");
  assert.equal(opts.timeout, 1000);
});

// ── the round directory ────────────────────────────────────────────────────

test("the reviews directory ignores itself, so no plan reaches git history", () => {
  const root = mkdtempSync(join(tmpdir(), "plan-review-test-"));
  ensureRoundDir(root, "slug");
  const ignore = readFileSync(join(root, ".agents/reviews/.gitignore"), "utf8");
  assert.ok(
    ignore.split("\n").some((l) => l.trim() === "*"),
    "the whole directory must be ignored, including this file",
  );
  drop(root);
});

// ── the CLI's refusals ─────────────────────────────────────────────────────

const quiet = () => {
  const lines = [];
  return Object.assign((m) => lines.push(String(m)), { text: () => lines.join("\n") });
};

test("a dry run writes the prompt and the schema and spawns nothing", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nDIRECTION\n```\n\nbody" } });
  const run = fakeRun([]);
  const log = quiet();
  assert.equal(main(["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md", "--dry-run"], { root, run, log }), 0);
  assert.equal(run.calls.length, 0, "a dry run must not reach codex");
  assert.ok(existsSync(join(root, ".agents/reviews/x/round-1.prompt.md")));
  assert.ok(existsSync(join(root, ".agents/reviews/x/round-1.schema.json")));
  assert.ok(!existsSync(join(root, ".agents/reviews/x/round-1.json")));
  drop(root);
});

test("no sign-in exits 2 with the device-code instructions, and never runs a round", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  const run = fakeRun([{ status: 1, stdout: "Not logged in", stderr: "" }]);
  const log = quiet();
  assert.equal(main(["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md"], { root, run, log }), 2);
  assert.equal(run.calls.length, 1, "only `login status` — no exec");
  assert.match(log.text(), /device-auth/);
  assert.match(log.text(), /never stored|never written/);
  drop(root);
});

/** A round that already ran, so the next one has something to reconcile. */
function priorRound(root, slug, n) {
  mkdirSync(join(root, ".agents/reviews", slug), { recursive: true });
  writeFileSync(join(root, ".agents/reviews", slug, `round-${n}.json`), "{}");
}

test("a round is refused without --prior once an earlier round exists", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  priorRound(root, "x", 1);
  const log = quiet();
  assert.equal(main(["--round", "2", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md", "--dry-run"], { root, run: fakeRun([]), log }), 1);
  assert.match(log.text(), /needs --prior/);
  assert.match(log.text(), /fake convergence/);
  drop(root);
});

test("round 1 is refused too when round 0 ran — scope concerns are findings like any other", () => {
  // The round-number form (>= 2) let round 1 silently drop every scope concern
  // round 0 raised, which is the one round most likely to have raised any.
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  priorRound(root, "x", 0);
  const log = quiet();
  assert.equal(main(["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md", "--dry-run"], { root, run: fakeRun([]), log }), 1);
  assert.match(log.text(), /round\(s\) 0 already ran/);
  drop(root);
});

test("a first round with nothing before it needs no prior flag at all", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  const log = quiet();
  assert.equal(main(["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md", "--dry-run"], { root, run: fakeRun([]), log }), 0);
  drop(root);
});

test("--no-prior is the explicit escape, and it is explicit", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  priorRound(root, "x", 1);
  const log = quiet();
  assert.equal(
    main(["--round", "2", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md", "--no-prior", "--dry-run"], { root, run: fakeRun([]), log }),
    0,
  );
  drop(root);
});

test("round 0 takes an oracle, not a plan", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  writeFileSync(join(root, "oracle.md"), ORACLE);
  const log = quiet();
  assert.equal(main(["--round", "0", "--slug", "s", "--plan", "docs/plans/PLAN_X.md"], { root, run: fakeRun([]), log }), 1);
  assert.match(log.text(), /scope gate/);
  assert.equal(main(["--round", "0", "--slug", "s", "--oracle", "oracle.md", "--dry-run"], { root, run: fakeRun([]), log }), 0);
  drop(root);
});

test("a plan with no oracle is refused before anything spawns", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "# Plan\n\nno oracle here" } });
  const log = quiet();
  assert.equal(main(["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md", "--dry-run"], { root, run: fakeRun([]), log }), 1);
  assert.match(log.text(), /no review oracle/);
  drop(root);
});

test("an existing round is not silently overwritten", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  mkdirSync(join(root, ".agents/reviews/x"), { recursive: true });
  writeFileSync(join(root, ".agents/reviews/x/round-1.json"), "{}");
  const log = quiet();
  assert.equal(main(["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md", "--dry-run"], { root, run: fakeRun([]), log }), 1);
  assert.match(log.text(), /already exists/);
  assert.equal(main(["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md", "--dry-run", "--force"], { root, run: fakeRun([]), log }), 0);
  drop(root);
});

test("bad arguments are refused with the usage, never guessed at", () => {
  const root = fixtureRoot();
  const log = quiet();
  for (const argv of [["--round", "one"], ["--round", "-1"], ["--nope"], ["bare"], ["--round"]]) {
    assert.equal(main(argv, { root, run: fakeRun([]), log }), 1, `${argv.join(" ")} should be refused`);
  }
  assert.equal(main(["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md", "--sandbox", "wide-open"], { root, run: fakeRun([]), log }), 1);
  drop(root);
});

// ── the whole round, with a scripted reviewer ──────────────────────────────

function scriptedRound(root, finalMessages) {
  let call = 0;
  return fakeRun([
    { status: 0, stdout: "Logged in using ChatGPT", stderr: "" },
    ...finalMessages.map((message) => (({ args }) => {
      writeFileSync(args[args.indexOf("--output-last-message") + 1], message);
      call++;
      return { status: 0 };
    })),
  ]);
}

test("a schema-valid round is written, and the meta records what produced it", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nDIRECTION\n```\n\nbody" } });
  const log = quiet();
  const run = scriptedRound(root, [JSON.stringify(assessment())]);
  assert.equal(main(["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md", "--lens", "bypass"], { root, run, log }), 0);

  const written = JSON.parse(readFileSync(join(root, ".agents/reviews/x/round-1.json"), "utf8"));
  assert.deepEqual(written, assessment());
  const meta = JSON.parse(readFileSync(join(root, ".agents/reviews/x/round-1.meta.json"), "utf8"));
  assert.equal(meta.accepted, true);
  assert.equal(meta.model, DEFAULT_MODEL);
  assert.equal(meta.effort, DEFAULT_EFFORT);
  assert.equal(meta.sandbox, "read-only");
  assert.equal(meta.lens, "bypass");
  assert.equal(meta.attempts.length, 1);
  // The plan is never committed, so the digest is the only thing that can
  // later say which text this assessment was about.
  assert.match(meta.planDigest, /^[0-9a-f]{12}$/);
  assert.match(meta.contractDigest, /^[0-9a-f]{12}$/);
  // The full digest goes into the implementation PR's `private-plan` block,
  // whose grammar is exactly 64 lowercase hex characters, and it must be the
  // digest of the plan file itself -- not of anything this script assembled.
  const expected = createHash("sha256")
    .update(readFileSync(join(root, "docs/plans/PLAN_X.md"), "utf8"))
    .digest("hex");
  assert.match(meta.planSha256, /^[0-9a-f]{64}$/);
  assert.equal(meta.planSha256, expected);
  drop(root);
});

test("a schema-invalid round is re-asked exactly once, and the second answer is accepted", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  const log = quiet();
  const bad = assessment();
  delete bad.what_is_strong;
  const run = scriptedRound(root, [JSON.stringify(bad), JSON.stringify(assessment())]);
  assert.equal(main(["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md"], { root, run, log }), 0);
  assert.equal(run.calls.length, 3, "login status, the round, one re-ask");
  const meta = JSON.parse(readFileSync(join(root, ".agents/reviews/x/round-1.meta.json"), "utf8"));
  assert.equal(meta.attempts.length, 2);
  assert.ok(meta.attempts[0].problems.some((p) => p.includes("what_is_strong")));
  assert.ok(existsSync(join(root, ".agents/reviews/x/round-1.prompt.reask.md")));
  drop(root);
});

test("two invalid answers is a failed round: no JSON is written and the caller is told not to count it", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  const log = quiet();
  const run = scriptedRound(root, ["not json at all", "still not json"]);
  assert.equal(main(["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md"], { root, run, log }), 1);
  assert.equal(run.calls.length, 3, "one re-ask, never two");
  assert.ok(!existsSync(join(root, ".agents/reviews/x/round-1.json")));
  assert.match(log.text(), /This round did not happen/);
  const meta = JSON.parse(readFileSync(join(root, ".agents/reviews/x/round-1.meta.json"), "utf8"));
  assert.equal(meta.accepted, false);
  drop(root);
});

test("a reviewer that crashes is a failed round, not an empty one", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  const log = quiet();
  const run = fakeRun([
    { status: 0, stdout: "Logged in using ChatGPT" },
    { status: 1, signal: null },
    { status: 1, signal: null },
  ]);
  assert.equal(main(["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md"], { root, run, log }), 1);
  assert.ok(!existsSync(join(root, ".agents/reviews/x/round-1.json")));
  drop(root);
});

test("round 0 writes a scope assessment against the scope schema", () => {
  const root = fixtureRoot();
  writeFileSync(join(root, "oracle.md"), ORACLE);
  const log = quiet();
  const run = scriptedRound(root, [JSON.stringify(scopeAssessment())]);
  assert.equal(main(["--round", "0", "--slug", "in-session", "--oracle", "oracle.md"], { root, run, log }), 0);
  const written = JSON.parse(readFileSync(join(root, ".agents/reviews/in-session/round-0.json"), "utf8"));
  assert.equal(written.should_this_exist, "Yes, but narrower");
  drop(root);
});

test("a full assessment offered at round 0 is rejected — the shapes are not interchangeable", () => {
  const root = fixtureRoot();
  writeFileSync(join(root, "oracle.md"), ORACLE);
  const log = quiet();
  const run = scriptedRound(root, [JSON.stringify(assessment()), JSON.stringify(assessment())]);
  assert.equal(main(["--round", "0", "--slug", "s", "--oracle", "oracle.md"], { root, run, log }), 1);
  drop(root);
});

// ── reconciliation: convergence cannot be faked by omission ────────────────

const somePriors = () =>
  normalizePriors([
    { id: "R1", title: "one", disposition: "fixed" },
    { id: "R2", title: "two", disposition: "declined", note: "unreachable" },
  ]);

test("a round that drops a prior finding is rejected, by id", () => {
  const priors = somePriors();
  const bad = assessment({ previous_findings: [{ id: "R1", status: "Resolved", reason: "done" }] });
  const problems = reconciliationProblems(bad, priors);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /does not reconcile "R2"/);
});

test("an empty previous_findings against supplied priors is rejected", () => {
  // The schema accepts [] happily -- it is a well-formed array. This is the
  // check that stops a clean-looking round with no basis for being clean.
  const problems = reconciliationProblems(assessment({ previous_findings: [] }), somePriors());
  assert.equal(problems.length, 2);
});

test("an id nobody handed over is rejected, and so is a duplicate", () => {
  const priors = somePriors();
  const invented = assessment({
    previous_findings: [
      { id: "R1", status: "Resolved", reason: "a" },
      { id: "R2", status: "Resolved", reason: "b" },
      { id: "R9", status: "Resolved", reason: "invented" },
    ],
  });
  assert.ok(reconciliationProblems(invented, priors).some((p) => p.includes('"R9"')));

  const twice = assessment({
    previous_findings: [
      { id: "R1", status: "Resolved", reason: "a" },
      { id: "R1", status: "Still open", reason: "b" },
    ],
  });
  assert.match(reconciliationProblems(twice, priors)[0], /twice/);
});

test("a full reconciliation passes, and no priors means nothing to reconcile", () => {
  const priors = somePriors();
  const good = assessment({
    previous_findings: [
      { id: "R1", status: "Resolved", reason: "a" },
      { id: "R2", status: "Superseded", reason: "b" },
    ],
  });
  assert.deepEqual(reconciliationProblems(good, priors), []);
  assert.deepEqual(reconciliationProblems(assessment({ previous_findings: [] }), []), []);
});

// ── convergence ────────────────────────────────────────────────────────────

const clean = (over = {}) =>
  assessment({
    review_status: "No major technical disagreement",
    required_revisions: [],
    previous_findings: [],
    ...over,
  });

test("a clean round with nothing outstanding converges", () => {
  assert.deepEqual(convergence(clean(), []), { converged: true, reasons: [] });
});

test("a blocking status never converges, however empty the findings are", () => {
  // "I could not see enough of the repository to judge this" is not "this is
  // fine" -- and such a round naturally has zero required revisions.
  for (const status of BLOCKING_STATUSES) {
    const { converged, reasons } = convergence(clean({ review_status: status }), []);
    assert.equal(converged, false, status);
    assert.ok(reasons.some((r) => r.includes("could not complete")), reasons.join());
  }
});

test("an open required revision or a Still open prior blocks convergence", () => {
  assert.equal(convergence(assessment(), []).converged, false);
  const stillOpen = clean({ previous_findings: [{ id: "R2", status: "Still open", reason: "no" }] });
  const { converged, reasons } = convergence(stillOpen, somePriors());
  assert.equal(converged, false);
  assert.ok(reasons.some((r) => r.includes("R2")));
});

test("priors handed over but never reconciled block convergence", () => {
  assert.equal(convergence(clean(), somePriors()).converged, false);
});

// ── budget, counted rather than stored ─────────────────────────────────────

test("each tier's budget is its allowance when nothing was granted", () => {
  for (const tier of TIERS) assert.equal(allowanceFor(tier, []), TIER_BUDGETS[tier]);
});

test("a grant opens asOf + grant, so a mid-stage grant does not stack", () => {
  // Same rule as the committed receipts: a finite grant discards the
  // interrupted stage's unspent remainder rather than adding to it.
  assert.equal(allowanceFor("internal", [{ grant: 2, asOf: 3, kind: "adjudicator", reason: "r" }]), 5);
  assert.equal(allowanceFor("internal", [{ grant: 0, asOf: 3, kind: "david", reason: "stop" }]), 3);
});

test("an adjudicator cannot self-serve past the leash; David can", () => {
  const cap = TIER_BUDGETS.internal;
  assert.throws(
    () => allowanceFor("internal", [{ grant: 5, asOf: cap, kind: "adjudicator", reason: "r" }]),
    /self-serve leash ends at/,
  );
  assert.equal(
    allowanceFor("internal", [{ grant: 5, asOf: cap, kind: "david", reason: "his call" }]),
    cap + 5,
  );
  // Exactly at the leash is fine.
  assert.equal(allowanceFor("internal", [{ grant: LEASH, asOf: cap, kind: "adjudicator", reason: "r" }]), cap + LEASH);
});

test("a grant is validated, not trusted", () => {
  const root = mkdtempSync(join(tmpdir(), "plan-review-test-"));
  const write = (v) => writeFileSync(join(root, "extensions.json"), JSON.stringify(v));
  assert.deepEqual(readGrants(root), [], "absent file is no grants");
  write({ grant: 1 });
  assert.throws(() => readGrants(root), /must contain a JSON array/);
  write([{ grant: 1, asOf: 0, kind: "adjudicator" }]);
  assert.throws(() => readGrants(root), /needs a "reason"/);
  write([{ grant: 1, asOf: 0, kind: "someone", reason: "r" }]);
  assert.throws(() => readGrants(root), /"adjudicator" or "david"/);
  write([{ grant: -1, asOf: 0, kind: "david", reason: "r" }]);
  assert.throws(() => readGrants(root), /integer "grant"/);
  drop(root);
});

test("rounds run are counted from the round files, never stored", () => {
  const root = mkdtempSync(join(tmpdir(), "plan-review-test-"));
  assert.deepEqual(roundsRun(root), []);
  for (const n of [0, 1, 2]) writeFileSync(join(root, `round-${n}.json`), "{}");
  writeFileSync(join(root, "round-1.meta.json"), "{}");
  writeFileSync(join(root, "oracle.txt"), "x");
  assert.deepEqual(roundsRun(root), [0, 1, 2], "only round-N.json counts");
  drop(root);
});

test("a round past the allowance is refused, and the refusal says how to extend", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  const log = quiet();
  const argv = ["--round", "4", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md", "--no-prior", "--dry-run"];
  assert.equal(main(argv, { root, run: fakeRun([]), log }), 1);
  assert.match(log.text(), /past this loop's allowance of 3/);
  assert.match(log.text(), /extensions\.json/);

  writeFileSync(
    join(root, ".agents/reviews/x/extensions.json"),
    JSON.stringify([{ grant: 3, asOf: 3, kind: "adjudicator", reason: "the receipt chain is still unverified" }]),
  );
  assert.equal(main(argv, { root, run: fakeRun([]), log }), 0, "the recorded grant opens it");
  drop(root);
});

test("--tier is required from round 1 and validated", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  const log = quiet();
  assert.equal(main(["--round", "1", "--plan", "docs/plans/PLAN_X.md", "--dry-run"], { root, run: fakeRun([]), log }), 1);
  assert.match(log.text(), /--tier is required/);
  assert.equal(
    main(["--round", "1", "--tier", "gold", "--plan", "docs/plans/PLAN_X.md", "--dry-run"], { root, run: fakeRun([]), log }),
    1,
  );
  drop(root);
});

test("round 0 needs no tier — the scope gate runs before the loop it budgets", () => {
  const root = fixtureRoot();
  writeFileSync(join(root, "oracle.md"), ORACLE);
  const log = quiet();
  assert.equal(main(["--round", "0", "--slug", "s", "--oracle", "oracle.md", "--dry-run"], { root, run: fakeRun([]), log }), 0);
  drop(root);
});

// ── the oracle is pinned, so the plan cannot be measured against itself ────

test("the first round pins the oracle, and a matching one passes", () => {
  const root = mkdtempSync(join(tmpdir(), "plan-review-test-"));
  const first = pinOracle(root, "DIRECTION");
  assert.equal(first.firstPin, true);
  assert.equal(first.changed, false);
  assert.ok(!existsSync(join(root, "oracle.txt")), "the decision is made now; the write waits for commit()");
  first.commit();
  assert.equal(readFileSync(join(root, "oracle.txt"), "utf8").trim(), "DIRECTION");
  const again = pinOracle(root, "DIRECTION");
  assert.equal(again.firstPin, false);
  assert.equal(again.changed, false);
  drop(root);
});

test("an oracle that drifted from the pin is refused", () => {
  // This is the builder steering the reviewer, coming back in through the one
  // input nobody was watching: edit the plan AND its oracle block, and the
  // next round measures the plan against the rewritten intent.
  const root = mkdtempSync(join(tmpdir(), "plan-review-test-"));
  pinOracle(root, "DIRECTION: ship A and B").commit();
  assert.throws(() => pinOracle(root, "DIRECTION: ship A"), /differs from the one pinned/);
  assert.throws(() => pinOracle(root, "DIRECTION: ship A"), /--oracle-changed/);
  drop(root);
});

test("a deliberate oracle change is allowed, recorded, and re-pinned", () => {
  const root = mkdtempSync(join(tmpdir(), "plan-review-test-"));
  pinOracle(root, "DIRECTION: ship A and B").commit();
  const changed = pinOracle(root, "DIRECTION: ship A", { changedReason: "David moved B to next" });
  assert.equal(changed.changed, true);
  assert.equal(changed.changedReason, "David moved B to next");
  // Not yet written: a run that is refused after this point must not have
  // made the new oracle authoritative.
  assert.equal(readFileSync(join(root, "oracle.txt"), "utf8").trim(), "DIRECTION: ship A and B");
  changed.commit();
  assert.equal(readFileSync(join(root, "oracle.txt"), "utf8").trim(), "DIRECTION: ship A");
  assert.equal(pinOracle(root, "DIRECTION: ship A").changed, false, "the new text is the pin now");
  drop(root);
});

test("the CLI refuses a drifted oracle and takes the recorded reason", () => {
  const plan = (oracle) => ({ path: "docs/plans/PLAN_X.md", text: "```plan-oracle\n" + oracle + "\n```" });
  const root = fixtureRoot({ plan: plan("ship A and B") });
  const log = quiet();
  const argv = (extra = []) => ["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md", "--dry-run", ...extra];
  assert.equal(main(argv(), { root, run: fakeRun([]), log }), 0);

  writeFileSync(join(root, "docs/plans/PLAN_X.md"), plan("ship A").text);
  assert.equal(main(argv(["--force"]), { root, run: fakeRun([]), log }), 1);
  assert.match(log.text(), /differs from the one pinned/);
  assert.equal(main(argv(["--force", "--oracle-changed", "David moved B to next"]), { root, run: fakeRun([]), log }), 0);
  drop(root);
});

// ── the plan file cannot be staged by accident ─────────────────────────────

test("docs/plans ignores itself, so `git add -A` cannot publish a plan", () => {
  const root = mkdtempSync(join(tmpdir(), "plan-review-test-"));
  ensurePlansIgnored(root);
  const ignore = readFileSync(join(root, "docs/plans/.gitignore"), "utf8");
  assert.ok(ignore.split("\n").some((l) => l.trim() === "*"));
  // `git add -f` is the deliberate act that still works, and the file says so.
  assert.match(ignore, /add -f/);
  drop(root);
});

test("running a round writes that ignore", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  const log = quiet();
  main(["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md", "--dry-run"], { root, run: fakeRun([]), log });
  assert.ok(existsSync(join(root, "docs/plans/.gitignore")));
  drop(root);
});

// ── the reviewer's identity is pinned ──────────────────────────────────────

test("model, effort and sandbox are refused without --unpinned", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  const log = quiet();
  const base = ["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md", "--dry-run"];
  for (const extra of [["--model", "gpt-4"], ["--effort", "low"], ["--sandbox", "workspace-write"]]) {
    assert.equal(main([...base, ...extra], { root, run: fakeRun([]), log }), 1, extra.join(" "));
    assert.match(log.text(), /settled reviewer/);
  }
  assert.equal(main([...base, "--effort", "low", "--unpinned", "smoke test"], { root, run: fakeRun([]), log }), 0);
  drop(root);
});

test("danger-full-access is refused even with --unpinned", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  const log = quiet();
  assert.equal(
    main(
      ["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md", "--dry-run",
       "--sandbox", "danger-full-access", "--unpinned", "I really want to"],
      { root, run: fakeRun([]), log },
    ),
    1,
  );
  assert.match(log.text(), /refused, with or without --unpinned/);
  drop(root);
});

test("an unpinned round says so on the record", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  const log = quiet();
  const run = scriptedRound(root, [JSON.stringify(assessment())]);
  main(
    ["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md", "--effort", "low", "--unpinned", "smoke test"],
    { root, run, log },
  );
  const meta = JSON.parse(readFileSync(join(root, ".agents/reviews/x/round-1.meta.json"), "utf8"));
  assert.equal(meta.unpinned, "smoke test");
  assert.equal(meta.effort, "low");
  drop(root);
});

// ── a forced re-run cannot leave stale evidence ────────────────────────────

test("--force discards the old round before attempting, so a failed re-run leaves nothing", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  const log = quiet();
  const good = scriptedRound(root, [JSON.stringify(assessment())]);
  const argv = ["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md"];
  assert.equal(main(argv, { root, run: good, log }), 0);
  const out = join(root, ".agents/reviews/x/round-1.json");
  assert.ok(existsSync(out));

  // Now a forced re-run that fails outright.
  const bad = scriptedRound(root, ["not json", "still not json"]);
  assert.equal(main([...argv, "--force"], { root, run: bad, log }), 1);
  assert.ok(
    !existsSync(out),
    "the old accepted round must not survive a failed re-run — it would read as current evidence for a plan revision it never saw",
  );
  drop(root);
});

// ── convergence reaches the record and the log ─────────────────────────────

test("the meta and the log both state whether the round converged", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  const log = quiet();
  main(["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md"], {
    root,
    run: scriptedRound(root, [JSON.stringify(clean())]),
    log,
  });
  const meta = JSON.parse(readFileSync(join(root, ".agents/reviews/x/round-1.meta.json"), "utf8"));
  assert.equal(meta.convergence.converged, true);
  assert.equal(meta.budget.tier, "internal");
  assert.equal(meta.budget.allowance, TIER_BUDGETS.internal);
  assert.match(meta.oraclePin.pinned, /^[0-9a-f]{64}$/);
  assert.match(log.text(), /CONVERGED/);
  drop(root);
});

test("a round the reviewer could not complete is reported as not converged", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  const log = quiet();
  main(["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md"], {
    root,
    run: scriptedRound(root, [JSON.stringify(clean({ review_status: "Repo context required" }))]),
    log,
  });
  assert.match(log.text(), /not converged/);
  assert.match(log.text(), /could not complete/);
  drop(root);
});

test("a round that drops a prior is re-asked, not accepted", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  priorRound(root, "x", 1);
  writeFileSync(join(root, "priors.json"), JSON.stringify([{ id: "R1", title: "one", disposition: "fixed" }]));
  const log = quiet();
  const dropped = clean({ previous_findings: [] });
  const kept = clean({ previous_findings: [{ id: "R1", status: "Resolved", reason: "fixed in the revision" }] });
  const run = scriptedRound(root, [JSON.stringify(dropped), JSON.stringify(kept)]);
  assert.equal(
    main(["--round", "2", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md", "--prior", "priors.json"], { root, run, log }),
    0,
  );
  const meta = JSON.parse(readFileSync(join(root, ".agents/reviews/x/round-2.meta.json"), "utf8"));
  assert.equal(meta.attempts.length, 2, "the dropped prior forced the re-ask");
  assert.ok(meta.attempts[0].problems.some((p) => p.includes("R1")));
  assert.equal(meta.convergence.converged, true);
  drop(root);
});

// ── round 2's fixes ────────────────────────────────────────────────────────

test("an --oracle-changed run that is refused does not re-pin", () => {
  const plan = (oracle) => ({ path: "docs/plans/PLAN_X.md", text: "```plan-oracle\n" + oracle + "\n```" });
  const root = fixtureRoot({ plan: plan("ship A and B") });
  const log = quiet();
  const base = ["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md"];
  assert.equal(main([...base, "--dry-run"], { root, run: fakeRun([]), log }), 0);
  writeFileSync(join(root, "docs/plans/PLAN_X.md"), plan("ship A").text);
  // Refused for a reason unrelated to the oracle (no sign-in) -- the changed
  // oracle must not become authoritative on the way out.
  const noSignIn = fakeRun([{ status: 1, stdout: "Not logged in", stderr: "" }]);
  assert.equal(main([...base, "--force", "--oracle-changed", "David moved B"], { root, run: noSignIn, log }), 2);
  assert.equal(readFileSync(join(root, ".agents/reviews/x/oracle.txt"), "utf8").trim(), "ship A and B");
  drop(root);
});

test("an existing docs/plans/.gitignore that ignores nothing useful is extended, not trusted", () => {
  const root = mkdtempSync(join(tmpdir(), "plan-review-test-"));
  mkdirSync(join(root, "docs/plans"), { recursive: true });
  writeFileSync(join(root, "docs/plans/.gitignore"), "# consumer's own\n*.tmp\n");
  ensurePlansIgnored(root);
  const text = readFileSync(join(root, "docs/plans/.gitignore"), "utf8");
  assert.match(text, /^\*\.tmp$/m, "the consumer's pattern survives");
  assert.match(text, /^PLAN_\*\.md$/m, "the managed pattern is appended");
  // Already covered: left alone, not appended twice.
  ensurePlansIgnored(root);
  assert.equal((readFileSync(join(root, "docs/plans/.gitignore"), "utf8").match(/PLAN_\*\.md/g) ?? []).length, 1);
  drop(root);
});

test("a round-0 verdict against the work is not convergence", () => {
  const no = scopeAssessment({ review_status: "Scope is right", should_this_exist: "No", scope_concerns: [] });
  assert.equal(convergence(no, []).converged, false);
  const wrong = scopeAssessment({ review_status: "Scope is wrong", should_this_exist: "Yes", scope_concerns: [] });
  assert.equal(convergence(wrong, []).converged, false);
  const yes = scopeAssessment({ review_status: "Scope is right", should_this_exist: "Yes", scope_concerns: [] });
  assert.equal(convergence(yes, []).converged, true);
});

test("a reviewer that crashed is not re-asked", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  const log = quiet();
  const run = fakeRun([{ status: 0, stdout: "Logged in using ChatGPT" }, { status: 1, signal: null }]);
  assert.equal(main(["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md"], { root, run, log }), 1);
  assert.equal(run.calls.length, 2, "login status, one exec -- no re-ask for a reviewer that gave no answer");
  drop(root);
});

test("--force clears the old meta and last message too", () => {
  const root = fixtureRoot({ plan: { path: "docs/plans/PLAN_X.md", text: "```plan-oracle\nD\n```" } });
  const log = quiet();
  const argv = ["--round", "1", "--tier", "internal", "--plan", "docs/plans/PLAN_X.md"];
  assert.equal(main(argv, { root, run: scriptedRound(root, [JSON.stringify(assessment())]), log }), 0);
  const meta = join(root, ".agents/reviews/x/round-1.meta.json");
  assert.ok(existsSync(meta));
  // The forced re-run dies at sign-in: nothing of the old round may survive.
  const noSignIn = fakeRun([{ status: 1, stdout: "Not logged in", stderr: "" }]);
  assert.equal(main([...argv, "--force"], { root, run: noSignIn, log }), 2);
  assert.ok(!existsSync(meta), "old meta must not outlive the assessment it described");
  assert.ok(!existsSync(join(root, ".agents/reviews/x/round-1.json")));
  drop(root);
});

// ── the entry-point form ───────────────────────────────────────────────────

test("the entry-point guard compares URLs, not a hand-built file:// string", () => {
  // Issue #11: a hand-built `file://` string differs from `import.meta.url` on
  // any path needing escaping, and a script that never runs exits 0 -- which a
  // caller reads as success.
  const src = readFileSync(SCRIPT, "utf8");
  assert.match(src, /import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/);
  assert.doesNotMatch(src, /`file:\/\/\$\{/, "no interpolated file:// URL built by hand");
  assert.doesNotMatch(src, /"file:\/\/" ?\+/, "no concatenated file:// URL built by hand");
});
