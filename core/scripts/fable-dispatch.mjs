#!/usr/bin/env node
// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
/**
 * One Fable dispatch: a reviewer this session launches but does not instruct.
 *
 * WHY A SUBPROCESS AND NOT A SUBAGENT
 * -----------------------------------
 * AI-Handbook issue #36's premise is that a reviewer is worth dispatching only
 * if its instructions are outside the builder's reach, and attempt 1
 * (AI-Handbook PR #70) asserted exactly that while writing every dispatch
 * prompt itself -- a claim about a mechanism that did not exist. A subagent's
 * prompt is free text the caller types at invocation; a subprocess's argv is
 * built by this file. So the frame the reviewer reads is script-owned BY
 * CONSTRUCTION here -- the same guarantee `plan-review.mjs` already has for
 * Codex, on a transport this repo has shipped and measured.
 *
 * The subagent route is NOT impossible and this file does not claim it is
 * (measured 2026-09-10, Claude Code 2.1.267: a PreToolUse hook on `Agent` can
 * replace the dispatch prompt through `hookSpecificOutput.updatedInput`). It
 * was not chosen because nothing on that route reports which model produced
 * the answer, and that is half of what this increment exists to establish.
 *
 * WHAT THIS ENFORCES, AND WHAT IT DOES NOT
 * ----------------------------------------
 * The full statement is core/docs/ai-context/fable-dispatch.md. In short:
 *
 *   P1  the instruction FRAME is script-owned. Brief CONTENT is not
 *       authenticated -- a file the builder typed passes through unchanged,
 *       and the receipt records its digest, never its origin. Until Phase 1
 *       authenticates provenance, every role except the probe is refused.
 *   P2  the observable surface is pinned and the HARNESS reports it back:
 *       tools and MCP servers come from the `system init` event and a run
 *       whose reported surface exceeds the role's allowlist is refused.
 *       Which instruction files loaded is NOT observed -- the probe's canary
 *       is the reviewer's own answer, recorded as a self-report.
 *   P3  the ANSWER's model is bound, not the run's. `answerModel` is the
 *       model stamp on the assistant message that produced the validated
 *       output; aggregate `modelUsage` is accounting and authorises nothing.
 *   P4  schema-valid output or no receipt. One re-ask, then refusal.
 *   P5  spawn-time facts are stamped as spawn-time. A tree that changes
 *       during a run is not detected, and the field names say `AtSpawn`.
 *
 * FAIL LOUD, NEVER OPEN. Every refusal here is a dispatch that does not run.
 * This repository has shipped three controls that reported success when they
 * could not read their input (AI-Handbook #11, #16, #59); the lesson recorded
 * each time is that a control which cannot evaluate must refuse.
 *
 * USAGE
 * -----
 *   node <this file> --role probe --out .agents/receipts/fable-probe.json
 *   node <this file> --role probe            # receipt to stdout, as JSON
 *
 *   --role <id>     a role with a definition under .claude/agents/fable-<id>.md
 *   --brief <path>  the brief file. REFUSED for the probe, whose brief this
 *                   script generates; REQUIRED for every other role, all of
 *                   which are themselves refused in Phase 0.
 *   --out <path>    where the receipt goes. Omitted => stdout, parseable JSON.
 *   --timeout <s>   default 600.
 *
 * EXIT CODES
 *   0  a receipt was written
 *   1  a refusal, or the reviewer failed
 *   2  no provider reachable -- nothing was dispatched
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Constants that are policy, not configuration
// ---------------------------------------------------------------------------

/**
 * Tools no role may ever hold, whatever its frontmatter says.
 *
 * A reviewer reads. Each of these lets it do something else: run commands,
 * change the tree it is judging, reach the network, or dispatch further work
 * whose surface this file would not see. The list is enforced against the
 * role's DECLARED allowlist (so a bad definition refuses before spawn) and
 * again against the harness's reported surface (so a harness that adds one
 * refuses after launch).
 */
export const FORBIDDEN_TOOLS = ["Bash", "Write", "Edit", "NotebookEdit", "Agent", "Task", "Skill", "WebFetch", "WebSearch"];

/**
 * The harness adds `StructuredOutput` whenever `--json-schema` is given
 * (measured 2026-09-10: an allowlist of `Read,Grep,Glob` came back from
 * `system init` as `[Glob, Grep, Read, StructuredOutput]`). It is admitted by
 * construction rather than by a role declaring it, because a role that had to
 * declare it would be declaring a tool it does not choose.
 */
export const HARNESS_ADDED_TOOLS = ["StructuredOutput"];

/**
 * The only role Phase 0 may dispatch.
 *
 * Not a configuration value. P1 does not authenticate brief content, so any
 * role reading a caller-supplied brief would be advice built on an input this
 * increment cannot vouch for. The probe's brief is generated below, in this
 * file, which is why it alone is permitted. Phase 1 lifts this only after
 * BOTH of its named prerequisites -- authenticated brief provenance, and a
 * harness-side observation of instruction isolation.
 */
export const PHASE0_PERMITTED_ROLES = ["probe"];

/** Flags this file accepts. Anything else is free text wearing a flag's hat. */
const KNOWN_FLAGS = new Set(["--role", "--brief", "--out", "--timeout"]);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

const defaultGit = (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8" });

/** The repository root, found the way plan-review.mjs finds it: walk to `.git`. */
export function repoRoot(from = HERE) {
  let dir = from;
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) throw new Error("not inside a git repository");
    dir = up;
  }
}

/**
 * YAML frontmatter, to the depth an agent definition actually uses.
 *
 * Deliberately not a YAML parser: the definitions carry flat `key: value`
 * pairs, and a real parser would accept nesting this file would then have to
 * decide what to do with. Unquoted, single- and double-quoted scalars only.
 */
export function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text ?? "");
  if (!m) return null;
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[kv[1]] = v;
  }
  return out;
}

/** The definition's body: everything after the frontmatter block. */
export function frontmatterBody(text) {
  const m = /^---\n[\s\S]*?\n---\n/.exec(text ?? "");
  return m ? text.slice(m[0].length).trimStart() : (text ?? "");
}

// ---------------------------------------------------------------------------
// P1 / P2 — the role definition, read at a pinned commit
// ---------------------------------------------------------------------------

/**
 * Read a role's definition from a COMMIT, not the working tree.
 *
 * The working tree is what the reviewer greps; the definition is what
 * instructs it. Reading the instruction from a commit means an edit in
 * progress cannot change what a dispatch says while it is being judged, and
 * the receipt can name the commit the instruction came from. Same reasoning as
 * `dispatchDeclaration` in review-loop-record.mjs, which reads the
 * adjudicator's frontmatter at the reviewed commit for exactly this reason.
 */
export function readDefinitionAt(root, role, commit, { runGit = defaultGit } = {}) {
  const rel = `.claude/agents/fable-${role}.md`;
  const tried = [];
  for (const candidate of [rel, `core/${rel}`]) {
    const entry = runGit(["ls-tree", "-z", commit, "--", candidate], root);
    if (entry.status !== 0 || !entry.stdout) {
      tried.push(`${candidate} (absent at ${commit})`);
      continue;
    }
    const read = (target) => runGit(["show", `${commit}:${target}`], root);
    // A ROOT ENTRY IS USUALLY A SYMLINK, AND GIT STORES ITS TARGET PATH AS THE
    // BLOB. Reading it with `git show` therefore returns the string
    // "../../core/.claude/agents/fable-probe.md", not a definition -- which
    // parses as a file with no frontmatter and refuses for the wrong reason.
    // The mode is what distinguishes them; `readAtCommit` in
    // review-loop-record.mjs resolves the same hazard the same way, and this
    // was found by the first live run rather than by any test.
    if (entry.stdout.slice(0, 6) !== "120000") {
      return { path: candidate, text: read(candidate).stdout, followedLink: null };
    }
    const target = read(candidate).stdout.trim();
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(candidate), target));
    if (resolved.startsWith("../") || path.posix.isAbsolute(resolved)) {
      throw new Error(`${candidate} at ${commit} is a symlink to ${target}, which escapes the repository`);
    }
    const inner = runGit(["ls-tree", "-z", commit, "--", resolved], root);
    if (inner.status !== 0 || !inner.stdout) {
      throw new Error(`${candidate} at ${commit} is a symlink to ${resolved}, which is not present at that commit`);
    }
    // One hop only: a chain is a repository mistake, and following it would
    // make this resolver the thing that has to reason about cycles.
    if (inner.stdout.slice(0, 6) === "120000") {
      throw new Error(`${candidate} at ${commit} is a symlink to another symlink (${resolved}) -- refusing to follow a chain`);
    }
    return { path: resolved, text: read(resolved).stdout, followedLink: candidate };
  }
  throw new Error(
    `no definition for role "${role}" at ${commit} -- tried ${tried.join("; ")}. A role without a definition ` +
      `has no instructions, and this file will not invent them.`,
  );
}

/**
 * A role's launch contract, derived from its definition and checked.
 *
 * Every refusal below is a definition that could not produce an honest
 * dispatch, caught before anything is spawned.
 */
export function roleContract(definitionText, { role, definitionPath, definitionCommit }) {
  const front = parseFrontmatter(definitionText);
  if (!front) throw new Error(`${definitionPath} has no frontmatter -- nothing declares the model, tools or budget`);

  const model = front.model?.trim();
  if (!model) throw new Error(`${definitionPath} declares no \`model\``);
  // An alias is the exact defect AI-Handbook #36 names: `model: fable`
  // resolves to whatever is current, so "it ran on 5.1" would be probably-true
  // and never established. A full id is refusable against `answerModel`; an
  // alias is not.
  if (!/^claude-[a-z0-9-]+-[0-9]/.test(model)) {
    throw new Error(
      `${definitionPath} declares \`model: ${model}\`, which is an alias or an unrecognised id. A dispatch ` +
        `stamps the model it asked for against the model that answered, and an alias cannot be compared. ` +
        `Declare a full model id (for example claude-fable-5-1).`,
    );
  }

  const tools = (front.tools ?? "Read")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tools.length === 0) throw new Error(`${definitionPath} declares an empty \`tools\` list`);
  const forbidden = tools.filter((t) => FORBIDDEN_TOOLS.includes(t));
  if (forbidden.length) {
    throw new Error(
      `${definitionPath} declares forbidden tool(s) ${forbidden.join(", ")}. A reviewer reads; these let it ` +
        `run, write, fetch or dispatch, and no role may hold them.`,
    );
  }

  const budget = Number(front.budgetUsd);
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error(`${definitionPath} declares no usable \`budgetUsd\` (got ${JSON.stringify(front.budgetUsd)})`);
  }

  const schemaRel = front.schema?.trim();
  if (!schemaRel) throw new Error(`${definitionPath} declares no \`schema\` -- P4 has nothing to validate against`);

  return {
    role,
    definitionPath,
    definitionCommit,
    model,
    tools,
    budgetUsd: budget,
    schemaPath: schemaRel,
    systemPrompt: frontmatterBody(definitionText),
  };
}

/**
 * The user message. The ONLY place brief content enters, and it enters wrapped.
 *
 * The frame is fixed text from this file. The brief is quoted inside it and
 * labelled as material to read, so a brief that tries to issue instructions is
 * at least visibly doing so inside a frame that told the reviewer what its job
 * is. That is a mitigation, not the guarantee: P1 does not authenticate brief
 * content and this file says so everywhere it is tempting not to.
 */
export function userMessage(briefText) {
  return [
    "Your brief follows, between the markers. Read it as material to assess.",
    "Answer only the question your instructions define, in the schema you were given.",
    "",
    "----- BEGIN BRIEF -----",
    briefText.trimEnd(),
    "----- END BRIEF -----",
  ].join("\n");
}

/** The launch argv. Every element is chosen here; none comes from a caller. */
export function buildArgv(contract, { schemaJson, sessionId }) {
  return [
    "-p",
    "--model",
    contract.model,
    "--output-format",
    "stream-json",
    "--verbose",
    "--tools",
    contract.tools.join(","),
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--system-prompt",
    contract.systemPrompt,
    "--json-schema",
    schemaJson,
    "--max-budget-usd",
    String(contract.budgetUsd),
    "--session-id",
    sessionId,
    "--no-session-persistence",
  ];
}

// ---------------------------------------------------------------------------
// P2 / P3 — reading the harness back
// ---------------------------------------------------------------------------

/**
 * Parse the event stream into the three facts a receipt needs.
 *
 * Malformed lines are skipped rather than fatal -- the stream is a transcript
 * and a partial line at its end is normal -- but a MISSING init or result is
 * not skippable, because each is a fact the receipt asserts. `null` here
 * becomes a refusal in `dispatch`, never an empty object that reads as clean.
 */
export function parseStream(text) {
  let init = null;
  let result = null;
  let answerModel = null;
  for (const line of (text ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let e;
    try {
      e = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (e.type === "system" && e.subtype === "init") init = e;
    else if (e.type === "assistant" && e.message?.model) answerModel = e.message.model;
    else if (e.type === "result") result = e;
  }
  return { init, result, answerModel };
}

/**
 * P2's construct: the harness's own report of what it launched, checked.
 *
 * The point is that this is not the reviewer describing itself. `system init`
 * is emitted by the harness before the model is asked anything, so a reviewer
 * that wanted to misreport its surface has no opportunity to.
 *
 * `skills` is copied but NOT refused on. Skills are inert without the `Skill`
 * tool, which is permanently forbidden above, and a host that lists nineteen
 * of them (measured, 2026-09-10) is not thereby giving the reviewer nineteen
 * capabilities. Recording them rather than refusing keeps the receipt honest
 * about what was present without inventing a violation.
 */
export function assertLaunchSurface(init, contract) {
  if (!init) {
    throw new Error(
      "the run emitted no `system init` event, so nothing reports what surface the reviewer was given. " +
        "P2 is unestablished for this run and the receipt would be asserting it -- refusing.",
    );
  }
  const permitted = new Set([...contract.tools, ...HARNESS_ADDED_TOOLS]);
  const reported = Array.isArray(init.tools) ? init.tools : null;
  if (!reported) throw new Error("the `system init` event reports no `tools` array -- P2 cannot be established");
  // Forbidden BEFORE merely-unlisted, because both refuse but they diagnose
  // differently: "Bash is forbidden to every role" tells a maintainer the
  // launch is unfixable by widening an allowlist, where "outside the role's
  // allowlist" invites exactly that edit.
  const forbidden = reported.filter((t) => FORBIDDEN_TOOLS.includes(t));
  if (forbidden.length) {
    throw new Error(
      `the harness launched the reviewer with forbidden tool(s): ${forbidden.join(", ")}. No role may hold ` +
        `these, so this is not fixable by widening the role's allowlist.`,
    );
  }
  const excess = reported.filter((t) => !permitted.has(t));
  if (excess.length) {
    throw new Error(
      `the harness launched the reviewer with tool(s) outside the role's allowlist: ${excess.join(", ")}. ` +
        `Allowed: ${[...permitted].join(", ")}.`,
    );
  }

  const mcp = Array.isArray(init.mcp_servers) ? init.mcp_servers : null;
  if (!mcp) throw new Error("the `system init` event reports no `mcp_servers` array -- P2 cannot be established");
  if (mcp.length) {
    throw new Error(
      `the reviewer was launched with MCP server(s) attached: ${mcp.map((s) => s?.name ?? String(s)).join(", ")}. ` +
        `A reviewer's surface is its allowlisted built-ins and nothing else.`,
    );
  }
  return {
    tools: reported,
    mcpServers: mcp,
    agents: init.agents ?? null,
    skills: init.skills ?? null,
    plugins: init.plugins ?? null,
    permissionMode: init.permissionMode ?? null,
    apiKeySource: init.apiKeySource ?? null,
    claudeCodeVersion: init.claude_code_version ?? null,
    sessionId: init.session_id ?? null,
  };
}

/**
 * P3's construct: the answer's own model stamp, compared to what was asked.
 *
 * NOT the run's aggregate. `modelUsage` lists every model the run touched --
 * measured, it always includes a Haiku call the harness makes for its own
 * purposes -- so "the requested model appears in the totals" is satisfied by a
 * run whose answer came from something else entirely. That inference is the
 * defect this replaces, and the aggregate is copied for accounting only.
 */
export function assertAnswerModel(answerModel, contract) {
  if (!answerModel) {
    throw new Error(
      "no assistant message in the stream carried a `model` stamp, so nothing says which model produced the " +
        "answer. Refusing rather than falling back to the run's aggregate usage, which cannot attribute.",
    );
  }
  if (answerModel !== contract.model) {
    throw new Error(
      `the answer was produced by ${answerModel}, but the role asked for ${contract.model}. A role whose ` +
        `answer came from a different model is not that role.`,
    );
  }
  return answerModel;
}

// ---------------------------------------------------------------------------
// The probe's round trip
// ---------------------------------------------------------------------------

/**
 * A challenge the reviewer cannot compute, guess, or have seen before.
 *
 * The first design asked the probe to return the brief's digest, which a
 * Read-only reviewer cannot compute -- `plan-review.mjs` records the same
 * limitation for the adjudicator. Worse, a schema-valid invented digest would
 * have satisfied the acceptance check. An unpredictable value generated here
 * and compared here moves the hashing to the side that can do it, and makes a
 * wrong answer fail even when the model evidence is perfect.
 */
export const newNonce = () => crypto.randomBytes(16).toString("hex");

export function probeBrief(nonce) {
  return [
    `challenge: ${nonce}`,
    "",
    "Return the challenge value exactly as given.",
    "For `claudemd`, answer from what is already in your context, without reading any file:",
    'answer "yes" if your context contains repository working-agreement instructions (a CLAUDE.md or',
    'similar), otherwise "no".',
    "For `tools`, list the exact names of the tools available to you.",
  ].join("\n");
}

/**
 * The probe's acceptance predicate.
 *
 * `claudemd` is recorded, never refused on: it is the reviewer's self-report,
 * and P2 says so. Refusing on it would dress a self-report as a construct,
 * which is the whole class of defect this increment exists to remove.
 */
export function assertProbeRoundTrip(output, nonce) {
  if (!output || typeof output !== "object") throw new Error("the probe returned no structured output");
  if (output.challenge !== nonce) {
    throw new Error(
      `the probe returned challenge ${JSON.stringify(output.challenge)}, expected ${JSON.stringify(nonce)}. ` +
        `The brief this script generated did not reach the reviewer intact, or the answer did not come from it.`,
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// The dispatch
// ---------------------------------------------------------------------------

const SIGN_IN_HINT = [
  "fable-dispatch: no reachable provider for the reviewer.",
  "",
  "  This container authenticates through the host-managed provider the session already uses.",
  "  `--bare` is never passed here because it bypasses exactly that path (measured: every call",
  "  fails with an authentication error).",
].join("\n");

/**
 * Run one dispatch and return a receipt.
 *
 * `runner` is injected so the suite can drive recorded streams without a
 * network: the refusals above are the product, and a test that cannot reach
 * them tests nothing.
 */
export function dispatch({
  root,
  role,
  briefPath = null,
  timeoutSec = 600,
  runGit = defaultGit,
  runner = defaultRunner,
  now = () => new Date().toISOString(),
  nonce = null,
  permittedRoles = PHASE0_PERMITTED_ROLES,
} = {}) {
  if (!permittedRoles.includes(role)) {
    throw new Error(
      `role "${role}" is refused. Phase 0 dispatches only ${permittedRoles.join(", ")}, because it does not ` +
        `authenticate brief content (P1) and does not observe instruction loading (P2). Phase 1 lifts this ` +
        `once BOTH are established -- see core/docs/ai-context/fable-dispatch.md.`,
    );
  }
  const isProbe = role === "probe";
  if (isProbe && briefPath) {
    throw new Error(
      "--brief is refused for the probe: its brief is generated by this script, which is what makes its " +
        "round trip evidence rather than an echo of something the caller wrote.",
    );
  }
  if (!isProbe && !briefPath) throw new Error(`role "${role}" needs --brief`);

  const headRes = runGit(["rev-parse", "HEAD"], root);
  if (headRes.status !== 0) throw new Error("could not read HEAD");
  const headAtSpawn = headRes.stdout.trim();
  const statusRes = runGit(["status", "--porcelain"], root);
  const treeCleanAtSpawn = statusRes.status === 0 && statusRes.stdout.trim() === "";

  const { path: definitionPath, text: definitionText } = readDefinitionAt(root, role, headAtSpawn, { runGit });
  const contract = roleContract(definitionText, { role, definitionPath, definitionCommit: headAtSpawn });

  // The schema is named RELATIVE TO THE DEFINITION and read at the same
  // commit. Relative because the sync routes `core/X -> X`, so the definition
  // sits at `core/.claude/agents/` here and `.claude/agents/` in a consumer --
  // one repo-root path would be wrong in one of the two layouts. At the same
  // commit because the schema is part of the instruction: reading it from the
  // working tree would let an edit in progress change what a pinned
  // definition asks for.
  const schemaRel = path.posix.join(path.posix.dirname(contract.definitionPath), contract.schemaPath);
  if (schemaRel.startsWith("..") || path.posix.isAbsolute(contract.schemaPath)) {
    throw new Error(`${definitionPath} names a schema outside the repository: ${contract.schemaPath}`);
  }
  const schemaShow = runGit(["show", `${headAtSpawn}:${schemaRel}`], root);
  if (schemaShow.status !== 0) {
    throw new Error(`${definitionPath} names a schema that does not exist at ${headAtSpawn}: ${schemaRel}`);
  }
  const schemaJson = schemaShow.stdout;
  try {
    JSON.parse(schemaJson);
  } catch (e) {
    throw new Error(`${schemaRel} is not valid JSON: ${e.message}`);
  }

  const probeNonce = isProbe ? (nonce ?? newNonce()) : null;
  const briefText = isProbe ? probeBrief(probeNonce) : readBrief(root, briefPath);
  const briefSha256 = sha256(briefText);

  const sessionId = crypto.randomUUID();
  const argv = buildArgv(contract, { schemaJson, sessionId });
  const message = userMessage(briefText);

  const startedAt = now();
  const attempts = [];
  let surface;
  let answerModel;
  let output;
  let usage = null;
  let costUsd = null;

  // P4's one re-ask. A model that returns something unparseable once is worth
  // asking again; twice is a failure to report, not a parser to widen.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const run = runner({ argv, message, cwd: root, timeoutSec });
    if (run.unavailable) {
      const err = new Error(SIGN_IN_HINT);
      err.exitCode = 2;
      throw err;
    }
    const { init, result, answerModel: stampedModel } = parseStream(run.stdout);
    const problems = [];
    if (!result) problems.push("no `result` event");
    else if (result.is_error) problems.push(`the run reported an error: ${String(result.result).slice(0, 200)}`);
    else if (!result.structured_output) problems.push("the `result` event carried no `structured_output`");
    attempts.push({ attempt, problems });

    if (problems.length) {
      if (attempt === 2) {
        throw new Error(
          `the reviewer produced no schema-valid document in two attempts: ${problems.join("; ")}. ` +
            `No receipt is written -- a round that returns nothing valid did not happen.`,
        );
      }
      continue;
    }

    // These three are checked AFTER a valid document exists, and each throws
    // rather than retrying: a wrong surface or a wrong model is not something
    // asking again would fix, and retrying would hide it.
    surface = assertLaunchSurface(init, contract);
    answerModel = assertAnswerModel(stampedModel, contract);
    output = result.structured_output;
    usage = result.modelUsage ?? null;
    costUsd = result.total_cost_usd ?? null;
    break;
  }

  if (isProbe) assertProbeRoundTrip(output, probeNonce);

  return {
    role,
    definitionPath: contract.definitionPath,
    definitionCommit: contract.definitionCommit,
    roleDefinitionSha256: sha256(definitionText),
    schemaPath: schemaRel,
    briefSha256,
    briefSource: isProbe ? "script-generated" : "caller-supplied (content not authenticated -- see P1)",
    headAtSpawn,
    treeCleanAtSpawn,
    modelRequested: contract.model,
    answerModel,
    modelUsage: usage,
    costUsd,
    sessionId,
    init: surface,
    instructionCanary: output?.claudemd ?? null,
    instructionCanaryNote:
      "A self-report by the reviewer, not a harness observation. P2 does not establish instruction isolation; " +
      "closing that is a Phase 1 prerequisite.",
    nonceMatched: isProbe ? true : null,
    startedAt,
    finishedAt: now(),
    attempts,
    output,
  };
}

function readBrief(root, briefPath) {
  const abs = path.resolve(root, briefPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error(`--brief is not a regular file: ${briefPath}`);
  return fs.readFileSync(abs, "utf8");
}

/** The real launcher. Separated so every test above runs without a network. */
export function defaultRunner({ argv, message, cwd, timeoutSec }) {
  const bin = process.env.CLAUDE_BIN || "claude";
  const res = spawnSync(bin, argv, {
    cwd,
    input: message,
    encoding: "utf8",
    timeout: timeoutSec * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error && res.error.code === "ENOENT") return { unavailable: true };
  const stdout = res.stdout ?? "";
  // An authentication failure comes back as a normal result event carrying an
  // error string, not as a non-zero exit. Treating it as "unavailable" is what
  // makes exit 2 mean "nothing ran" rather than "something ran badly".
  if (/Authentication error/i.test(stdout) && !/"type":"assistant"/.test(stdout)) return { unavailable: true };
  return { stdout, status: res.status };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const out = { role: null, brief: null, out: null, timeout: 600 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      throw new Error(
        `unexpected argument ${JSON.stringify(a)}. This command takes flags only: free text here would be text ` +
          `the caller wrote reaching a reviewer, which is the one thing P1 exists to prevent.`,
      );
    }
    if (!KNOWN_FLAGS.has(a)) throw new Error(`unknown flag ${a}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
    i += 1;
    if (a === "--role") out.role = v;
    else if (a === "--brief") out.brief = v;
    else if (a === "--out") out.out = v;
    else if (a === "--timeout") out.timeout = Number(v);
  }
  if (!out.role) throw new Error("--role is required");
  if (!Number.isFinite(out.timeout) || out.timeout <= 0) throw new Error("--timeout must be a positive number of seconds");
  return out;
}

export function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`fable-dispatch: ${e.message}\n`);
    return 1;
  }
  const root = repoRoot();
  let receipt;
  try {
    receipt = dispatch({ root, role: args.role, briefPath: args.brief, timeoutSec: args.timeout });
  } catch (e) {
    process.stderr.write(`fable-dispatch: ${e.message}\n`);
    return e.exitCode ?? 1;
  }
  const json = `${JSON.stringify(receipt, null, 2)}\n`;
  if (args.out) {
    const abs = path.resolve(root, args.out);
    if (!abs.startsWith(path.resolve(root) + path.sep)) {
      process.stderr.write(`fable-dispatch: --out is outside the repository: ${args.out}\n`);
      return 1;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, json);
    process.stderr.write(`fable-dispatch: receipt -> ${args.out}\n`);
  } else {
    // With --out omitted stdout must PARSE. Every human-facing line above goes
    // to stderr for this reason.
    process.stdout.write(json);
  }
  return 0;
}

// `pathToFileURL(process.argv[1]).href` rather than a hand-built `file://`
// string: they differ whenever the checkout path needs escaping (a space, a
// `#`), and AI-Handbook #11 records a guard that exited 0 having evaluated
// nothing for exactly that reason.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
