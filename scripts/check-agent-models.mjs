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

// THE FRONTMATTER READER IS SHARED, NOT COPIED. `review-proxy.mjs` reads the
// same `effort:` this check holds equal to the pin, and two readers of one
// fact is the drift this file exists to prevent. Payload code cannot import
// this handbook-only checker, so the shared copy lives in the payload and the
// checker imports it. (Both assessors, #131 round 1.)
import { modelTier, nodeIo, splitFrontmatter, frontmatterValue, MODEL_TIERS } from "../core/scripts/machinery.mjs";

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
 * The other derived copy of the pin in the payload: the seed a fresh consumer's
 * `.agents/machinery.json` is created from.
 *
 * WHY IT BELONGS TO THIS CHECK. The file above says the frontmatter is "a
 * derived copy of the pin, and this check is what makes the two identical".
 * The seed is the second derived copy, and it was not held to anything --
 * its own prose asked a person to "check it before relying on it", which is
 * the recall-it-yourself shape the whole issue is about.
 *
 * THE CONSEQUENCE IS THE ONE THE MISMATCH WARNING CANNOT CATCH. The sync
 * seeds this once and then leaves a consumer's configuration alone, by
 * design. So after a pin bump here, a repository enrolled tomorrow starts on
 * the OLD model -- and because its dispatch argument comes from that stale
 * seed and outranks the freshly synced frontmatter, the header and the role's
 * own "running as" line would agree with each other on the wrong model.
 * Nothing fires. (Codex `4051922489`, #131 round 1; both assessors concurred
 * and traced the chain independently through `sync.mjs`.)
 *
 * WHAT IS NOT TOUCHED: an existing consumer's own `.agents/machinery.json`.
 * That is theirs, the sync never overwrites it, and this check never reaches
 * outside this repository.
 */
export const SEED_FILE = join("core", ".agents", "machinery.template.json");

export { splitFrontmatter, frontmatterValue };

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
  out.push(...seedFindings(root, io));
  return out;
}

/** The seed, parsed, or a finding sentence explaining why it could not be. */
function readSeed(root) {
  const file = join(root, SEED_FILE);
  if (!existsSync(file)) return { problem: `${SEED_FILE}: missing, so a fresh consumer has nothing to be seeded from.` };
  try {
    const raw = readFileSync(file, "utf8");
    return { file, raw, seed: JSON.parse(raw) };
  } catch (err) {
    return { problem: `${SEED_FILE}: could not be read as JSON (${err.message}), so its pinned models cannot be checked.` };
  }
}

/**
 * BOTH TIERS, not just the Claude one.
 *
 * The definitions only carry `strongestClaude`, so the loop above checks only
 * that. The seed carries both, and the drift mechanism is identical for each:
 * a consumer enrolled after a bump starts on the superseded value. Checking
 * one and not the other would leave half the seed silently stale, which is the
 * same defect with a different tier's name on it.
 */
function seedFindings(root, io) {
  const read = readSeed(root);
  if (read.problem) return [read.problem];
  const models = read.seed?.models;
  if (!models || typeof models !== "object") {
    return [`${SEED_FILE}: declares no "models" block, so a fresh consumer would be seeded with no pin at all.`];
  }
  const out = [];
  for (const tier of MODEL_TIERS) {
    const pin = modelTier(tier, io);
    for (const [field, want] of [["id", pin.id], ["effort", pin.effort]]) {
      const found = models[tier] && typeof models[tier] === "object" ? models[tier][field] : undefined;
      if (found === want) continue;
      out.push(
        `${SEED_FILE}: models.${tier}.${field} is ${found === undefined ? "absent" : JSON.stringify(found)}, but ` +
          `.agents/machinery.json pins it to ${JSON.stringify(want)}. This file seeds a fresh consumer's own pin, ` +
          `and its dispatch argument then outranks the synced role definitions -- so a repository enrolled after a ` +
          `bump here would keep dispatching the old value with both sides of the mismatch warning agreeing.`,
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
  // THE SEED IS REWRITTEN THROUGH ITS OWN PARSE, so every other key keeps its
  // place and its prose -- the `_README`, the `OWNER/REPO` placeholder that is
  // refused by name if left, and the `_models` note. Only the two values per
  // tier move. (The file round-trips byte-identically through
  // `JSON.stringify(_, null, 2)`, verified before this was written; a test
  // asserts the untouched keys survive.)
  const read = readSeed(root);
  if (read.seed && read.seed.models && typeof read.seed.models === "object") {
    let touched = false;
    for (const tier of MODEL_TIERS) {
      const pin = modelTier(tier, io);
      const entry = read.seed.models[tier];
      if (!entry || typeof entry !== "object") continue;
      for (const [field, want] of [["id", pin.id], ["effort", pin.effort]]) {
        if (entry[field] === want) continue;
        entry[field] = want;
        touched = true;
      }
    }
    if (touched) {
      writeFileSync(read.file, `${JSON.stringify(read.seed, null, 2)}\n`);
      changed.push(SEED_FILE.split(/[\\/]/).join("/"));
    }
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
      // "declaration", not "role declaration": one of the things checked is the
      // consumer seed, which is not a role.
      `check-agent-models: ${problems.length} declaration${problems.length === 1 ? "" : "s"} disagree with the pin.`,
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
