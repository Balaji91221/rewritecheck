import test from 'node:test';
import assert from 'node:assert/strict';
import { auditRewrite, auditRewriteWith, AuditInputError, validateAuditInput } from '../dist/index.js';
const literal = (quote = 'alpha') => ({ id: 'keep', kind: 'literal', source: { quote } });
const input = (patch = {}) => ({ original: 'Keep alpha', rewritten: 'Keep alpha', constraints: [literal()], ...patch });
const ambiguous = () => ({ original: 'Do not publish.', rewritten: 'If approved, publish.', constraints: [{ id: 'publish', kind: 'action', source: { quote: 'Do not publish.' }, action: 'publish', policy: 'forbid' }] });

test('aggregate only supplied constraints and retain exact Unicode evidence', () => {
  const report = auditRewrite(input({ original: '😀 Keep alpha', rewritten: '👍 alpha' }));
  assert.equal(report.verdict, 'preserved');
  assert.equal(report.checkedConstraints, 1);
  assert.deepEqual(report.counts, { preserved: 1, changed: 0, contradicted: 0, missing: 0, uncertain: 0 });
  assert.equal(report.findings[0].original.start, 8);
  for (const e of report.findings[0].rewritten) assert.equal('👍 alpha'.slice(e.start, e.end), e.text);
});
test('missing constraints require review, including empty rewrite', () => {
  assert.equal(auditRewrite(input({ rewritten: '' })).verdict, 'review');
});
test('strict input contracts reject typos, empty checks and ungrounded source quotes', () => {
  for (const bad of [null, {}, input({ original: '' }), input({ constraints: [] }), input({ constraints: [literal(), literal()] }), input({ constraints: [literal('absent')] }), input({ constraints: [{ ...literal(), casesensitive: true }] }), input({ constraints: [{ ...literal(), caseSensitive: 'false' }] })]) {
    assert.throws(() => auditRewrite(bad), AuditInputError);
  }
});
test('ambiguous repeated quotes need zero-based occurrence', () => {
  assert.throws(() => auditRewrite(input({ original: 'alpha alpha' })), /occurrence/);
  const report = auditRewrite(input({ original: 'alpha alpha', constraints: [{ ...literal(), source: { quote: 'alpha', occurrence: 1 } }] }));
  assert.equal(report.findings[0].original.start, 6);
  assert.throws(() => auditRewrite(input({ constraints: [{ ...literal(), source: { quote: 'alpha', occurrence: 1 } }] })), /occurrence/);
});
test('invalid limits, aliases, policies, and resource sizes fail closed', () => {
  const base = { id: 'limit', source: { quote: 'alpha' }, kind: 'limit', unit: 'words', operator: 'lt', value: 3 };
  for (const value of [-1, Infinity, NaN, '3']) assert.throws(() => auditRewrite(input({ constraints: [{ ...base, value }] })), AuditInputError);
  assert.throws(() => auditRewrite(input({ constraints: [{ ...base, operator: 'less' }] })), AuditInputError);
  assert.throws(() => auditRewrite(input({ original: 'a'.repeat(1_000_001) })), AuditInputError);
  assert.throws(() => auditRewrite(input({ constraints: Array.from({ length: 257 }, (_, i) => ({ ...literal(), id: String(i) })) })), AuditInputError);
  assert.throws(() => auditRewrite(input({ constraints: [{ id: 'x', kind: 'action', source: { quote: 'alpha' }, action: 'publish', policy: 'allow' }] })), AuditInputError);
});
test('validation detaches input objects', () => {
  const raw = input(); const checked = validateAuditInput(raw);
  raw.constraints[0].source.quote = 'mutated';
  assert.equal(checked.constraints[0].source.quote, 'alpha');
});
test('semantic checker is never called for deterministic preserved/missing checks', async () => {
  let calls = 0;
  const options = { checker: { check: async () => { calls++; throw new Error(); } } };
  assert.equal((await auditRewriteWith(input(), options)).verdict, 'preserved');
  assert.equal((await auditRewriteWith(input({ rewritten: '' }), options)).verdict, 'review');
  assert.equal(calls, 0);
});
test('semantic interpretation is explicitly attributed and grounded in the rewrite', async () => {
  const raw = ambiguous(); const quote = 'publish'; const start = raw.rewritten.indexOf(quote);
  const report = await auditRewriteWith(raw, { checker: { check: async ({ finding }) => {
    finding.original.text = 'attempt to mutate';
    return { status: 'changed', reason: 'Approval adds an exception to the prohibition.', evidence: [{ start, end: start + quote.length, text: quote }] };
  } } });
  assert.equal(report.verdict, 'changed');
  assert.equal(report.findings[0].method, 'semantic-checker');
  assert.equal(report.findings[0].original.text, 'Do not publish.');
});
test('fabricated evidence and evidence-free confident answers retain uncertainty', async () => {
  for (const evidence of [[], [{ start: 0, end: 7, text: 'invented' }], [{ start: -1, end: 2, text: 'If' }]]) {
    const report = await auditRewriteWith(ambiguous(), { checker: { check: async () => ({ status: 'preserved', reason: 'ok', evidence }) } });
    assert.equal(report.verdict, 'review'); assert.equal(report.findings[0].status, 'uncertain');
  }
});
test('provider errors do not leak secrets into findings', async () => {
  const report = await auditRewriteWith(ambiguous(), { checker: { check: async () => { throw new Error('secret-provider-key'); } } });
  assert.equal(report.verdict, 'review'); assert.ok(!JSON.stringify(report).includes('secret-provider-key'));
});
test('an uncooperative async checker is timeout-bounded and receives abort', async () => {
  let signal;
  const report = await auditRewriteWith(ambiguous(), { timeoutMs: 15, checker: { check: async (args) => { signal = args.signal; return new Promise(() => {}); } } });
  assert.equal(report.verdict, 'review'); assert.equal(signal.aborted, true);
});
test('pre-cancelled reviews never invoke the checker', async () => {
  const controller = new AbortController(); controller.abort(); let called = false;
  const report = await auditRewriteWith(ambiguous(), { signal: controller.signal, checker: { check: async () => { called = true; throw new Error(); } } });
  assert.equal(called, false); assert.equal(report.verdict, 'review');
});
test('in-flight cancellation interrupts an uncooperative async checker', async () => {
  const controller = new AbortController();
  const result = auditRewriteWith(ambiguous(), { signal: controller.signal, checker: { check: async () => new Promise(() => {}) } });
  queueMicrotask(() => controller.abort());
  assert.equal((await result).verdict, 'review');
});
test('invalid semantic options are rejected', async () => {
  await assert.rejects(auditRewriteWith(input(), { timeoutMs: 0, checker: { check: async () => ({}) } }), AuditInputError);
});
