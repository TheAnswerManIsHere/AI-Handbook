import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import {
  CONSUMER_OWNED, danglingReferences, linkTargets, resolveFrom,
} from "../check-payload-portability.mjs";

const fresh = () => mkdtempSync(join(tmpdir(), "portability-test-"));

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
});

test("FENCED CODE IS NOT PROSE", () => {
  // The finding that shaped this check. `writing-skills/anthropic-best-practices.md`
  // illustrates skill layout with a fictional `pdf/` skill; twelve of its
  // example links were reported as breakage by a first pass that did not
  // understand fences. Flagging correct documentation is how a check gets
  // suppressed wholesale, and a suppressed check protects nothing.
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

// ── resolution ─────────────────────────────────────────────────────────────

test("targets resolve against the file's DESTINATION path", () => {
  // A consumer is where the breakage happens, so `core/` must not appear.
  assert.equal(resolveFrom("docs/ai-context/a.md", "./b.md"), "docs/ai-context/b.md");
  assert.equal(resolveFrom("docs/ai-context/a.md", "../tests/b.md"), "docs/tests/b.md");
  assert.equal(resolveFrom(".claude/skills/x/SKILL.md", "../../../docs/a.md"), "docs/a.md");
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

// ── the live invariant ─────────────────────────────────────────────────────

test("the real payload has no dangling references", () => {
  assert.deepEqual(
    danglingReferences().map((r) => `${r.from} -> ${r.resolved}`),
    [],
    "ship the target in core/, declare it CONSUMER_OWNED, or drop the link and keep the prose",
  );
});
