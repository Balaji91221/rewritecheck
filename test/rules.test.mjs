import test from "node:test";
import assert from "node:assert/strict";
import { checkConstraint } from "../dist/rules.js";

const literal = (quote, extra = {}) => ({ id: "literal", kind: "literal", source: { quote }, ...extra });
const limit = (quote = "Use at most 150 words.", extra = {}) => ({ id: "limit", kind: "limit", source: { quote }, operator: "lte", value: 150, unit: "words", ...extra });
const action = (quote = "Run tests.", extra = {}) => ({ id: "action", kind: "action", source: { quote }, action: "run", target: "tests", policy: "require", ...extra });

function check(constraint, rewritten) {
  const original = { start: 7, end: 7 + constraint.source.quote.length, text: constraint.source.quote };
  const result = checkConstraint(constraint, original, rewritten);
  assert.deepEqual(result.original, original);
  for (const span of result.rewritten) {
    assert.equal(rewritten.slice(span.start, span.end), span.text);
    assert.ok(span.end > span.start);
  }
  return result;
}

test("literal presence keeps exact UTF-16 evidence after emoji", () => {
  const result = check(literal("A+B (v2)"), "🔎 Keep A+B (v2); repeat A+B (v2).");
  assert.equal(result.status, "preserved");
  assert.equal(result.rewritten.length, 2);
  assert.equal(result.rewritten[0].start, 8);
});

test("literal casing is explicit and regex metacharacters are literal", () => {
  assert.equal(check(literal("JSON"), "Use json").status, "missing");
  assert.equal(check(literal("JSON", { caseSensitive: false }), "Use json").status, "preserved");
  assert.equal(check(literal("a.b"), "axb").status, "missing");
  const result = check(literal("k", { caseSensitive: false }), "🙂 K");
  assert.equal(result.rewritten[0].text, "K");
  assert.equal(result.rewritten[0].start, 3);
});

test("literal rule intentionally checks presence even inside negated prose", () => {
  assert.equal(check(literal("JSON"), "Do not return JSON.").status, "preserved");
});

test("source evidence mismatch remains uncertain", () => {
  assert.equal(checkConstraint(literal("x"), { start: 0, end: 1, text: "y" }, "x").status, "uncertain");
});

test("equivalent explicit numeric operators preserve exact evidence", () => {
  const result = check(limit(), "🙂.\nKeep the answer no more than 150 words.");
  assert.equal(result.status, "preserved");
  assert.equal(result.rewritten[0].text, "no more than 150 words");
  assert.equal(check(limit(), "Please use up to 150 words.").status, "preserved");
});

test("numeric values and operators must both match, even stricter bounds", () => {
  for (const rewrite of ["Use at most 100 words.", "Use under 150 words.", "Use exactly 150 words.", "Use at least 150 words."]) {
    assert.equal(check(limit(), rewrite).status, "changed", rewrite);
  }
});

test("all declared bound operators are recognized", () => {
  for (const [operator, phrase] of [["lt", "less than"], ["lte", "at most"], ["eq", "exactly"], ["gte", "no fewer than"], ["gt", "more than"]]) {
    const quote = `Use ${phrase} 12 words.`;
    assert.equal(check(limit(quote, { operator, value: 12 }), quote).status, "preserved");
  }
});

test("decimal bounds are not split at their decimal point", () => {
  const c = limit("Use under 1.5 seconds.", { operator: "lt", value: 1.5, unit: "seconds" });
  assert.equal(check(c, "Keep it under 1.5 seconds.").status, "preserved");
  assert.equal(check(c, "Use under 1.6 seconds.").status, "changed");
});

test("numeric source must support declaration", () => {
  assert.equal(check(limit("Use at least 150 words."), "Use at most 150 words.").status, "uncertain");
  assert.equal(check(limit("Use at most 99 words."), "Use at most 150 words.").status, "uncertain");
  assert.equal(check(limit("If needed, use at most 150 words."), "Use at most 150 words.").status, "uncertain");
});

test("unsupported numeric scope cannot produce a pass", () => {
  for (const rewrite of [
    'Say "at most 150 words".',
    "If asked, use at most 150 words.",
    "Do not use at most 150 words.",
    "Use at most 150 words and include a table.",
    "Use about 150 words.",
    "Use at most one hundred fifty words.",
    "The phrase at most 150 words is misleading.",
  ]) assert.equal(check(limit(), rewrite).status, "uncertain", rewrite);
});

test("missing bounds and unsupported units stay reviewable", () => {
  assert.equal(check(limit(), "Keep it brief.").status, "missing");
  assert.equal(check(limit(), "Use at most 150 tokens.").status, "missing");
  assert.equal(check(limit(), "Use at most 150 wordsmiths.").status, "missing");
});

test("repeated identical bounds pass but differing bounds require review", () => {
  assert.equal(check(limit(), "Use at most 150 words. Keep at most 150 words.").status, "preserved");
  assert.equal(check(limit(), "Use at most 150 words. Use at least 150 words.").status, "uncertain");
});

test("positive and negative imperative aliases preserve polarity", () => {
  const c = action("Run tests.", { aliases: ["execute"] });
  assert.equal(check(c, "Please execute tests.").status, "preserved");
  for (const rewrite of ["Do not run tests.", "Don't run tests.", "Never execute tests.", "Don’t execute tests."]) {
    assert.equal(check(c, rewrite).status, "contradicted", rewrite);
  }
  const forbidden = action("Do not run tests.", { policy: "forbid" });
  assert.equal(check(forbidden, "Never run tests.").status, "preserved");
  assert.equal(check(forbidden, "Run tests.").status, "contradicted");
});

test("action source declarations must match supported polarity and operand", () => {
  assert.equal(check(action("Do not run tests."), "Run tests.").status, "uncertain");
  assert.equal(check(action("Run builds."), "Run tests.").status, "uncertain");
  assert.equal(check(action("Run tests if necessary."), "Run tests.").status, "uncertain");
});

test("unsupported action scope and changed targets do not pass", () => {
  for (const rewrite of [
    '"Run tests."', "If needed, run tests.", "Run tests and deploy.",
    "Run tests in staging.", "Run tests only after approval.", "Run builds.",
    "You might run tests.", "Do not forget to run tests.", "Run tests without checking results.",
  ]) assert.equal(check(action(), rewrite).status, "uncertain", rewrite);
});

test("missing action differs from recognized action with uncertain scope", () => {
  assert.equal(check(action(), "Write documentation.").status, "missing");
  assert.equal(check(action(), "Runners test the system.").status, "missing");
});

test("conflicting imperatives require review", () => {
  assert.equal(check(action(), "Run tests. Never run tests.").status, "uncertain");
  assert.equal(check(action(), "Run tests. Run tests.").status, "preserved");
});

test("an omitted target retains the source operand rather than widening scope", () => {
  const c = action("Run tests.", { target: undefined });
  assert.equal(check(c, "Run tests.").status, "preserved");
  assert.equal(check(c, "Run tests in production.").status, "uncertain");
  assert.equal(check(c, "Run.").status, "uncertain");
});

test("simple bullet lists preserve exact evidence", () => {
  assert.equal(check(action(), "- Run tests.\n- Write documentation.").status, "preserved");
  assert.equal(check(limit(), "- Use at most 150 words.\n- Write clearly.").status, "preserved");
});

test("questions and quotation or conditional scope across lines require review", () => {
  for (const rewrite of ["Run tests?", '"Example:\nRun tests.\n"', "If asked:\nRun tests.", "Example:\nRun tests."]) {
    assert.equal(check(action(), rewrite).status, "uncertain", rewrite);
  }
  for (const rewrite of ["Use at most 150 words?", '"Example:\nUse at most 150 words.\n"', "If asked:\nUse at most 150 words."]) {
    assert.equal(check(limit(), rewrite).status, "uncertain", rewrite);
  }
});

test("literal evidence is bounded even for a million occurrences", () => {
  const result = check(literal("a"), "a".repeat(1_000_000));
  assert.equal(result.status, "preserved");
  assert.equal(result.rewritten.length, 64);
});

test("candidate overflow is uncertain rather than hiding a later contradiction", () => {
  const a = check(action(), "Run tests.\n".repeat(1_000) + "Never run tests.");
  assert.equal(a.status, "uncertain");
  assert.equal(a.rewritten.length, 64);
  const b = check(limit(), "Use at most 150 words.\n".repeat(1_000) + "Use at least 150 words.");
  assert.equal(b.status, "uncertain");
  assert.equal(b.rewritten.length, 64);
  assert.equal(check(action(), "Run tests.\n".repeat(64)).status, "preserved");
  assert.equal(check(limit(), "Use at most 150 words.\n".repeat(64)).status, "preserved");
});

test("unsegmented and unsupported numeric evidence is also bounded", () => {
  const result = check(limit(), "at most 150 words ".repeat(10_000));
  assert.equal(result.status, "uncertain");
  assert.equal(result.rewritten.length, 64);
  const related = check(limit(), "Use many words.\n".repeat(1_000));
  assert.equal(related.status, "uncertain");
  assert.equal(related.rewritten.length, 64);
});
