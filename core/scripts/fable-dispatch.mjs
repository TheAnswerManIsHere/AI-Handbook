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
 * The full statement is docs/ai-context/fable-dispatch.md -- under `core/` in
 * the handbook, at the root in a consumer, because the sync routes
 * `core/X -> X`. Every path this file PRINTS is resolved the same way, by
 * `shipped()` below: a diagnostic naming a directory the reader does not have
 * is a diagnostic they cannot act on (Codex, #73 round 1). In short:
 *
 *   P1  the instruction FRAME is script-owned, and a role may dispatch only
 *       if this script builds its brief. There is no `--brief` and no
 *       parameter a caller could widen -- the permitted set is a predicate
 *       over the generators below. What a brief CONTAINS is not
 *       authenticated, and for `round-translation` it deliberately carries
 *       the builder's own words: the brief LABELS who wrote each block
 *       instead (David, 2026-09-12).
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
 * THE RULE UNDER ALL FIVE: A FACT IS OBSERVED, OR THE RUN IS REFUSED. NEVER
 * COERCED. Every value the receipt carries is one of three things -- observed
 * true, observed false, could not observe -- and the third refuses. It never
 * becomes `false` because an `&&` swallowed a failure, never becomes "verified"
 * because a `!= null` skipped the comparison, never becomes a total because a
 * sum ignored the attempt it could not see, and never becomes "succeeded"
 * because stdout looked fine while the process was dying. Codex #73 round 2
 * found six of those in one pass, three of them inside round 1's own fixes;
 * the rule exists so the seventh is caught by the person writing it.
 *
 * FAIL LOUD, NEVER OPEN. Every refusal here is a dispatch that does not run.
 * This repository has shipped three controls that reported success when they
 * could not read their input (AI-Handbook #11, #16, #59); the lesson recorded
 * each time is that a control which cannot evaluate must refuse.
 *
 * USAGE
 * -----
 *   node <this file> --role probe
 *   node <this file> --role round-translation --pr 81 --round 3 \
 *        --mcp-snapshot <file>
 *
 *   --role <id>     a role with a definition under .agents/fable-roles/ whose
 *                   brief this script generates. There is no --brief flag:
 *                   see `canDispatch` below.
 *   Each role takes its own flags (`ROLE_FLAGS`), all of them DATA this
 *   script then validates -- a number, a round, a path -- never text the
 *   reviewer reads. A flag belonging to another role is refused by name.
 *   The receipt is .agents/receipts/fable-<role>-<head>.json, or
 *   fable-round-translation-<pr>-<round>.json; `round-translation` also
 *   rebuilds David's page and prints the one line that goes to him.
 *   --timeout <s>   default 600.
 *
 * EXIT CODES
 *   0  a receipt was written
 *   1  a refusal, or the reviewer failed
 *   2  no provider reachable -- nothing was dispatched
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { modelTier } from "./review-budget.mjs";
import { buildTranslationRecord, translationBrief, skipReason, assertSnapshotIsForPr } from "./round-translation-record.mjs";
import { chatLine, renderPage, writePage, receiptsFor, publishPage, unavailable, unpublished } from "./round-translation-page.mjs";

/**
 * One line, for a notice that is pasted verbatim into chat.
 *
 * Several refusals here are deliberately multi-line and instructional --
 * `SIGN_IN_HINT` is a numbered list -- and pasting one into the chat line
 * turns a fixed status into a wall of operator instructions. The full text
 * still goes to stderr, where the operator reads it. (Codex, #81 round 1.)
 */
const oneLine = (text) => {
  const first = String(text ?? "").split("\n").find((l) => l.trim()) ?? "the reason was not recorded";
  const t = first.trim();
  return t.length > 160 ? `${t.slice(0, 157)}...` : t;
};

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
 * Which roles may dispatch, as a PREDICATE rather than a list.
 *
 * The rule has always been "a role whose brief this script generates", and the
 * list was a restatement of it that a caller could widen: `dispatch()` took a
 * `permittedRoles` parameter, so an importing script could pass its own and
 * the refusal was advisory (Codex, #73 round 3, named as Phase 1's first gap).
 * A predicate over the generators cannot be widened without adding a
 * generator, which is the actual bar.
 *
 * Phase 1 did not lift the refusal. **Phase 2's `round-translation` satisfies
 * it** the same way the probe does: its brief is composed here, from a record
 * `round-translation-record.mjs` builds out of a captured snapshot. The caller
 * supplies a pull request number, a round number and a file path -- data this
 * script then validates -- and never a word the reviewer reads.
 */
const BRIEF_GENERATORS = {
  probe: ({ nonce }) => probeBrief(nonce),
  "round-translation": ({ record }) => translationBrief(record),
};

export const canDispatch = (role) => Object.hasOwn(BRIEF_GENERATORS, role);

export const dispatchableRoles = () => Object.keys(BRIEF_GENERATORS);

/** Flags this file accepts. Anything else is free text wearing a flag's hat. */
/**
 * The flags each role takes, beyond `--role` and `--timeout`.
 *
 * Role-scoped rather than one flat set, so `--pr` on the probe is refused by
 * name instead of being parsed and ignored. Every entry here is DATA -- a
 * number, a number, a path -- and none of it reaches the reviewer as text:
 * the record built from the snapshot does, through the generator above.
 */
const ROLE_FLAGS = { probe: [], "round-translation": ["--pr", "--round", "--mcp-snapshot"] };
const BASE_FLAGS = ["--role", "--timeout"];
const KNOWN_FLAGS = new Set([...BASE_FLAGS, ...Object.values(ROLE_FLAGS).flat()]);

/**
 * Where a payload file lives in THIS checkout, for prose the reader will act on.
 *
 * The sync routes `core/X -> X`, so a message hardcoding either prefix is
 * wrong in one of the two layouts -- and wrong silently, since a path in an
 * error message is never resolved by anything. Asked of the filesystem rather
 * than assumed, the same shape the plan-review skill uses for its own script
 * path.
 */
export function shipped(root, rel) {
  return fs.existsSync(path.join(root, "core", rel)) ? `core/${rel}` : rel;
}

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
 * The working tree is what a reviewer greps; the definition is what instructs
 * it. Reading the instruction from a commit means an edit in progress cannot
 * change what a dispatch says while it is being judged, and the receipt can
 * name the commit the instruction came from -- the same reasoning as
 * `dispatchDeclaration` in review-loop-record.mjs.
 */
export const ROLE_DIR = ".agents/fable-roles";

/** Where a receipt goes. The script builds the path; nothing validates it. */
export const RECEIPTS_DIR = ".agents/receipts";

/**
 * The receipt path for a run, derived rather than supplied.
 *
 * `--out` used to take an arbitrary path, and four review rounds were then
 * spent defending it: a symlinked component, a path anywhere in the
 * repository, a tracked file inside the receipts directory, a hard link
 * aliasing an inode. Every one of those needs the OPERATOR to name the bad
 * path -- and the operator is the person running this script, on a command
 * line they wrote.
 *
 * `.agents/memory/machinery-threat-model-is-my-own-mistakes.md` says the same
 * thing about this whole machinery, and the approved plan's first settled
 * decision repeats it: the threat model is my own mistakes, not forgery. A
 * symlink or a hard link is not a mistake; somebody has to plant it.
 *
 * So there is nothing to check. If naming the receipt is this script's job,
 * this script does it, and the entire class of findings goes away because the
 * input that carried it no longer exists (David, 2026-09-10).
 */
export function receiptPath(root, role, head) {
  return path.join(path.resolve(root), RECEIPTS_DIR, `fable-${role}-${head.slice(0, 7)}.json`);
}

/**
 * The receipt's path for a completed dispatch, keyed by what makes it unique.
 *
 * `round-translation` is keyed by pull request and ROUND, not by head:
 * a round whose findings the builder declines without pushing leaves the head
 * where it was, so two rounds would write the same file and the second would
 * erase the first -- taking a round off David's page rather than adding one.
 * Still derived here, never supplied: the class of "wrote it where the name
 * is wrong" is what deleting `--out` removed (David, 2026-09-10).
 */
export function receiptPathFor(root, receipt) {
  if (receipt.role === "round-translation") {
    return path.join(path.resolve(root), RECEIPTS_DIR, `fable-round-translation-${receipt.pr}-${receipt.round}.json`);
  }
  return receiptPath(root, receipt.role, receipt.headAtSpawn);
}

/**
 * Read a role's definition from a COMMIT, not the working tree.
 *
 * WHY `.agents/fable-roles/` AND NOT `.claude/agents/`. A definition under
 * `.claude/agents/` is registered with the harness as an ordinary subagent, so
 * any session can select it through the Agent tool with a caller-written
 * prompt -- bypassing the script-owned frame, the launch check, the model
 * binding and the receipt, all at once. The first version of this file put the
 * probe there and merely DESCRIBED the second door; that is this increment's
 * own defect one level up, and Codex said so (#73 round 1). `.agents/` is this
 * repository's own convention directory and the harness does not scan it, so
 * there is now one way in rather than two.
 */
export function readDefinitionAt(root, role, commit, { runGit = defaultGit } = {}) {
  const rel = `${ROLE_DIR}/fable-${role}.md`;
  const tried = [];
  for (const candidate of [rel, `core/${rel}`]) {
    const entry = runGit(["ls-tree", "-z", commit, "--", candidate], root);
    if (entry.status !== 0 || !entry.stdout) {
      tried.push(`${candidate} (absent at ${commit})`);
      continue;
    }
    const read = (target) => runGit(["show", `${commit}:${target}`], root);
    // A ROOT ENTRY MAY BE A SYMLINK, AND GIT STORES ITS TARGET PATH AS THE
    // BLOB. Reading it with `git show` then returns a path string, not a
    // definition -- which parses as a file with no frontmatter and refuses for
    // entirely the wrong reason. Found by the first live run, when the root
    // entry was still a link into the payload.
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

  // A TIER, NOT A VERSION (David, 2026-09-11). "Fable" means the strongest
  // Claude model available, and a definition that named `claude-fable-5-1`
  // would have to be edited on every release -- across this repo and every
  // consumer of the payload. The definition names the tier;
  // `.agents/machinery.json` maps it to today's id, in one place; and the
  // refusal that used to live here lives there, unchanged in substance: the
  // resolved value must be a full id, because an alias cannot be compared
  // against the model that answered.
  const declaredTier = front.model?.trim();
  if (!declaredTier) throw new Error(`${definitionPath} declares no \`model\``);
  let resolvedTier;
  try {
    resolvedTier = modelTier(declaredTier);
  } catch (e) {
    throw new Error(
      `${definitionPath} declares \`model: ${declaredTier}\`, which did not resolve: ${e.message} ` +
        `A role definition names a TIER (for example strongestClaude), never a version.`,
    );
  }
  const model = resolvedTier.id;

  // Declared, never defaulted. P2 says a role's built-in tools come from its
  // frontmatter allowlist, and a silent `?? "Read"` made that false whenever
  // the field was omitted or misspelled -- the claim and the mechanism
  // disagreeing, which is this increment's whole subject (Codex, #73 round 7).
  // This is not a new check: it removes a default, so the field joins `model`,
  // `budgetUsd` and `schema` in being required.
  if (!front.tools?.trim()) throw new Error(`${definitionPath} declares no \`tools\``);
  // `none` is an EXPLICIT empty allowlist, and it is not the same thing as a
  // missing field -- which is why the refusal above stays exactly as strict.
  // A role that needs no tools has to say so, and then genuinely holds none:
  // measured 2026-09-12, `--tools ""` launches and `init.tools` comes back
  // `[]`. `round-translation` is the case: its brief carries the whole round,
  // and a working tree it could read is one that moves under it.
  const tools =
    front.tools.trim() === "none"
      ? []
      : front.tools
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
  if (tools.length === 0 && front.tools.trim() !== "none") {
    throw new Error(`${definitionPath} declares an empty \`tools\` list -- write \`tools: none\` to hold none deliberately`);
  }
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
    modelTier: resolvedTier.tier,
    modelEffort: resolvedTier.effort,
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
/**
 * The brief EXACTLY as it is embedded in the user message.
 *
 * Exported because the receipt's `briefSha256` must be the digest of this and
 * not of what was passed in: the frame trims the brief, so hashing the
 * untrimmed text recorded a digest of a document nobody read, and a reader
 * checking the receipt against the brief would find they disagree for no
 * reason anyone could see (Codex, #73 round 10).
 */
export const embeddedBrief = (briefText) => briefText.trimEnd();

export function userMessage(briefText) {
  return [
    "Your brief follows, between the markers. Read it as material to assess.",
    "Answer only the question your instructions define, in the schema you were given.",
    "",
    "----- BEGIN BRIEF -----",
    embeddedBrief(briefText),
    "----- END BRIEF -----",
  ].join("\n");
}

/** The launch argv. Every element is chosen here; none comes from a caller. */
export function buildArgv(contract, { schemaJson, sessionId, debugFile = null }) {
  return [
    "-p",
    "--model",
    contract.model,
    // The tier's configured reasoning depth, applied rather than merely
    // recorded. `roleContract` resolved it and `buildArgv` dropped it, so
    // editing `models.strongestClaude.effort` changed nothing while the
    // configuration described it as the depth the tier runs at -- a claim with
    // no mechanism, which is this file's own subject (Codex, #79 round 1).
    "--effort",
    contract.modelEffort,
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
    // P2's second observation. The harness prints what it loaded -- skills,
    // and the size of its pending-async-hook registry -- before the model is
    // asked anything. Written to a path this script derives and deletes;
    // nothing downstream reads the file.
    ...(debugFile ? ["--debug-file", debugFile] : []),
  ];
}

// ---------------------------------------------------------------------------
// P2 -- instruction isolation, observed within a bound
// ---------------------------------------------------------------------------

/**
 * The harness's own framing: its system additions, tool definitions, and the
 * schema tool `--json-schema` adds. Everything in the reviewer's prompt that
 * this script did not itself compose.
 *
 * MEASURED, not guessed, and the measurement is the whole basis for the
 * number. Claude Code 2.1.268 in this container, 2026-09-11:
 *
 *   - a replaced system prompt and NO tools: 804 prompt tokens against ~56
 *     characters of composed content, so framing alone was ~790 tokens.
 *   - the real probe, holding `Read` and a JSON schema (which adds
 *     `StructuredOutput`): 3,269 observed against 3,575 characters composed.
 *     English and JSON tokenize at roughly 3.5-4 characters each, so the
 *     composed half is ~950 tokens and the framing is **~2,300** -- the tool
 *     definitions, and the harness's own system additions.
 *
 * 3,500 leaves about 50% headroom over that. The first figure the probe ran
 * against was 2,000, which the live run passed only because material the run
 * itself delivered padded the bound -- material that was not in the request
 * being measured. A bound that passes for the wrong reason is a bound that
 * refuses the next legitimate dispatch, so it is set from the framing itself.
 *
 * It still catches what it exists to catch by a wide margin. The same host
 * with DEFAULT setting sources carried 17,810 tokens for the trivial request
 * above -- the repository's instructions arriving despite a replaced system
 * prompt. Against a probe-sized bound of ~7,500 that is refused several times
 * over, which is the asymmetry this number is chosen for: a false refusal
 * costs a dispatch every run, and the thing being caught is an order of
 * magnitude away.
 */
export const HARNESS_FRAMING_TOKENS = 3_500;

/**
 * Characters per token, for turning what the script sent into a token bound.
 *
 * Deliberately LOW, which makes the estimate HIGH and the bound loose: a
 * false refusal on a legitimate dispatch would be paid every run, while the
 * thing being caught is an order of magnitude away.
 */
const CHARS_PER_TOKEN = 3;

/**
 * Each request's prompt against the bound that applied WHEN IT WAS MADE.
 *
 * EVERY ASSISTANT EVENT, not the first. Context delivered after the first
 * request -- which is how an asynchronous hook delivers, on a later turn --
 * would be invisible to a check that read only the opening one, while still
 * reaching the request that produced the answer (Codex, plan round 2).
 *
 * AND EACH AGAINST ONLY WHAT PRECEDED IT. The first version totalled the whole
 * stream and compared the run's largest prompt to that single final bound, so
 * material delivered AFTER a contaminated request retroactively widened that
 * request's allowance: a 10,000-token opening prompt followed by a
 * 30,000-character tool result passed a bound it had exceeded by threefold at
 * the moment it was made (Codex, #79 round 1). The bound is now computed
 * incrementally, and the run is judged by its worst OVERAGE rather than by its
 * largest prompt -- which are different events whenever a legitimate later
 * request is bigger than an illegitimate early one.
 *
 * The bound still adds what the run itself delivered up to that point: the
 * reviewer's own output and the tool results the verbose stream carries are
 * legitimately in its context by then, and counting them keeps a role that
 * reads twenty files from refusing itself. Counted generously, from the raw
 * stream, because the safe direction on the allowance is the loose one.
 */
export function promptBound(stream, { systemPrompt, message, schemaJson }) {
  const composed = systemPrompt.length + message.length + schemaJson.length;
  const boundFor = (deliveredSoFar) => Math.ceil((composed + deliveredSoFar) / CHARS_PER_TOKEN) + HARNESS_FRAMING_TOKENS;

  let delivered = 0;
  let observed = 0;
  let bound = boundFor(0);
  let worstOverage = null;
  let requests = 0;

  for (const line of (stream ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") continue;
    if (event.type === "system" && event.subtype === "init") continue;

    if (event.type === "assistant") {
      const usage = event.message?.usage;
      if (usage) {
        requests += 1;
        const prompt =
          (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
        // The bound this request was actually held to: everything delivered
        // BEFORE it, and nothing after.
        const boundHere = boundFor(delivered);
        if (prompt > observed) {
          observed = prompt;
          bound = boundHere;
        }
        if (prompt > boundHere && (worstOverage === null || prompt - boundHere > worstOverage.over)) {
          worstOverage = { request: requests, observed: prompt, bound: boundHere, over: prompt - boundHere };
        }
      }
    }
    // Counted AFTER the event above, so a request is never bounded by its own
    // answer, and the answer counts toward the next request's allowance.
    delivered += trimmed.length;
  }

  return {
    promptTokensObserved: observed,
    promptTokensBound: bound,
    requests,
    overage: worstOverage,
    composedChars: composed,
    deliveredChars: delivered,
  };
}

/** `Loaded 44 unique skills (…)` and `Hooks: Found 0 total hooks in registry`. */
const SKILLS_RE = /Loaded (\d+) unique skills/;
const HOOKS_RE = /Hooks: Found (\d+) total hooks in registry/;

/**
 * What the harness said it loaded, read back from its own debug log.
 *
 * BOTH LINES OR REFUSE. A log that stopped printing either is a harness whose
 * format moved, and "could not observe" is never turned into an observation
 * here (this file's standing rule).
 *
 * NEITHER NUMBER REFUSES ON ITS VALUE, and the hooks one especially. The line
 * reports the size of the PENDING ASYNCHRONOUS hook registry, not a count of
 * hooks configured or run: a synchronous hook that injected context would
 * leave it at zero (Codex, plan round 2, who read it out of the harness
 * binary). Recording it under a name that says what it is beats refusing on a
 * number that does not mean what the name suggested. What catches injected
 * context, whatever delivered it, is the token bound above -- and a hook that
 * injects nothing is outside what either observation can see, which
 * `fable-dispatch.md` P2 states rather than implies.
 */
export function readDebugLog(text) {
  const skills = SKILLS_RE.exec(text ?? "");
  const hooks = HOOKS_RE.exec(text ?? "");
  if (!skills || !hooks) {
    throw new Error(
      `the harness's debug log does not carry ${!skills ? "a skills-loaded line" : ""}` +
        `${!skills && !hooks ? " or " : ""}${!hooks ? "a hooks-registry line" : ""}. P2's second observation ` +
        `is unavailable for this run, and an unobserved fact is not a favourable one -- refusing rather than ` +
        `recording a silence as isolation.`,
    );
  }
  return { skillsLoaded: Number(skills[1]), pendingAsyncHooks: Number(hooks[1]) };
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
    // `JSON.parse` returns a non-object for a bare `null`, number, string or
    // boolean line without throwing, and reading `.type` off `null` then threw
    // a TypeError out of a parser whose whole contract is to skip what it
    // cannot use (Codex, AI-Handbook #77 round 1). Skipped like any other
    // unusable line.
    if (!e || typeof e !== "object") continue;
    if (e.type === "system" && e.subtype === "init") init = e;
    // Every assistant event REPLACES the stamp, an unstamped one included.
    // Keeping only stamped events let an earlier stamp survive an unstamped
    // final event, and the receipt then named a model observed on a message
    // that did not produce the answer (Codex, #73 round 9). Now the stamp is
    // the last assistant event's or it is null, and null refuses downstream.
    else if (e.type === "assistant") answerModel = e.message?.model ?? null;
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
export function assertLaunchSurface(init, contract, { expectedSessionId = null } = {}) {
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
  // P2's fresh-session boundary, VERIFIED rather than asserted. The dispatch
  // generates a session id and passes `--session-id`; copying the harness's
  // reported id without comparing would let a CLI that ignored or substituted
  // the flag produce a receipt claiming a boundary that was never established
  // (Codex, #73 round 1). That is this file's own subject -- a property the
  // receipt states and nothing checks -- so it is checked.
  if (expectedSessionId != null) {
    // Round 1 tolerated an ABSENT id as "nothing to contradict" (and a test
    // blessed it). Wrong: the receipt states the boundary, so an unobserved
    // boundary is a claim the receipt cannot make -- and a CLI that ignored
    // `--session-id` would show up as exactly this absence (Codex, #73 round
    // 2). Absent refuses like a mismatch.
    if (init.session_id == null) {
      throw new Error(
        `the harness's init event reports no session id, so whether the dispatch's --session-id ` +
          `${expectedSessionId} was honoured cannot be observed. The receipt would assert a fresh-session ` +
          `boundary nothing established -- refusing.`,
      );
    }
    if (init.session_id !== expectedSessionId) {
      throw new Error(
        `the harness reports session ${init.session_id} but the dispatch asked for ${expectedSessionId}. The ` +
          `fresh-session boundary was not established, so the receipt would assert one that does not hold.`,
      );
    }
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
      "the final assistant message carried no `model` stamp, so nothing says which model produced the " +
        "answer -- an earlier message's stamp does not attribute a later one. Refusing rather than falling " +
        "back to the run's aggregate usage, which cannot attribute either.",
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
 * Every string the role's own schema declares as `minLength: 1`, reported
 * wherever the returned document leaves it blank.
 *
 * WHY THIS IS HERE AND NOT LEFT TO THE SCHEMA. P4 delegates validation to the
 * harness's `--json-schema`, and what that enforces beyond shape is the
 * harness's business, not a property this script establishes. A document that
 * satisfies `required` with empty strings is structurally valid and says
 * nothing, and the consumer downstream reads an absent disagreement as the
 * FAVOURABLE answer -- D0's chat line prints "agrees with the builder's
 * account" over a page with no account on it (Codex, #81 round 3). An
 * unobserved fact read as the good one is the exact shape this file exists to
 * refuse, so the emptiness is checked here rather than assumed.
 *
 * IT IS SCHEMA-DRIVEN, NOT A LIST OF FIELD NAMES. This script is
 * role-agnostic: naming D0's five fields here would put one role's knowledge
 * in the dispatcher, and the next role's empty document would sail through.
 * The role declares which of its strings must say something; this enforces
 * whatever it declared. A schema that declares no `minLength` gets no check,
 * which is the same answer it gets today.
 *
 * Two shapes, because they are the two the role schemas use: a top-level
 * string property, and a string inside the objects of an array property.
 */
export function blankDeclaredStrings(schema, doc, path = "") {
  const blanks = [];
  const props = schema?.properties;
  if (!props || !doc || typeof doc !== "object") return blanks;
  for (const [key, spec] of Object.entries(props)) {
    const here = path ? `${path}.${key}` : key;
    const value = doc[key];
    if (spec?.type === "string" && spec.minLength >= 1) {
      if (typeof value !== "string" || value.trim() === "") blanks.push(here);
    } else if (spec?.type === "array" && Array.isArray(value)) {
      value.forEach((item, i) => blanks.push(...blankDeclaredStrings(spec.items, item, `${here}[${i}]`)));
    }
  }
  return blanks;
}

/**
 * The probe's acceptance predicate.
 *
 * `claudemd` is recorded, never refused on: it is the reviewer's self-report,
 * and P2 says so. Refusing on it would dress a self-report as a construct,
 * which is the whole class of defect this increment exists to remove.
 */
export function assertProbeRoundTrip(output, nonce, surface = null) {
  if (!output || typeof output !== "object") throw new Error("the probe returned no structured output");
  if (output.challenge !== nonce) {
    throw new Error(
      `the probe returned challenge ${JSON.stringify(output.challenge)}, expected ${JSON.stringify(nonce)}. ` +
        `The brief this script generated did not reach the reviewer intact, or the answer did not come from it.`,
    );
  }
  // The probe reports the tools it believes it holds; the harness reports the
  // tools it launched. A receipt carrying both without comparing them can
  // carry two contradictory answers and call itself evidence (Codex, #73
  // round 1).
  //
  // The bar is NOT set equality, and the difference matters in both
  // directions. A tool the probe claims but the harness did not launch is a
  // contradiction. A tool the harness launched that the probe omits is one
  // too -- EXCEPT for the harness's own additions, which a reviewer has no
  // reason to think of as tools it holds; demanding it list `StructuredOutput`
  // would refuse a reviewer for being reasonable, which is how a check earns a
  // reputation for crying wolf and stops being read.
  if (surface && Array.isArray(output.tools)) {
    const claimed = new Set(output.tools);
    const launched = new Set(surface.tools);
    const invented = [...claimed].filter((x) => !launched.has(x)).sort();
    const omitted = [...launched].filter((x) => !claimed.has(x) && !HARNESS_ADDED_TOOLS.includes(x)).sort();
    if (invented.length || omitted.length) {
      const parts = [];
      if (invented.length) parts.push(`claims ${invented.join(", ")}, which the harness did not launch`);
      if (omitted.length) parts.push(`omits ${omitted.join(", ")}, which the harness did launch`);
      throw new Error(
        `the probe's tool report contradicts the launch report: it ${parts.join("; and it ")}. ` +
          `One of the two is wrong and the receipt would record both as evidence.`,
      );
    }
  }
  return true;
}

/**
 * Sum per-model usage across attempts, keeping the shape the CLI emits.
 *
 * Numeric fields add; anything else (canonicalModel, provider, contextWindow)
 * is taken from the first attempt that reported it, because those describe the
 * model rather than the spend.
 */
/**
 * The fields that are SPEND, and therefore add across attempts. Named rather
 * than inferred from "is a number": `contextWindow` and `maxOutputTokens` are
 * numbers too, and adding them turned two 200k windows into a 400k one (Codex,
 * #73 round 2) while the docstring above said metadata was kept from the first
 * attempt -- code contradicting its own contract.
 */
export const CUMULATIVE_USAGE_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadInputTokens",
  "cacheCreationInputTokens",
  "webSearchRequests",
  "thinkingTokens",
  "costUSD",
];

export function mergeUsage(list) {
  const out = {};
  for (const usage of list) {
    if (!usage || typeof usage !== "object") continue;
    for (const [model, stats] of Object.entries(usage)) {
      if (!out[model]) {
        out[model] = { ...stats };
        continue;
      }
      for (const [k, v] of Object.entries(stats)) {
        if (CUMULATIVE_USAGE_FIELDS.includes(k)) {
          if (typeof v === "number") out[model][k] = (typeof out[model][k] === "number" ? out[model][k] : 0) + v;
        } else if (k in out[model] && out[model][k] !== v) {
          // Two attempts of one model disagreeing about its own metadata is not
          // something a receipt can average or pick from. Refuse.
          throw new Error(
            `attempts disagree about ${model}.${k} (${JSON.stringify(out[model][k])} vs ${JSON.stringify(v)}); ` +
              `a receipt cannot record a fact its own evidence contradicts.`,
          );
        }
      }
    }
  }
  return Object.keys(out).length ? out : null;
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
  timeoutSec = 600,
  runGit = defaultGit,
  runner = defaultRunner,
  // Injected for the same reason `runner` is: the refusals are the product,
  // and a suite that cannot reach them tests nothing.
  readDebug = readDebugFile,
  now = () => new Date().toISOString(),
  nonce = null,
  sessionId = null,
  // The role's own material, already built and validated by the caller of
  // this function -- never text a command line carried. The probe needs none;
  // `round-translation` needs its record. A role whose generator ignores this
  // is unaffected by it.
  input = {},
} = {}) {
  if (!canDispatch(role)) {
    throw new Error(
      `role "${role}" is refused: this script generates no brief for it, and a role whose brief came from ` +
        `the caller would be counsel built on an input nothing here composed. Dispatchable: ` +
        `${dispatchableRoles().join(", ")}. Adding a role means adding its brief generator, which is the ` +
        `actual bar -- see ${shipped(root, "docs/ai-context/fable-dispatch.md")}.`,
    );
  }
  const isProbe = role === "probe";

  const headRes = runGit(["rev-parse", "HEAD"], root);
  if (headRes.status !== 0) throw new Error("could not read HEAD");
  const headAtSpawn = headRes.stdout.trim();
  const statusRes = runGit(["status", "--porcelain"], root);
  if (statusRes.status !== 0) {
    // `status === 0 && clean` collapsed "git failed" into `false`, and the
    // receipt then stamped a tree it never saw as dirty (Codex, #73 round 2).
    throw new Error("could not observe the working tree (`git status --porcelain` failed); refusing rather than stamping a state that was not seen");
  }
  const treeCleanAtSpawn = statusRes.stdout.trim() === "";

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
  let schemaParsed;
  try {
    schemaParsed = JSON.parse(schemaJson);
  } catch (e) {
    throw new Error(`${schemaRel} is not valid JSON: ${e.message}`);
  }

  const probeNonce = isProbe ? (nonce ?? newNonce()) : null;
  const briefText = BRIEF_GENERATORS[role]({ ...input, nonce: probeNonce });
  // The digest of what the reviewer READ, not of what was handed in.
  const briefSha256 = sha256(embeddedBrief(briefText));

  // Injectable for the suite, which must be able to make the harness fixture
  // echo the id it asked for; a real run always generates a fresh one.
  sessionId = sessionId ?? crypto.randomUUID();
  // Derived and removed by this script; nothing reads it afterwards and it is
  // never written inside the repository.
  const debugFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fable-dispatch-")), "harness.log");
  const argv = buildArgv(contract, { schemaJson, sessionId, debugFile });
  const message = userMessage(briefText);

  const startedAt = now();
  const attempts = [];
  let surface;
  let answerModel;
  let output;
  let isolation;

  // EVERY REFUSAL PAST THIS POINT CARRIES THE ACCOUNTING, BY POSITION.
  // `main()` prints spend from `e.attempts` and nowhere else, so an error
  // leaving here without one silently reports nothing for a dispatch that
  // billed. Four sites of that were patched one at a time (Codex, #73 rounds
  // 7-10) through a `withSpend()` helper each new assertion had to remember
  // to use -- a convention, which is why there were four. The region is
  // guarded instead, so an ordinary `throw`, a TypeError from a malformed
  // stream, or an assertion added later all inherit it by being inside.
  // `attempts` is empty until something is dispatched, and an empty array
  // prints nothing, so the pre-launch refusals are unaffected.
  try {

    // P4's one re-ask. A model that returns something unparseable once is worth
    // asking again; twice is a failure to report, not a parser to widen.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const run = runner({ argv, message, cwd: root, timeoutSec });
      if (run.unavailable) {
        // Exit 2 means NOTHING WAS DISPATCHED. If an earlier attempt already ran
        // -- and possibly billed -- that is no longer true, and a caller reading
        // 2 as "pre-launch provider failure" would be misled (Codex, #73 round
        // 2). The refusal is a plain 1 once any attempt exists.
        const err = new Error(
          attempts.length === 0
            ? SIGN_IN_HINT
            : `the provider became unavailable before attempt ${attempt}, after attempt ${attempts.length} had ` +
                `already run. Not exit 2: something was dispatched.`,
        );
        err.exitCode = attempts.length === 0 ? 2 : 1;
        err.attempts = attempts;
        throw err;
      }
      // THE ATTEMPT IS RECORDED HERE, BEFORE ANY POST-LAUNCH ASSERTION RUNS.
      // Past this line the subprocess has run and may have billed, so from here
      // the record exists and later code only fills it in. That ordering is the
      // fix for a class with four known sites -- rounds 7, 8, 9 and 10 each
      // found one refusal that threw before `attempts.push` and so dropped an
      // attempt from the accounting `main()` prints (Codex, #73 rounds 7-10).
      // Patching the sites one at a time is what produced four of them, and
      // round 9's claim that its site was "the last by construction" was made
      // without a search. Position is what makes this the last: the record
      // exists before anything can fail, and the region guard above carries it
      // out on any throw. Nothing was dispatched on an `unavailable` attempt,
      // which is why the push follows that check and not the `runner()` call.
      const record = { attempt, problems: [], costUsd: null, modelUsage: null };
      attempts.push(record);

      // A process that did not exit cleanly did not produce evidence, whatever
      // its stdout says. A CLI killed by the timeout after emitting a result
      // event would otherwise pass every check below and mint a receipt for a
      // failed run (Codex, #73 round 2). This is a refusal, not a retry: the
      // buffered output of a dying process is not "junk to ask again for".
      if (run.signal || (run.status !== undefined && run.status !== 0) || run.error) {
        const why = run.signal
          ? `killed by ${run.signal}${run.error?.code === "ETIMEDOUT" ? " (timeout)" : ""}`
          : run.error
            ? `spawn error ${run.error.code ?? run.error.message}`
            : `exit status ${run.status}`;
        // Its cost stays UNKNOWN: a process that died did not produce a result
        // event to price it from, and a missing figure is not a zero.
        record.problems.push(`process did not exit cleanly (${why})`);
        const err = new Error(`the reviewer process did not exit cleanly (${why}); its output is not evidence and no receipt is written`);
        err.attempts = attempts;
        throw err;
      }
      const { init, result, answerModel: stampedModel } = parseStream(run.stdout);
      // Spend is observable the moment the stream is parsed, so it is filled in
      // before anything can throw -- otherwise a refused attempt is present in
      // the accounting but reports its cost as unknown when it was known.
      record.costUsd = result?.total_cost_usd ?? null;
      record.modelUsage = result?.modelUsage ?? null;

      // THE SURFACE IS CHECKED FIRST, ON EVERY ATTEMPT, BEFORE ANY RETRY
      // DECISION. It used to be checked only once a valid document existed --
      // so an attempt launched with a forbidden tool, returning nothing
      // parseable, was silently retried, and a clean second attempt wrote a
      // receipt while the first reviewer had already held the prohibited
      // capability and could have used it (Codex, #73 round 1, P1). A retry
      // cannot un-launch that, so the refusal cannot wait for one.
      surface = assertLaunchSurface(init, contract, { expectedSessionId: sessionId });

      // P2's BOUND, on every attempt, before any retry decision. A
      // contaminated first attempt cannot be hidden by a clean retry, for the
      // same reason the launch-surface check above it cannot wait: a retry
      // does not un-launch a reviewer that already held the context.
      //
      // Only the OVER-BOUND case refuses here. An attempt that produced no
      // assistant event at all has nothing to measure and is already failing
      // for a reason of its own -- refusing it for the missing measurement
      // would replace the real diagnosis with a worse one. That an ACCEPTED
      // answer was measured is checked below, where accepting happens.
      const bound = promptBound(run.stdout, { systemPrompt: contract.systemPrompt, message, schemaJson });
      if (bound.overage) {
        const o = bound.overage;
        throw new Error(
          `request ${o.request} of this run carried ${o.observed} prompt tokens against the ${o.bound} it was ` +
            `bounded to at that point (${bound.composedChars} characters composed by this script, plus what ` +
            `the run had delivered before that request, plus ${HARNESS_FRAMING_TOKENS} tokens of harness ` +
            `framing). Something reached the reviewer's context that this dispatch did not send. Measured for ` +
            `comparison: a dispatch with default setting sources on this host carried 17,810 tokens where an ` +
            `isolated one carried 804.`,
        );
      }
      isolation = { ...bound, harnessFramingAllowanceTokens: HARNESS_FRAMING_TOKENS };

      // Filled in afterwards, into the record that already exists. Spend is
      // recorded per attempt, always -- including the attempts that produced
      // nothing. A receipt carrying only the successful attempt's totals
      // under-reports what the dispatch actually cost (Codex, #73 round 1), and
      // the budget conversation for later phases runs on these numbers.
      const problems = record.problems;
      if (!result) problems.push("no `result` event");
      else if (result.is_error) problems.push(`the run reported an error: ${String(result.result).slice(0, 200)}`);
      // ABSENT IS NOT SUCCESS. `subtype != null &&` let a result event with no
      // subtype at all through as a clean run -- an unobserved fact read as
      // the favourable one, which is the exact shape this file exists to
      // refuse (Codex, #73 round 10, left open as a gap while nothing
      // consumed these receipts; Phase 1 consumes them).
      else if (result.subtype !== "success")
        problems.push(
          result.subtype === undefined
            ? 'the `result` event carries no `subtype`, so nothing says the run succeeded -- an absent fact is not a "success"'
            : `the result event's subtype is ${JSON.stringify(result.subtype)}, not "success"`,
        );
      else if (!result.structured_output) problems.push("the `result` event carried no `structured_output`");
      // A document whose declared-non-empty strings are blank is structurally
      // valid and says nothing. It joins `problems` rather than throwing, so it
      // earns the same one re-ask any other invalid answer gets.
      else {
        const blank = blankDeclaredStrings(schemaParsed, result.structured_output);
        if (blank.length) {
          problems.push(
            `the document left ${blank.length} field(s) its schema requires to say something empty: ` +
              `${blank.join(", ")}`,
          );
        }
      }

      if (problems.length) {
        if (attempt === 2) {
          const err = new Error(
            `the reviewer produced no schema-valid document in two attempts: ${problems.join("; ")}. ` +
              `No receipt is written -- a round that returns nothing valid did not happen.`,
          );
          // Both attempts spent money. `main()` prints accounting only from
          // `e.attempts`, so without this the one path where the MOST was spent
          // for nothing is the one that reports no cost at all -- the same
          // under-reporting the round-1 cost fix removed from the receipt, left
          // behind on the error (Codex, #73 round 7).
          err.attempts = attempts;
          throw err;
        }
        continue;
      }

      // THE ACCEPTED ANSWER MUST BE MEASURED. Past this line a receipt gets
      // written, and a receipt that asserts P2 while having observed nothing
      // is the fail-open this file exists to refuse.
      if (bound.promptTokensObserved === 0) {
        throw new Error(
          "this run produced a valid document but no assistant event reported its prompt usage, so the size " +
            "of the reviewer's context was never observed. The receipt would assert a bound nothing " +
            "established -- refusing.",
        );
      }
      isolation = { ...isolation, ...readDebugLog(readDebug(debugFile)) };
      answerModel = assertAnswerModel(stampedModel, contract);
      output = result.structured_output;
      break;
    }

    // Totals across every attempt, not just the one that succeeded -- and only
    // when every attempt's spend was observed. An attempt that produced no
    // result event has an UNKNOWN cost, and a sum that skips it is a number
    // presented as a total. So: per-attempt figures carry their nulls, and the
    // top-level total exists only when nothing is missing from it.
    const costComplete = attempts.every((a) => typeof a.costUsd === "number");
    const costUsd = costComplete ? attempts.reduce((sum, a) => sum + a.costUsd, 0) : null;
    const usage = mergeUsage(attempts.map((a) => a.modelUsage));

    if (isProbe) assertProbeRoundTrip(output, probeNonce, surface);

    return {
      role,
      definitionPath: contract.definitionPath,
      definitionCommit: contract.definitionCommit,
      roleDefinitionSha256: sha256(definitionText),
      schemaPath: schemaRel,
      briefSha256,
      briefSource: "script-generated",
      headAtSpawn,
      treeCleanAtSpawn,
      modelTier: contract.modelTier,
      modelRequested: contract.model,
      effortRequested: contract.modelEffort,
      answerModel,
      modelUsage: usage,
      costUsd,
      costComplete,
      sessionId,
      init: surface,
      // OBSERVED: the harness's own numbers, and the bound they were held to.
      instructionIsolation: isolation,
      instructionIsolationNote:
        "Harness-side, not the reviewer's word. `promptTokensObserved` is the largest prompt any assistant " +
        "event in this run reported, held below `promptTokensBound` -- what this script composed, plus what " +
        "the run itself delivered, plus a measured allowance for the harness's own framing. That is what " +
        "catches context this dispatch did not send, whatever delivered it and whenever it arrived. " +
        "`pendingAsyncHooks` is the size of the harness's PENDING ASYNCHRONOUS hook registry, which is not a " +
        "count of hooks configured or run: a synchronous hook that injected nothing into the prompt is " +
        "outside what either observation sees. The managed-hook gap narrows here; it does not close.",
      // SELF-REPORTED: kept, and labelled.
      instructionCanary: output?.claudemd ?? null,
      instructionCanaryNote:
        "A self-report by the reviewer, not a harness observation. Recorded beside the observations above, " +
        "never as one of them.",
      nonceMatched: isProbe ? true : null,
      startedAt,
      finishedAt: now(),
      attempts,
      output,
    };
  } catch (e) {
    if (e && !e.attempts) e.attempts = attempts;
    throw e;
  } finally {
    // After every attempt, never between them: the re-ask writes this same
    // path again, and removing it mid-loop would make attempt 2's observation
    // unavailable for a reason of this script's own making.
    fs.rmSync(path.dirname(debugFile), { recursive: true, force: true });
  }
}

/**
 * The harness's debug log, read once and removed.
 *
 * Absent is a refusal upstream, not an empty string here: `--debug-file` was
 * passed, so a missing file is the harness declining to write one, which is
 * "could not observe".
 */
function readDebugFile(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    throw new Error(`the harness wrote no debug log at ${file} (${e.code ?? e.message}), so P2's second observation is unavailable`);
  }
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
  // Everything about how the process ended travels with its output, so the
  // caller can refuse a run that did not exit cleanly rather than trusting
  // whatever was buffered before it died.
  return { stdout, status: res.status, signal: res.signal ?? null, error: res.error ?? null };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const out = { role: null, timeout: 600, pr: null, round: null, snapshot: null };
  const seen = [];
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
    seen.push(a);
    if (a === "--role") out.role = v;
    else if (a === "--timeout") out.timeout = Number(v);
    else if (a === "--pr") out.pr = Number(v);
    else if (a === "--round") out.round = Number(v);
    else if (a === "--mcp-snapshot") out.snapshot = v;
  }
  if (!out.role) throw new Error("--role is required");
  if (!Number.isFinite(out.timeout) || out.timeout <= 0) throw new Error("--timeout must be a positive number of seconds");

  // A flag belonging to ANOTHER role is refused by name. An unrecognised role
  // is left alone: `dispatch` refuses it with the message that says what the
  // actual bar is (a brief generator), which is more use than a flag error.
  const allowed = ROLE_FLAGS[out.role];
  if (allowed) {
    const stray = seen.find((f) => !BASE_FLAGS.includes(f) && !allowed.includes(f));
    if (stray) throw new Error(`role "${out.role}" does not take ${stray}`);
    const missing = allowed.filter((f) => !seen.includes(f));
    if (missing.length) throw new Error(`role "${out.role}" requires ${missing.join(", ")}`);
    if (out.pr !== null && !Number.isInteger(out.pr)) throw new Error("--pr must be a whole number");
    if (out.round !== null && !Number.isInteger(out.round)) throw new Error("--round must be a whole number");
  }
  return out;
}

/**
 * Write the receipt, rebuild David's page from every receipt on this PR, and
 * print the one line that goes to him.
 *
 * The page is rebuilt from ALL receipts rather than appended to, so a round
 * whose publish failed reappears on the next render instead of being lost.
 * The line is printed by this script and pasted verbatim: a line the builder
 * composed would be the builder's account of the independent account.
 */
export function deliverTranslation(root, receipt) {
  // EVERY EXIT FROM HERE PRINTS ONE FIXED LINE. A receipt write, a page render
  // or the `check-ignore` refusal throwing loose would leave the loop with no
  // verbatim status to paste for David -- after the reviewer had already run,
  // and most consequentially on the last round before a merge ask, which is
  // the one the contract says must carry it. (Codex, #81 round 1.)
  try {
    const out = receiptPathFor(root, receipt);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
    process.stderr.write(`fable-dispatch: receipt -> ${path.relative(root, out)}\n`);
    // Enumerate-render-write is not one step, and the rounds are detached:
    // `publishPage` re-reads afterwards so a concurrent delivery's round
    // cannot be overwritten out of the page.
    const page = publishPage(root, receipt.pr);
    process.stderr.write(`fable-dispatch: page -> ${page}\n`);
    process.stdout.write(`${chatLine(receipt)}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`fable-dispatch: ${e.message}\n`);
    process.stdout.write(`${unpublished(receipt.round, oneLine(e.message))}\n`);
    return 1;
  }
}

/**
 * The round-translation path: build the record, skip or dispatch, deliver.
 *
 * Every refusal before the dispatch prints the SAME fixed notice the delivered
 * line uses, naming the step that stopped -- so what reaches David when there
 * is nothing to publish is not the builder's wording either (Codex, plan
 * round 3).
 */
function runTranslation(root, args) {
  let record;
  try {
    const snapshot = JSON.parse(fs.readFileSync(args.snapshot, "utf8"));
    assertSnapshotIsForPr(args.pr, snapshot);
    record = buildTranslationRecord(snapshot, args.round);
  } catch (e) {
    process.stderr.write(`fable-dispatch: ${e.message}\n`);
    process.stdout.write(`${unavailable(args.round, oneLine(e.message))}\n`);
    return 1;
  }

  const skip = skipReason(record);
  if (skip) {
    return deliverTranslation(root, {
      role: "round-translation",
      pr: args.pr,
      round: args.round,
      skipped: true,
      reason: skip,
      headAtSpawn: record.pr.headSha,
      finishedAt: new Date().toISOString(),
    });
  }

  let receipt;
  try {
    receipt = dispatch({ root, role: args.role, timeoutSec: args.timeout, input: { record } });
  } catch (e) {
    process.stderr.write(`fable-dispatch: ${e.message}\n`);
    if (Array.isArray(e.attempts) && e.attempts.length) {
      process.stderr.write(`fable-dispatch: ${e.attempts.length} attempt(s) had already run: ${JSON.stringify(e.attempts)}\n`);
    }
    process.stdout.write(`${unavailable(args.round, oneLine(e.message))}\n`);
    return e.exitCode ?? 1;
  }
  return deliverTranslation(root, { ...receipt, pr: args.pr, round: args.round, record });
}

/**
 * The round this invocation was FOR, read straight off argv.
 *
 * Needed only when `parseArgs` threw, so nothing validated is available. It is
 * deliberately forgiving -- a malformed `--round` is one of the failures this
 * path exists to report -- and says `?` rather than inventing a number, so the
 * notice never names a round the operator did not ask for.
 */
const roundFromArgv = (argv) => {
  const i = argv.indexOf("--round");
  const raw = i >= 0 ? argv[i + 1] : undefined;
  return /^\d+$/.test(raw ?? "") ? raw : "?";
};

export function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`fable-dispatch: ${e.message}\n`);
    // A round-translation invocation owes David one fixed line on stdout
    // whatever went wrong, and an argument failure threw before `runTranslation`
    // could give him one -- so the log's last line was a raw diagnostic he has
    // no reason to recognise. The role is read from argv rather than from the
    // parse that just failed, which is the whole point: the parse produced
    // nothing. Everything specific still goes to stderr, where the operator
    // reads it. (Codex, #81 round 3.)
    const roleAt = argv.indexOf("--role");
    if (roleAt >= 0 && argv[roleAt + 1] === "round-translation") {
      process.stdout.write(`${unavailable(roundFromArgv(argv), oneLine(e.message))}\n`);
    }
    return 1;
  }
  const root = repoRoot();
  if (args.role === "round-translation") return runTranslation(root, args);

  let receipt;
  try {
    receipt = dispatch({ root, role: args.role, timeoutSec: args.timeout });
  } catch (e) {
    process.stderr.write(`fable-dispatch: ${e.message}\n`);
    if (Array.isArray(e.attempts) && e.attempts.length) {
      process.stderr.write(`fable-dispatch: ${e.attempts.length} attempt(s) had already run: ${JSON.stringify(e.attempts)}\n`);
    }
    return e.exitCode ?? 1;
  }
  const out = receiptPathFor(root, receipt);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stderr.write(`fable-dispatch: receipt -> ${path.relative(root, out)}\n`);
  return 0;
}

// `pathToFileURL(process.argv[1]).href` rather than a hand-built `file://`
// string: they differ whenever the checkout path needs escaping (a space, a
// `#`), and AI-Handbook #11 records a guard that exited 0 having evaluated
// nothing for exactly that reason.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
