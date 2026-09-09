import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONSUMER_OWNED, danglingReferences, linkTargets, resolveFrom,
} from "../check-payload-portability.mjs";

const fresh = () => mkdtempSync(join(tmpdir(), "portability-test-"));
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** A throwaway payload tree, so nothing here reads the real `core/`. */
function payloadWith(files) {
  const root = fresh();
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

// ── what counts as a link ──────────────────────────────────────────────────

test("a plain markdown link is a reference", () => {
  assert.deepEqual(linkTargets("see [x](./a.md) here"), ["./a.md"]);
});

test("an anchor is stripped, because the file is what has to exist", () => {
  assert.deepEqual(linkTargets("[x](./a.md#section)"), ["./a.md"]);
  // A same-document link names no file, so it drops out here rather than
  // needing a `#` case in the external filter. The parser rewrite regressed
  // this — it returned the href verbatim — which is why the fragment split is
  // now explicit rather than incidental.
  assert.deepEqual(linkTargets("[x](#section)"), []);
});

test("FENCED CODE IS NOT PROSE", () => {
  // The finding that shaped this check. `writing-skills/anthropic-best-practices.md`
  // illustrates skill layout with a fictional `pdf/` skill; twelve of its
  // example links were reported as breakage by a first pass that did not
  // understand fences. Flagging correct documentation is how a check gets
  // suppressed wholesale, and a suppressed check protects nothing.
  //
  // These assertions outlived the implementation they were written against.
  // They are kept ON PURPOSE: the reader was replaced wholesale, and a rewrite
  // that quietly regressed the behaviour the old one got right would be a
  // straight trade rather than a fix.
  const text = [
    "real [a](./a.md)",
    "```",
    "example [FORMS.md](FORMS.md)",
    "```",
    "also real [b](./b.md)",
  ].join("\n");
  assert.deepEqual(linkTargets(text), ["./a.md", "./b.md"]);
});

test("a nested fence closes only on a run at least as long as its opener", () => {
  // That same file nests ``` inside ````. A naive toggle reads the rest of the
  // file as prose and every later example link becomes a false positive.
  // This shape DISCRIMINATES, which the first version of this test did not:
  // there, fence parity hid the link under both implementations, so it passed
  // against the naive toggle and proved nothing. Here the link sits between
  // the two inner fences, which a naive toggle reads as OUTSIDE the block.
  // CommonMark gets this by construction; the assertion stays because the
  // property is what matters, not which implementation supplies it.
  const text = [
    "````",
    "```",
    "[FORMS.md](FORMS.md)",
    "```",
    "````",
    "real [a](./a.md)",
  ].join("\n");
  assert.deepEqual(linkTargets(text), ["./a.md"]);
});

test("a tilde fence is a fence too, and does not close a backtick fence", () => {
  assert.deepEqual(linkTargets("~~~\n[x](./x.md)\n~~~\n[y](./y.md)"), ["./y.md"]);
  assert.deepEqual(linkTargets("```\n~~~\n[x](./x.md)\n```\n[y](./y.md)"), ["./y.md"]);
});

test("inline code is talked about, not linked to", () => {
  assert.deepEqual(linkTargets("use `[x](./nope.md)` then [y](./y.md)"), ["./y.md"]);
});

test("a reference definition is a link, or the syntax is a hole in the check", () => {
  // `[text][g]` with `[g]: ./missing.md` was invisible: linkTargets returned []
  // and CI passed over a broken reference. A check with a syntax hole silently
  // passes, which is the failure this whole file exists to prevent.
  assert.deepEqual(linkTargets("See [the guide][g].\n\n[g]: ./missing.md\n"), ["./missing.md"]);
  assert.deepEqual(linkTargets('[g]: ./missing.md "Title"'), ["./missing.md"]);
  assert.deepEqual(linkTargets("[g]: <./missing.md>"), ["./missing.md"], "angle brackets are link syntax, not a placeholder");
  // A definition NOTHING references still names a file that must exist, so it
  // is collected from the lexer's definition table rather than from the token
  // tree, where an unused definition never appears.
  assert.deepEqual(linkTargets("[unused]: ./orphan.md\n"), ["./orphan.md"]);
});

test("a reference definition inside a fence is still an example", () => {
  assert.deepEqual(linkTargets("```\n[g]: ./missing.md\n```"), []);
});

test("a dangling reference-style link is reported end to end", () => {
  const root = payloadWith({ "docs/a.md": "See [g][g].\n\n[g]: ./gone.md\n" });
  try {
    const rows = danglingReferences(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].resolved, "docs/gone.md");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── the six round-3 findings, one test each ────────────────────────────────
//
// Every one of these is a case the hand-rolled reader got wrong. They are
// written as behaviour, not as "the parser handles it", so they stay
// meaningful if the parser is ever swapped again — and each was watched
// failing against the previous implementation before the rewrite landed.
// The reader was wrong EIGHT times across three rounds; that count, not any
// individual defect, is what bought a real parser. (Codex, #62 rounds 1-3.)

test("a link title is not part of the destination", () => {
  // `[x](./guide.md "Title")` resolved to `./guide.md "Title"`, which exists
  // nowhere — a false positive on correct markdown, and the kind that gets a
  // required check disabled rather than fixed.
  assert.deepEqual(linkTargets('[x](./guide.md "Title")'), ["./guide.md"]);
  assert.deepEqual(linkTargets("[x](./guide.md 'Title')"), ["./guide.md"]);
  assert.deepEqual(linkTargets("[x](./guide.md (Title))"), ["./guide.md"]);
});

test("a footnote definition is not a reference definition", () => {
  // `[^1]: text` matched the `[label]: dest` shape, so the footnote's first
  // word was resolved as a path. Same false-positive class, different syntax.
  assert.deepEqual(linkTargets("Text.[^1]\n\n[^1]: a note about ./nothing.md\n"), []);
});

test("a code span of any delimiter length is code", () => {
  // The reader knew single backticks only, so ``a `b` c`` — the form used
  // precisely when the content itself contains a backtick — leaked its links.
  assert.deepEqual(linkTargets("``a `b` [x](./nope.md)`` then [y](./y.md)"), ["./y.md"]);
  assert.deepEqual(linkTargets("```[x](./nope.md)``` then [y](./y.md)"), ["./y.md"]);
});

test("four leading spaces open an indented code block, not a fence", () => {
  // The reader treated an indented ``` as a fence opener and read everything
  // after it as code — silently blinding the check to the whole rest of the
  // file. This is the dangerous direction: a FALSE NEGATIVE, which no one
  // sees, unlike the noisy false positives above.
  assert.deepEqual(linkTargets("    ```\nreal [a](./missing.md)\n"), ["./missing.md"]);
});

test("a URI scheme is any scheme, not a three-name allowlist", () => {
  // The allowlist held lowercase http, https and mailto. Schemes are
  // case-insensitive and open-ended, so `tel:`, `data:` and `HTTPS:` were
  // resolved as local paths and reported as missing files.
  const root = payloadWith({
    "a.md": "[a](tel:+15551234) [b](HTTPS://example.com/x.md) [c](data:text/plain,hi) [d](//host/p.md)",
  });
  try {
    assert.deepEqual(danglingReferences(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a target that climbs above the root is REPORTED, not normalised away", () => {
  // `parts.pop()` on an empty array does nothing, so `../../CLAUDE.md` from
  // `docs/a.md` came back as `CLAUDE.md` — which is in CONSUMER_OWNED, so a
  // link escaping the repository entirely was laundered into a pass. The
  // worst shape a check can have: it reported success about the exact case it
  // was asked to judge.
  assert.equal(resolveFrom("docs/a.md", "../../CLAUDE.md"), null);
  assert.equal(resolveFrom("a.md", "../CLAUDE.md"), null);
  const root = payloadWith({ "docs/a.md": "see [x](../../CLAUDE.md)" });
  try {
    const rows = danglingReferences(root);
    assert.equal(rows.length, 1, "an escaping link must be reported");
    assert.equal(rows[0].resolved, null);
    assert.equal(rows[0].target, "../../CLAUDE.md");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a root-absolute target resolves from the root, not from the linking file", () => {
  // Found while fixing the one above: `/docs/a.md` split to an empty leading
  // segment, which the loop skipped, so the path was appended to the linking
  // file's own directory. Not a Codex finding — a neighbour of one, and the
  // reason to look around a defect rather than only at it.
  assert.equal(resolveFrom("docs/ai-context/y.md", "/docs/a.md"), "docs/a.md");
});

// ── resolution ─────────────────────────────────────────────────────────────

test("targets resolve against the file's DESTINATION path", () => {
  // A consumer is where the breakage happens, so `core/` must not appear.
  assert.equal(resolveFrom("docs/ai-context/a.md", "./b.md"), "docs/ai-context/b.md");
  assert.equal(resolveFrom("docs/ai-context/a.md", "../tests/b.md"), "docs/tests/b.md");
  assert.equal(resolveFrom(".claude/skills/x/SKILL.md", "../../../docs/a.md"), "docs/a.md");
  assert.equal(resolveFrom("docs/a.md", "b.md"), "docs/b.md", "a bare name is a sibling");
});

// ── what gets reported ─────────────────────────────────────────────────────

test("a link to a shipped payload file is fine", () => {
  const root = payloadWith({
    "docs/a.md": "see [b](./b.md)",
    "docs/b.md": "hi",
  });
  try {
    assert.deepEqual(danglingReferences(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a link to a path the payload does not ship is reported", () => {
  const root = payloadWith({ "docs/a.md": "see [gone](./gone.md)" });
  try {
    const rows = danglingReferences(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].resolved, "docs/gone.md");
    assert.equal(rows[0].from, "docs/a.md");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a declared consumer-owned path is not breakage", () => {
  const target = [...CONSUMER_OWNED][0];
  const root = payloadWith({ [`${target.split("/")[0]}-holder.md`]: "x" });
  try {
    const withLink = payloadWith({ "a.md": `see [it](./${target})` });
    try {
      assert.deepEqual(danglingReferences(withLink), [], `${target} is declared consumer-owned`);
    } finally {
      rmSync(withLink, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("placeholders are not paths", () => {
  const root = payloadWith({
    "a.md": "[t]({baseDir}/references/x.md)\n[u](.agents/memory/<path>)\n[v](.agents/memory/...)",
  });
  try {
    assert.deepEqual(danglingReferences(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("external links are not this check's business", () => {
  const root = payloadWith({ "a.md": "[x](https://example.com/a.md) [y](mailto:a@b.c) [z](#anchor)" });
  try {
    assert.deepEqual(danglingReferences(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a *.template.* file is matched at the name it lands under", () => {
  // Seeds ship under their real name, so a link to the delivered name resolves
  // even though the payload spells it differently.
  const root = payloadWith({
    ".agents/machinery.template.json": "{}",
    "a.md": "see [config](./.agents/machinery.json)",
  });
  try {
    assert.deepEqual(danglingReferences(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("angle-bracketed destinations are unwrapped on BOTH link syntaxes", () => {
  // Round 1 unwrapped them for reference definitions only. The inline branch
  // kept `<…>`, and isPlaceholder then swallowed it — a false negative hiding
  // inside a false-positive guard, and a fix applied to one of two branches
  // that needed it. (Codex, #62 round 2.)
  assert.deepEqual(linkTargets("[guide](<./missing file.md>)"), ["./missing file.md"]);
  assert.deepEqual(linkTargets("[g]: <./missing.md>"), ["./missing.md"]);
});

test("an angle-bracketed inline link to a missing file is reported, not suppressed", () => {
  const root = payloadWith({ "docs/a.md": "see [x](<./gone file.md>)" });
  try {
    const rows = danglingReferences(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].resolved, "docs/gone file.md");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every consumer document the enrollment guide requires is in CONSUMER_OWNED", () => {
  // Two hand-maintained lists of one thing drift, which is this repository's
  // founding complaint. Round 1 found two files shipped that the guide already
  // owned; round 2 found one owned here that the guide never requires. This
  // closes the direction that BREAKS: a table row missing from the set means a
  // future link to a legitimately consumer-owned document fails CI, inviting
  // someone to "fix" a correct reference.
  //
  // The set may be a SUPERSET — CLAUDE.md and AGENTS.md come from enrollment
  // step 1's prose rather than the table, and two entries are directories.
  const doc = readFileSync(resolve(REPO_ROOT, "docs/consuming-repos.md"), "utf8");
  const rows = [...doc.matchAll(/^\| `([^`]+)` \| /gm)].map((m) => m[1]);
  assert.ok(rows.length > 5, `expected the consumer-owned table, found ${rows.length} rows`);
  const missing = rows.filter((r) => !CONSUMER_OWNED.has(r));
  assert.deepEqual(missing, [], "add these to CONSUMER_OWNED, or remove the row if the document is optional");
});

// ── the handbook's own manifest must not change how payload files execute ──

test("the root package.json declares no `type`, because payload .js is CommonJS", () => {
  // Found by looking around this PR's change rather than at it. `package.json`
  // was added for ONE check's dependency, and a root manifest governs every
  // unscoped file beneath it -- including `core/.claude/skills/`, which holds
  // two CommonJS `.js` files. With `"type": "module"`, render-graphs.js dies
  // on its first `require()` (reproduced: "require is not defined in ES module
  // scope"). Nothing needed the field: every check here is `.mjs`, which is
  // ESM whatever the manifest says.
  //
  // This is a test rather than a comment because the field is exactly what a
  // future editor adds without thinking -- it is the default shape of a modern
  // manifest, and the breakage is two directories away from the edit.
  const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"));
  assert.equal(
    pkg.type,
    undefined,
    'adding "type" to the root manifest reinterprets every unscoped .js beneath it, ' +
      "core/.claude/skills/ included — scope it to a nested package.json instead",
  );
});

// ── the live invariant ─────────────────────────────────────────────────────

test("the real payload has no dangling references", () => {
  assert.deepEqual(
    danglingReferences().map((r) => `${r.from} -> ${r.resolved}`),
    [],
    "ship the target in core/, declare it CONSUMER_OWNED, or drop the link and keep the prose",
  );
});
