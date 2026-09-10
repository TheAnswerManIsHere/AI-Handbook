// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
//
// The product of fable-dispatch.mjs is its REFUSALS, so a suite that cannot
// reach them tests nothing. Every case below drives a recorded stream through
// an injected runner and an injected git: no network, no provider, no clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CUMULATIVE_USAGE_FIELDS,
  FORBIDDEN_TOOLS,
  RECEIPTS_DIR,
  receiptPath,
  ROLE_DIR,
  main,
  mergeUsage,
  shipped,
  HARNESS_ADDED_TOOLS,
  PHASE0_PERMITTED_ROLES,
  assertAnswerModel,
  assertLaunchSurface,
  assertProbeRoundTrip,
  buildArgv,
  dispatch,
  frontmatterBody,
  newNonce,
  parseArgs,
  parseFrontmatter,
  parseStream,
  probeBrief,
  roleContract,
  userMessage,
} from "../fable-dispatch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");

// --- fixtures ---------------------------------------------------------------

const DEFINITION = [
  "---",
  "name: fable-probe",
  'description: "the probe"',
  "model: claude-fable-5-1",
  "tools: Read",
  "budgetUsd: 0.50",
  "schema: schemas/fable-probe.schema.json",
  "---",
  "",
  "# The dispatch probe",
  "",
  "Return the challenge exactly.",
].join("\n");

const SCHEMA = JSON.stringify({ type: "object", properties: { challenge: { type: "string" } } });

const initEvent = (over = {}) =>
  JSON.stringify({
    type: "system",
    subtype: "init",
    tools: ["Read", "StructuredOutput"],
    mcp_servers: [],
    agents: [],
    skills: ["a", "b"],
    plugins: [],
    permissionMode: "default",
    apiKeySource: "none",
    claude_code_version: "2.1.267",
    session_id: "fixed-session-id",
    ...over,
  });

const assistantEvent = (model = "claude-fable-5-1") => JSON.stringify({ type: "assistant", message: { model, content: [] } });

const resultEvent = (structured, over = {}) =>
  JSON.stringify({
    type: "result",
    is_error: false,
    structured_output: structured,
    modelUsage: { "claude-haiku-4-5-20251001": { outputTokens: 9 }, "claude-fable-5-1": { outputTokens: 40 } },
    total_cost_usd: 0.085,
    ...over,
  });

/** A stream for a probe run that answers with `nonce`. */
const goodStream = (nonce, { model = "claude-fable-5-1", init = initEvent() } = {}) =>
  [init, assistantEvent(model), resultEvent({ challenge: nonce, claudemd: "no", tools: ["Read"] })].join("\n");

/**
 * git that answers only the calls `dispatch` makes, from fixtures.
 *
 * Modelled on the HANDBOOK layout, where the root entry is a symlink whose
 * blob is its target path and the real definition lives under `core/`. The
 * first live run refused with "no frontmatter" because the resolver read the
 * link's target string as a definition, so the fixture reproduces the shape
 * that caused it rather than the shape that would have passed.
 */
function fakeGit({ definition = DEFINITION, schema = SCHEMA, clean = true, head = "abc123", rootIsLink = true } = {}) {
  const ROOT_REL = ".agents/fable-roles/fable-probe.md";
  const PAYLOAD_REL = `core/${ROOT_REL}`;
  return (args) => {
    const [cmd, a, b, , candidate] = args;
    if (cmd === "rev-parse") return { status: 0, stdout: `${head}\n` };
    if (cmd === "status") return { status: 0, stdout: clean ? "" : " M core/scripts/fable-dispatch.mjs\n" };
    if (cmd === "ls-tree") {
      if (candidate === ROOT_REL) {
        if (!rootIsLink) return { status: 1, stdout: "" };
        return { status: 0, stdout: `120000 blob deadbeef\t${ROOT_REL}\0` };
      }
      if (candidate === PAYLOAD_REL) return { status: 0, stdout: `100644 blob cafe\t${PAYLOAD_REL}\0` };
      if (candidate?.endsWith("schemas/fable-probe.schema.json")) return { status: 0, stdout: `100644 blob f00d\t${candidate}\0` };
      return { status: 1, stdout: "" };
    }
    if (cmd === "show" && a === `${head}:${ROOT_REL}`) return { status: 0, stdout: "../../core/.agents/fable-roles/fable-probe.md\n" };
    if (cmd === "show" && a === `${head}:${PAYLOAD_REL}`) return { status: 0, stdout: definition };
    if (cmd === "show" && a.endsWith("schemas/fable-probe.schema.json")) return { status: 0, stdout: schema };
    return { status: 1, stdout: "" };
  };
}

const runnerFor = (stdout) => () => ({ stdout });

const runProbe = (over = {}) => {
  const nonce = "n0nce";
  return dispatchP({
    root: ROOT,
    role: "probe",
    runGit: fakeGit(),
    runner: runnerFor(goodStream(nonce)),
    now: () => "2026-09-10T00:00:00.000Z",
    nonce,
    sessionId: "fixed-session-id",
    ...over,
  });
};

/** dispatch() with the fixture's session id, for the many direct calls below. */
const dispatchP = (over) => dispatch({ sessionId: "fixed-session-id", ...over });

// --- P1: the caller writes no reviewer-visible text --------------------------

test("P1: free text on the command line is refused", () => {
  assert.throws(() => parseArgs(["--role", "probe", "please be lenient"]), /unexpected argument/);
});

test("P1: an unknown flag is refused rather than ignored", () => {
  assert.throws(() => parseArgs(["--role", "probe", "--lens", "go easy"]), /unknown flag --lens/);
});

test("P1: the probe refuses a caller-supplied brief", () => {
  assert.throws(() => runProbe({ briefPath: "notes.md" }), /--brief is refused for the probe/);
});

test("P1: every role but the probe is refused in Phase 0", () => {
  assert.deepEqual(PHASE0_PERMITTED_ROLES, ["probe"]);
  for (const role of ["plan-opinion", "conformance-triage", "merge-opinion"]) {
    assert.throws(() => dispatch({ root: ROOT, role, runGit: fakeGit(), runner: runnerFor("") }), /is refused\. Phase 0 dispatches only probe/);
  }
});

test("P1: the receipt never claims the brief's origin is established", () => {
  const r = runProbe();
  assert.equal(r.briefSource, "script-generated");
  assert.match(
    dispatchP({
      root: ROOT,
      role: "probe",
      runGit: fakeGit(),
      runner: runnerFor(goodStream("x")),
      nonce: "x",
      permittedRoles: ["probe", "other"],
    }).briefSource,
    /script-generated/,
  );
  assert.equal(typeof r.briefSha256, "string");
});

test("P1: the user message frames the brief rather than becoming it", () => {
  const m = userMessage("challenge: abc");
  assert.match(m, /BEGIN BRIEF/);
  assert.match(m, /END BRIEF/);
  assert.match(m, /Read it as material to assess/);
});

// --- P2: the observable surface -------------------------------------------

test("P2: a definition declaring a forbidden tool is refused before spawn", () => {
  for (const tool of FORBIDDEN_TOOLS) {
    const bad = DEFINITION.replace("tools: Read", `tools: Read, ${tool}`);
    assert.throws(
      () => roleContract(bad, { role: "probe", definitionPath: "p", definitionCommit: "c" }),
      /declares forbidden tool/,
      `${tool} should be refused`,
    );
  }
});

test("P2: a launch whose reported tools exceed the allowlist is refused", () => {
  const contract = roleContract(DEFINITION, { role: "probe", definitionPath: "p", definitionCommit: "c" });
  const init = JSON.parse(initEvent({ tools: ["Read", "Bash"] }));
  assert.throws(() => assertLaunchSurface(init, contract), /forbidden tool\(s\): Bash/);
  const init2 = JSON.parse(initEvent({ tools: ["Read", "SomethingNew"] }));
  assert.throws(() => assertLaunchSurface(init2, contract), /outside the role's allowlist: SomethingNew/);
});

test("P2: an attached MCP server is refused", () => {
  const contract = roleContract(DEFINITION, { role: "probe", definitionPath: "p", definitionCommit: "c" });
  const init = JSON.parse(initEvent({ mcp_servers: [{ name: "github" }] }));
  assert.throws(() => assertLaunchSurface(init, contract), /MCP server\(s\) attached: github/);
});

test("P2: a missing init event refuses instead of reading as a clean surface", () => {
  const contract = roleContract(DEFINITION, { role: "probe", definitionPath: "p", definitionCommit: "c" });
  assert.throws(() => assertLaunchSurface(null, contract), /emitted no `system init` event/);
  assert.throws(() => assertLaunchSurface(JSON.parse(initEvent({ tools: undefined })), contract), /no `tools` array/);
  assert.throws(() => assertLaunchSurface(JSON.parse(initEvent({ mcp_servers: undefined })), contract), /no `mcp_servers` array/);
});

test("P2: the harness's own StructuredOutput is admitted without a role declaring it", () => {
  const contract = roleContract(DEFINITION, { role: "probe", definitionPath: "p", definitionCommit: "c" });
  assert.deepEqual(contract.tools, ["Read"]);
  assert.deepEqual(HARNESS_ADDED_TOOLS, ["StructuredOutput"]);
  const surface = assertLaunchSurface(JSON.parse(initEvent()), contract);
  assert.deepEqual(surface.tools, ["Read", "StructuredOutput"]);
});

test("P2: skills are recorded, never refused on -- they are inert without Skill", () => {
  const contract = roleContract(DEFINITION, { role: "probe", definitionPath: "p", definitionCommit: "c" });
  const surface = assertLaunchSurface(JSON.parse(initEvent({ skills: ["x", "y", "z"] })), contract);
  assert.deepEqual(surface.skills, ["x", "y", "z"]);
  assert.ok(FORBIDDEN_TOOLS.includes("Skill"));
});

test("P2: the launch flags pin the surface, and --bare is never among them", () => {
  const contract = roleContract(DEFINITION, { role: "probe", definitionPath: "p", definitionCommit: "c" });
  const argv = buildArgv(contract, { schemaJson: SCHEMA, sessionId: "sid" });
  assert.ok(argv.includes("--strict-mcp-config"));
  assert.ok(argv.includes("--no-session-persistence"));
  assert.equal(argv[argv.indexOf("--session-id") + 1], "sid");
  assert.equal(argv[argv.indexOf("--tools") + 1], "Read");
  assert.equal(argv[argv.indexOf("--setting-sources") + 1], "");
  assert.equal(argv[argv.indexOf("--max-budget-usd") + 1], "0.5");
  assert.ok(!argv.includes("--bare"), "--bare bypasses the host-managed provider and must never be passed");
});

test("P2: the canary is recorded as a self-report, and never gates the run", () => {
  const nonce = "n1";
  const stream = [initEvent(), assistantEvent(), resultEvent({ challenge: nonce, claudemd: "yes", tools: ["Read"] })].join("\n");
  const r = dispatchP({ root: ROOT, role: "probe", runGit: fakeGit(), runner: runnerFor(stream), nonce });
  assert.equal(r.instructionCanary, "yes");
  assert.match(r.instructionCanaryNote, /self-report/);
  assert.match(r.instructionCanaryNote, /Phase 1 prerequisite/);
});

// --- P3: the answer's model, not the run's ---------------------------------

test("P3: an alias model in the definition is refused", () => {
  for (const alias of ["fable", "opus", "best", "sonnet"]) {
    const bad = DEFINITION.replace("model: claude-fable-5-1", `model: ${alias}`);
    assert.throws(() => roleContract(bad, { role: "probe", definitionPath: "p", definitionCommit: "c" }), /alias or an unrecognised id/);
  }
});

test("P3: an answer from another model is refused even when usage looks right", () => {
  const nonce = "n2";
  // modelUsage still lists the requested model -- the aggregate is exactly the
  // evidence this refusal must not accept.
  const stream = [initEvent(), assistantEvent("claude-haiku-4-5-20251001"), resultEvent({ challenge: nonce, claudemd: "no", tools: [] })].join("\n");
  assert.throws(
    () => dispatchP({ root: ROOT, role: "probe", runGit: fakeGit(), runner: runnerFor(stream), nonce }),
    /answer was produced by claude-haiku-4-5-20251001, but the role asked for claude-fable-5-1/,
  );
});

test("P3: an unstamped answer refuses rather than falling back to the aggregate", () => {
  const contract = roleContract(DEFINITION, { role: "probe", definitionPath: "p", definitionCommit: "c" });
  assert.throws(() => assertAnswerModel(null, contract), /Refusing rather than falling back/);
});

test("P3: the last assistant stamp wins, and the aggregate is only copied", () => {
  const parsed = parseStream([initEvent(), assistantEvent("claude-haiku-4-5-20251001"), assistantEvent("claude-fable-5-1"), resultEvent({ a: 1 })].join("\n"));
  assert.equal(parsed.answerModel, "claude-fable-5-1");
  const r = runProbe();
  assert.equal(r.answerModel, "claude-fable-5-1");
  assert.ok(Object.keys(r.modelUsage).includes("claude-haiku-4-5-20251001"), "the aggregate is recorded, not filtered");
});

// --- P4: schema-valid output or no receipt ---------------------------------

test("P4: a run with no result event is re-asked once, then refused", () => {
  let calls = 0;
  const runner = () => {
    calls += 1;
    return { stdout: initEvent() };
  };
  assert.throws(() => dispatchP({ root: ROOT, role: "probe", runGit: fakeGit(), runner, nonce: "n" }), /no schema-valid document in two attempts/);
  assert.equal(calls, 2, "exactly one re-ask");
});

test("P4: a re-ask that succeeds produces a receipt recording both attempts", () => {
  const nonce = "n3";
  let calls = 0;
  const runner = () => {
    calls += 1;
    return { stdout: calls === 1 ? initEvent() : goodStream(nonce) };
  };
  const r = dispatchP({ root: ROOT, role: "probe", runGit: fakeGit(), runner, nonce });
  assert.equal(r.attempts.length, 2);
  assert.ok(r.attempts[0].problems.length > 0);
  assert.deepEqual(r.attempts[1].problems, []);
});

test("P4: an errored run is a problem, not a result", () => {
  const stream = [initEvent(), assistantEvent(), resultEvent(null, { is_error: true, result: "Authentication error" })].join("\n");
  assert.throws(() => dispatchP({ root: ROOT, role: "probe", runGit: fakeGit(), runner: runnerFor(stream), nonce: "n" }), /two attempts/);
});

test("P4: a provider that is not reachable exits 2, having dispatched nothing", () => {
  try {
    dispatchP({ root: ROOT, role: "probe", runGit: fakeGit(), runner: () => ({ unavailable: true }), nonce: "n" });
    assert.fail("should have thrown");
  } catch (e) {
    assert.equal(e.exitCode, 2);
  }
});

// --- the probe's round trip -------------------------------------------------

test("the probe refuses a schema-valid answer carrying the wrong challenge", () => {
  const stream = [initEvent(), assistantEvent(), resultEvent({ challenge: "invented", claudemd: "no", tools: [] })].join("\n");
  assert.throws(
    () => dispatchP({ root: ROOT, role: "probe", runGit: fakeGit(), runner: runnerFor(stream), nonce: "the-real-one" }),
    /returned challenge "invented", expected "the-real-one"/,
  );
});

test("the challenge is unguessable and generated here, not by the reviewer", () => {
  const a = newNonce();
  const b = newNonce();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.match(probeBrief(a), new RegExp(`challenge: ${a}`));
  assert.doesNotMatch(probeBrief(a), /hash|sha256|digest/i, "the reviewer is never asked to compute anything");
});

test("assertProbeRoundTrip requires an exact match", () => {
  assert.ok(assertProbeRoundTrip({ challenge: "abc" }, "abc"));
  assert.throws(() => assertProbeRoundTrip({ challenge: "abc " }, "abc"), /returned challenge/);
  assert.throws(() => assertProbeRoundTrip(null, "abc"), /no structured output/);
});

// --- P5: spawn-time facts ---------------------------------------------------

test("P5: the receipt names its facts as spawn-time and records a dirty tree", () => {
  const nonce = "n4";
  const dirty = dispatchP({
    root: ROOT,
    role: "probe",
    runGit: fakeGit({ clean: false }),
    runner: runnerFor(goodStream(nonce)),
    nonce,
  });
  assert.equal(dirty.treeCleanAtSpawn, false);
  assert.equal(dirty.headAtSpawn, "abc123");
  assert.ok("treeCleanAtSpawn" in dirty && !("treeClean" in dirty), "the field name carries the time boundary");
});

test("P5: the definition is read at the commit, and its digest recorded", () => {
  const r = runProbe();
  assert.equal(r.definitionCommit, "abc123");
  assert.equal(r.definitionPath, "core/.agents/fable-roles/fable-probe.md");
  assert.match(r.roleDefinitionSha256, /^[0-9a-f]{64}$/);
  assert.equal(r.schemaPath, "core/.agents/fable-roles/schemas/fable-probe.schema.json");
});

// --- definition and stream handling ----------------------------------------

test("a definition with no frontmatter, model, budget or schema is refused", () => {
  assert.throws(() => roleContract("no frontmatter here", { role: "probe", definitionPath: "p" }), /no frontmatter/);
  for (const [line, re] of [
    ["model: claude-fable-5-1\n", /declares no `model`/],
    ["budgetUsd: 0.50\n", /no usable `budgetUsd`/],
    ["schema: schemas/fable-probe.schema.json\n", /declares no `schema`/],
  ]) {
    assert.throws(() => roleContract(DEFINITION.replace(line, ""), { role: "probe", definitionPath: "p" }), re);
  }
});

test("a missing definition refuses rather than inventing instructions", () => {
  const git = (args) =>
    args[0] === "rev-parse" ? { status: 0, stdout: "abc123\n" } : args[0] === "status" ? { status: 0, stdout: "" } : { status: 1, stdout: "" };
  assert.throws(() => dispatchP({ root: ROOT, role: "probe", runGit: git, runner: runnerFor("") }), /no definition for role "probe"/);
});

test("a schema missing at the commit refuses", () => {
  const git = (args) => {
    if (args[0] === "show" && args[1].endsWith(".json")) return { status: 1, stdout: "" };
    return fakeGit()(args);
  };
  assert.throws(() => dispatchP({ root: ROOT, role: "probe", runGit: git, runner: runnerFor("") }), /names a schema that does not exist/);
});

test("the root symlink is followed rather than read as a definition", () => {
  // The live-run defect: `git show` on a symlink returns its TARGET PATH, and
  // a target path parses as a file with no frontmatter.
  const r = runProbe();
  assert.equal(r.definitionPath, "core/.agents/fable-roles/fable-probe.md");
  const direct = dispatchP({
    root: ROOT,
    role: "probe",
    runGit: fakeGit({ rootIsLink: false }),
    runner: runnerFor(goodStream("n5")),
    nonce: "n5",
  });
  assert.equal(direct.definitionPath, "core/.agents/fable-roles/fable-probe.md", "a consumer layout resolves too");
});

test("a symlink chain and an escaping symlink both refuse", () => {
  const chain = (args) => {
    if (args[0] === "ls-tree") return { status: 0, stdout: `120000 blob x\t${args[4]}\0` };
    return fakeGit()(args);
  };
  assert.throws(() => dispatchP({ root: ROOT, role: "probe", runGit: chain, runner: runnerFor("") }), /symlink to another symlink/);

  const escaping = (args) => {
    if (args[0] === "show" && args[1].endsWith(".agents/fable-roles/fable-probe.md") && !args[1].includes(":core/")) {
      return { status: 0, stdout: "../../../elsewhere/definition.md\n" };
    }
    return fakeGit()(args);
  };
  assert.throws(() => dispatchP({ root: ROOT, role: "probe", runGit: escaping, runner: runnerFor("") }), /escapes the repository/);
});

test("the stream parser skips a torn line but never invents an event", () => {
  const parsed = parseStream([initEvent(), "{not json", assistantEvent(), resultEvent({ a: 1 })].join("\n"));
  assert.ok(parsed.init);
  assert.ok(parsed.result);
  assert.equal(parsed.answerModel, "claude-fable-5-1");
  const empty = parseStream("");
  assert.equal(empty.init, null);
  assert.equal(empty.result, null);
});

test("frontmatter parsing handles quoted and unquoted scalars", () => {
  const f = parseFrontmatter(DEFINITION);
  assert.equal(f.model, "claude-fable-5-1");
  assert.equal(f.description, "the probe");
  assert.match(frontmatterBody(DEFINITION), /^# The dispatch probe/);
});

// --- the shipped payload matches what this file requires --------------------

test("the shipped probe definition and schema satisfy the contract", () => {
  const defPath = path.join(ROOT, "core/.agents/fable-roles/fable-probe.md");
  const text = fs.readFileSync(defPath, "utf8");
  const contract = roleContract(text, {
    role: "probe",
    definitionPath: "core/.agents/fable-roles/fable-probe.md",
    definitionCommit: "HEAD",
  });
  assert.equal(contract.model, "claude-fable-5-1");
  assert.ok(contract.budgetUsd > 0);
  const schemaPath = path.join(ROOT, "core/.agents/fable-roles/schemas", path.basename(contract.schemaPath));
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  assert.deepEqual(schema.required, ["challenge", "claudemd", "tools"]);
  assert.equal(schema.additionalProperties, false);
});

test("the entry-point guard uses pathToFileURL, not a hand-built file:// string", () => {
  // AI-Handbook #11: a hand-built `file://` string differs from
  // `import.meta.url` whenever the checkout path needs escaping, and the
  // script then exits 0 having evaluated nothing.
  const src = fs.readFileSync(path.join(ROOT, "core/scripts/fable-dispatch.mjs"), "utf8");
  assert.match(src, /import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/);
  assert.doesNotMatch(src, /`file:\/\/\$\{/);
});

// --- Codex #73 round 1 -----------------------------------------------------

test("R1: a forbidden launch surface refuses on the FIRST attempt, before any retry", () => {
  // The defect: the surface was checked only once a valid document existed, so
  // an attempt launched with Bash and returning nothing parseable was retried,
  // and a clean second attempt wrote a receipt.
  let calls = 0;
  const runner = () => {
    calls += 1;
    return { stdout: calls === 1 ? initEvent({ tools: ["Read", "Bash"] }) : goodStream("n") };
  };
  assert.throws(
    () => dispatchP({ root: ROOT, role: "probe", runGit: fakeGit(), runner, nonce: "n" }),
    /forbidden tool\(s\): Bash/,
  );
  assert.equal(calls, 1, "the bad launch is refused, never retried past");
});

test("R1: an attached MCP server on a failed attempt also refuses immediately", () => {
  let calls = 0;
  const runner = () => {
    calls += 1;
    return { stdout: calls === 1 ? initEvent({ mcp_servers: [{ name: "github" }] }) : goodStream("n") };
  };
  assert.throws(() => dispatchP({ root: ROOT, role: "probe", runGit: fakeGit(), runner, nonce: "n" }), /MCP server\(s\) attached/);
  assert.equal(calls, 1);
});

test("R4: a session id the harness did not honour is refused", () => {
  const contract = roleContract(DEFINITION, { role: "probe", definitionPath: "p", definitionCommit: "c" });
  const init = JSON.parse(initEvent({ session_id: "some-other-session" }));
  assert.throws(() => assertLaunchSurface(init, contract, { expectedSessionId: "asked-for" }), /fresh-session boundary was not established/);
  // Absent REFUSES: an unobserved boundary is not one the receipt may claim.
  // (Round 1 tolerated this and a test blessed it; Codex round 2 was right.)
  assert.throws(
    () => assertLaunchSurface(JSON.parse(initEvent({ session_id: null })), contract, { expectedSessionId: "asked-for" }),
    /reports no session id.*cannot be observed/s,
  );
  assert.ok(assertLaunchSurface(JSON.parse(initEvent({ session_id: "asked-for" })), contract, { expectedSessionId: "asked-for" }));
});

test("R3: cost and usage are summed across every attempt, not just the winner", () => {
  const nonce = "n6";
  let calls = 0;
  const runner = () => {
    calls += 1;
    if (calls === 1) {
      return {
        stdout: [initEvent(), assistantEvent(), resultEvent(null, { is_error: true, result: "boom", total_cost_usd: 0.04 })].join("\n"),
      };
    }
    return { stdout: goodStream(nonce) };
  };
  const r = dispatchP({ root: ROOT, role: "probe", runGit: fakeGit(), runner, nonce });
  assert.equal(Math.round(r.costUsd * 1000) / 1000, 0.125, "0.04 from the failed attempt + 0.085 from the good one");
  assert.equal(r.attempts[0].costUsd, 0.04);
  assert.equal(r.attempts[1].costUsd, 0.085);
  assert.equal(r.modelUsage["claude-fable-5-1"].outputTokens, 80, "40 + 40 across both attempts");
});

test("R5: a probe whose tool self-report contradicts the launch report is refused", () => {
  const omits = [initEvent(), assistantEvent(), resultEvent({ challenge: "n7", claudemd: "no", tools: [] })].join("\n");
  assert.throws(
    () => dispatchP({ root: ROOT, role: "probe", runGit: fakeGit(), runner: runnerFor(omits), nonce: "n7" }),
    /omits Read, which the harness did launch/,
  );
  const invents = [initEvent(), assistantEvent(), resultEvent({ challenge: "n9", claudemd: "no", tools: ["Read", "Bash"] })].join("\n");
  assert.throws(
    () => dispatchP({ root: ROOT, role: "probe", runGit: fakeGit(), runner: runnerFor(invents), nonce: "n9" }),
    /claims Bash, which the harness did not launch/,
  );
});

test("R5: omitting only the harness's own additions is not a contradiction", () => {
  // A reviewer has no reason to think of `StructuredOutput` as a tool it
  // holds. Refusing it for that would be a false refusal, and a check that
  // cries wolf stops being read.
  const ok = [initEvent(), assistantEvent(), resultEvent({ challenge: "n8", claudemd: "no", tools: ["Read"] })].join("\n");
  assert.equal(dispatchP({ root: ROOT, role: "probe", runGit: fakeGit(), runner: runnerFor(ok), nonce: "n8" }).nonceMatched, true);
  // Naming it is equally fine.
  const also = [initEvent(), assistantEvent(), resultEvent({ challenge: "na", claudemd: "no", tools: ["StructuredOutput", "Read"] })].join("\n");
  assert.equal(dispatchP({ root: ROOT, role: "probe", runGit: fakeGit(), runner: runnerFor(also), nonce: "na" }).nonceMatched, true);
});

test("R7: role definitions live outside the harness's agent directory", () => {
  assert.equal(ROLE_DIR, ".agents/fable-roles");
  assert.ok(!ROLE_DIR.startsWith(".claude/agents"), "a definition under .claude/agents is a second, unchecked door");
  assert.ok(fs.existsSync(path.join(ROOT, "core/.agents/fable-roles/fable-probe.md")));
  assert.ok(!fs.existsSync(path.join(ROOT, ".claude/agents/fable-probe.md")), "no root agent entry for a script-only role");
});

test("R2: shipped paths resolve to the layout the reader actually has", () => {
  assert.equal(shipped(ROOT, "docs/ai-context/fable-dispatch.md"), "core/docs/ai-context/fable-dispatch.md");
  const consumerish = path.join(ROOT, "core");
  assert.equal(shipped(consumerish, "docs/ai-context/fable-dispatch.md"), "docs/ai-context/fable-dispatch.md");
});


// --- The receipt path is derived, so there is nothing to validate ----------

test("the receipt path is built by the script, not supplied by the caller", () => {
  // Four review rounds were spent defending an --out flag against paths the
  // OPERATOR would have had to type. David, 2026-09-10: if it is this script's
  // job to name the file, this script names it, and the whole class goes away.
  assert.throws(() => parseArgs(["--role", "probe", "--out", ".git/HEAD"]), /unknown flag --out/);
  const p = receiptPath(ROOT, "probe", "1c9411c0bc01e4bedefff52c02de456319dfc496");
  assert.equal(p, path.join(ROOT, RECEIPTS_DIR, "fable-probe-1c9411c.json"));
});

// --- Codex #73 round 7 -----------------------------------------------------

test("R7-1: a definition with no `tools` refuses rather than defaulting to Read", () => {
  // P2 says the allowlist comes from frontmatter. A silent `?? "Read"` made
  // that false whenever the field was absent or misspelled.
  const noTools = DEFINITION.replace("tools: Read\n", "");
  assert.throws(
    () => roleContract(noTools, { role: "probe", definitionPath: "p", definitionCommit: "c" }),
    /declares no `tools`/,
  );
  const typo = DEFINITION.replace("tools: Read", "tool: Read");
  assert.throws(
    () => roleContract(typo, { role: "probe", definitionPath: "p", definitionCommit: "c" }),
    /declares no `tools`/,
  );
});

test("R7-2: two failed attempts carry their spend on the error", () => {
  // main() prints accounting only from e.attempts, so the path where the most
  // was spent for nothing was the one reporting no cost at all.
  const bad = [initEvent(), assistantEvent(), resultEvent(null)].join("\n");
  let calls = 0;
  try {
    dispatchP({
      root: ROOT,
      role: "probe",
      runGit: fakeGit(),
      runner: () => { calls += 1; return { stdout: bad }; },
      nonce: "n0nce",
    });
    assert.fail("expected a refusal");
  } catch (e) {
    assert.match(e.message, /no schema-valid document in two attempts/);
    assert.equal(calls, 2);
    assert.equal(e.attempts.length, 2, "both attempts are attached");
    assert.equal(e.attempts[0].costUsd, 0.085);
    assert.equal(e.attempts[1].costUsd, 0.085);
  }
});

// --- Codex #73 round 2: observed, or refused -- never coerced ----------------

test("R2-1: exit 2 is reserved for a dispatch where nothing ran", () => {
  // Attempt 1 runs (and bills); the provider vanishes before attempt 2.
  let calls = 0;
  const runner = () => {
    calls += 1;
    return calls === 1 ? { stdout: initEvent({ session_id: "fixed-session-id" }) } : { unavailable: true };
  };
  try {
    dispatchP({ root: ROOT, role: "probe", runGit: fakeGit(), runner, nonce: "n" });
    assert.fail("should have thrown");
  } catch (e) {
    assert.equal(e.exitCode, 1, "something was dispatched, so not exit 2");
    assert.match(e.message, /after attempt 1 had already run/);
    assert.equal(e.attempts.length, 1);
  }
  // With NO prior attempt it is still 2.
  try {
    dispatchP({ root: ROOT, role: "probe", runGit: fakeGit(), runner: () => ({ unavailable: true }), nonce: "n" });
    assert.fail("should have thrown");
  } catch (e) {
    assert.equal(e.exitCode, 2);
  }
});

test("R2-2: usage merge sums spend counters only; metadata is taken once and must agree", () => {
  const a = { m: { inputTokens: 10, costUSD: 0.1, contextWindow: 200000, canonicalModel: "m" } };
  const b = { m: { inputTokens: 5, costUSD: 0.2, contextWindow: 200000, canonicalModel: "m" } };
  const merged = mergeUsage([a, b]);
  assert.equal(merged.m.inputTokens, 15);
  assert.equal(Math.round(merged.m.costUSD * 100) / 100, 0.3);
  assert.equal(merged.m.contextWindow, 200000, "metadata is not summed");
  assert.throws(() => mergeUsage([a, { m: { contextWindow: 100000 } }]), /attempts disagree about m\.contextWindow/);
});

test("R2-3: an init event with no session id refuses the run", () => {
  const stream = [initEvent({ session_id: null }), assistantEvent(), resultEvent({ challenge: "n", claudemd: "no", tools: ["Read"] })].join("\n");
  assert.throws(() => dispatchP({ root: ROOT, role: "probe", runGit: fakeGit(), runner: runnerFor(stream), nonce: "n" }), /reports no session id/);
});

test("R2-5: a failed tree observation refuses rather than stamping dirty", () => {
  const git = (args) => (args[0] === "status" ? { status: 128, stdout: "" } : fakeGit()(args));
  assert.throws(() => dispatchP({ root: ROOT, role: "probe", runGit: git, runner: runnerFor("") }), /could not observe the working tree/);
});

test("R2-6: a process that did not exit cleanly is refused, whatever it printed", () => {
  const good = goodStream("n");
  for (const [label, run] of [
    ["non-zero status", { stdout: good, status: 1 }],
    ["timeout kill", { stdout: good, status: null, signal: "SIGTERM", error: { code: "ETIMEDOUT" } }],
    ["spawn error", { stdout: good, status: null, error: { code: "EACCES" } }],
  ]) {
    assert.throws(
      () => dispatchP({ root: ROOT, role: "probe", runGit: fakeGit(), runner: () => run, nonce: "n" }),
      /did not exit cleanly/,
      label,
    );
  }
  // A clean exit with the same output is accepted.
  assert.equal(dispatchP({ root: ROOT, role: "probe", runGit: fakeGit(), runner: () => ({ stdout: good, status: 0 }), nonce: "n" }).nonceMatched, true);
});

test("R2-7 (found in the audit): a total is only a total when every attempt was priced", () => {
  let calls = 0;
  const runner = () => {
    calls += 1;
    // Attempt 1 emits init but no result at all -- its cost is UNKNOWN.
    return { stdout: calls === 1 ? initEvent() : goodStream("n") };
  };
  const r = dispatchP({ root: ROOT, role: "probe", runGit: fakeGit(), runner, nonce: "n" });
  assert.equal(r.costComplete, false);
  assert.equal(r.costUsd, null, "a partial sum is not presented as the total");
  assert.equal(r.attempts[0].costUsd, null);
  assert.equal(r.attempts[1].costUsd, 0.085);
});

test("a result event whose subtype is not success is a problem", () => {
  const stream = [initEvent(), assistantEvent(), resultEvent({ challenge: "n" }, { subtype: "error_max_turns" })].join("\n");
  assert.throws(() => dispatchP({ root: ROOT, role: "probe", runGit: fakeGit(), runner: runnerFor(stream), nonce: "n" }), /two attempts/);
});
