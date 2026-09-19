#!/usr/bin/env node
/**
 * Does every dispatched-judgement role declare the tier it is named for?
 *
 * WHAT THIS REFUSES, AND WHY IT IS A CHECK RATHER THAN A HABIT. Two roles in
 * this payload are named for the model they are supposed to run as --
 * `fable-review-assessor` and `fable-round-translation`. Until #126 neither
 * declared one. The Agent tool's resolution order is per-invocation argument,
 * then the definition's frontmatter, then the session; with no frontmatter and
 * a forgotten argument, a "Fable" role runs on whatever the parent session is.
 * That is not a wrong label: the review loop's second assessment exists to be a
 * DIFFERENT model from the one that wrote the code, and an Opus assessor
 * dispatched from an Opus session holding the tie-break is the design failing
 * silently while reporting success. Measured on #124: seven consecutive rounds
 * dispatched the translator with no argument and every one ran as the session.
 *
 * SO THE MODEL LIVES IN THE DEFINITION, AND THE PIN STAYS THE ONE SOURCE. The
 * tier is `.agents/machinery.json`'s `models.strongestClaude` -- one file David
 * edits by hand when the state of the art moves. The frontmatter is a derived
 * copy of it, and this check is what makes the two identical rather than
 * merely intended to be. `--fix` rewrites the definitions from the pin, so his
 * one-line edit propagates instead of being remembered by whoever dispatches
 * next. It is the shape `check-root-wiring.mjs` already uses for the mirrored
 * `.gitignore` files: two places, held equal mechanically.
 *
 * THE FRONTMATTER IS A FLOOR, NOT AN OVERRIDE, which is what makes a second
 * copy safe here. A per-invocation `model:` outranks it (measured 2026-09-18:
 * a definition pinning `opus` dispatched with `sonnet` ran Sonnet), so a
 * consumer whose own pin differs still gets its own tier through the dispatch
 * argument the skills pass. What the frontmatter changes is the forgotten-
 * argument case, which stops being a silent inherit and becomes a deterministic
 * model that the dispatch's own stamp can contradict out loud.
 *
 * AND IT IS THE ONLY ROUTE FOR EFFORT. The Agent tool takes a model and no
 * reasoning-effort argument; frontmatter `effort:` is honoured (measured the
 * same day: the same role, same question, spent 151 output tokens at `low` and
 * 3,862 at `max`). Before #126 the pin's `xhigh` reached nothing, and every
 * #124 translation ran at the session's `high` against it.
 *
 * WHICH ROLES ARE IN SCOPE: the ones whose `name` begins with `fable-`. The
 * convention is not decoration -- it is the claim being checked, since a role
 * named for a model is exactly the role where running as something else is a
 * misreport rather than a preference. The limit worth naming: if the pin ever
 * moves to a different family, these names go stale and this check still
 * passes, because it compares the declaration to the pin and not the name to
 * either. Renaming the roles is that change's own work.
 *
 * WHY IT RUNS HERE AND NOT IN A CONSUMER. The definitions are payload, so a
 * consumer receives them carrying THIS repository's pin, and a consumer must
 * not edit a synced file -- the next sync overwrites it. A check shipped to
 * them would therefore be permanently red for anyone pinning a different tier,
 * with no fix available. So it guards the authoring side, here, and
 * `docs/consuming-repos.md` states the consequence for a consumer plainly.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { modelTier, nodeIo } from "../core/scripts/machinery.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, "..");

/** Where the payload's agent definitions live, in this repository's layout. */
export const AGENTS_DIR = join("core", ".claude", "agents");

/**
 * The roles whose model is a claim rather than a preference. See the header.
 */
export const PINNED_PREFIX = "fable-";

/** The frontmatter keys this check owns. Order is the order `--fix` writes. */
export const PINNED_KEYS = ["model", "effort"];

/**
 * Split a definition into its frontmatter lines and the rest.
 *
 * DELIBERATELY NOT A YAML PARSER. The only shapes here are `key: value` on one
 * line, and a hand-rolled parser chasing a real language's syntax is named in
 * this repository's own archive as a losing shape. What it must not do is
 * quietly accept a file it did not understand: no leading `---`, or no closing
 * `---`, is a refusal, because a definition whose frontmatter this cannot read
 * is one whose `model:` it cannot check -- and reporting a pass on that is the
 * worst failure available to a checker.
 */
export function splitFrontmatter(text) {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end === -1) return null;
  return { head: lines.slice(1, end), body: lines.slice(end + 1), endIndex: end };
}

/** `key: value` for the flat keys this check reads. Later wins, as YAML does. */
export function frontmatterValue(head, key) {
  let found = null;
  for (const line of head) {
    const m = new RegExp(`^${key}\\s*:\\s*(.*)$`).exec(line);
    if (m) found = m[1].trim().replace(/^["']|["']$/g, "");
  }
  return found;
}

/** Every agent definition in the payload, with its declared name. */
export function agentDefinitions(root = REPO_ROOT) {
  const dir = join(root, AGENTS_DIR);
  if (!existsSync(dir)) {
    throw new Error(
      `check-agent-models: ${AGENTS_DIR} does not exist, so there are no agent definitions to check. ` +
        `This check runs in the handbook, where the payload's roles are authored.`,
    );
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const file = join(dir, f);
      const text = readFileSync(file, "utf8");
      const parts = splitFrontmatter(text);
      return {
        file,
        rel: relative(root, file).split(/[\\/]/).join("/"),
        text,
        parts,
        name: parts ? frontmatterValue(parts.head, "name") : null,
      };
    });
}

/**
 * What each undeclared key actually costs, said in the finding itself.
 *
 * THEY ARE NOT THE SAME CONSEQUENCE and one sentence for both hid that. A
 * missing `model:` is overridden by the dispatch argument, so it bites only
 * when the argument is forgotten. A missing `effort:` bites ALWAYS, because
 * the Agent tool has no effort argument at all -- frontmatter is the only
 * route, so an undeclared effort is the session's, every time, with nothing
 * that could override it back.
 */
export const WHY = {
  model: (name) =>
    `A role named ${JSON.stringify(name)} that does not declare its tier runs as whatever the dispatching ` +
    `session is whenever the per-invocation argument is omitted -- which is how seven consecutive #124 ` +
    `rounds ran as Opus under Fable's name.`,
  effort: (name) =>
    `Frontmatter is the ONLY route for effort -- the Agent tool takes no effort argument -- so ` +
    `${JSON.stringify(name)} runs at the dispatching session's effort every time, and the pinned value ` +
    `reaches nothing.`,
};

/**
 * The problems, as sentences. Empty means the declarations match the pin.
 *
 * A MISSING DECLARATION AND A WRONG ONE ARE THE SAME FINDING, deliberately.
 * Both end with the role running as something nobody chose, and splitting them
 * would invite treating the absent one as the softer case -- which is exactly
 * backwards: absent is the shape that inherits the session silently, and wrong
 * is the shape a stamp can contradict.
 */
export function findings(root = REPO_ROOT, io = nodeIo(root)) {
  const pin = modelTier("strongestClaude", io);
  const expected = { model: pin.id, effort: pin.effort };
  const out = [];
  for (const def of agentDefinitions(root)) {
    if (!def.parts) {
      out.push(
        `${def.rel}: no readable frontmatter block (a file starting with \`---\` and closed by \`---\`), so ` +
          `nothing here can tell which model this role runs as.`,
      );
      continue;
    }
    if (!def.name?.startsWith(PINNED_PREFIX)) continue;
    for (const key of PINNED_KEYS) {
      const found = frontmatterValue(def.parts.head, key);
      if (found === expected[key]) continue;
      out.push(
        `${def.rel}: frontmatter \`${key}:\` is ${found === null ? "absent" : JSON.stringify(found)}, but ` +
          `.agents/machinery.json pins models.strongestClaude.${key === "model" ? "id" : "effort"} to ` +
          `${JSON.stringify(expected[key])}. ${WHY[key](def.name)}`,
      );
    }
  }
  return out;
}

/**
 * Rewrite the pinned definitions from the pin. Returns the files it changed.
 *
 * IT EDITS THE FRONTMATTER AND NOTHING ELSE. An existing key is replaced in
 * place, so a definition keeps its own key order and its comments; an absent
 * one is appended at the end of the block rather than guessed into a position.
 */
export function fix(root = REPO_ROOT, io = nodeIo(root)) {
  const pin = modelTier("strongestClaude", io);
  const expected = { model: pin.id, effort: pin.effort };
  const changed = [];
  for (const def of agentDefinitions(root)) {
    if (!def.parts || !def.name?.startsWith(PINNED_PREFIX)) continue;
    const head = [...def.parts.head];
    let touched = false;
    for (const key of PINNED_KEYS) {
      if (frontmatterValue(head, key) === expected[key]) continue;
      const at = head.findIndex((line) => new RegExp(`^${key}\\s*:`).test(line));
      if (at === -1) head.push(`${key}: ${expected[key]}`);
      else head[at] = `${key}: ${expected[key]}`;
      touched = true;
    }
    if (!touched) continue;
    writeFileSync(def.file, ["---", ...head, "---", ...def.parts.body].join("\n"));
    changed.push(def.rel);
  }
  return changed;
}

export function main(argv = process.argv.slice(2), { root = REPO_ROOT, io = undefined, log = console.error } = {}) {
  const resolved = io ?? nodeIo(root);
  if (argv.some((a) => a !== "--fix")) {
    log(`check-agent-models: usage: node scripts/check-agent-models.mjs [--fix]`);
    return 2;
  }
  let problems;
  try {
    if (argv.includes("--fix")) {
      const changed = fix(root, resolved);
      if (changed.length) log(`check-agent-models: rewrote ${changed.join(", ")} from the pin.`);
    }
    problems = findings(root, resolved);
  } catch (err) {
    log(`check-agent-models: ${err.message}`);
    return 2;
  }
  if (problems.length === 0) return 0;
  log(
    [
      `check-agent-models: ${problems.length} role declaration${problems.length === 1 ? "" : "s"} disagree with the pin.`,
      "",
      ...problems.map((p) => `  - ${p}`),
      "",
      "  Run `node scripts/check-agent-models.mjs --fix` to rewrite them from .agents/machinery.json.",
    ].join("\n"),
  );
  return 1;
}

// `pathToFileURL`, never a hand-built `file://` string: the two differ whenever
// the checkout path needs escaping, and a script that never runs exits 0.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
