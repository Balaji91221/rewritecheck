import test from 'node:test';
import assert from 'node:assert/strict';
import { auditRewrite, auditRewriteWith, AuditInputError, validateAuditInput } from '../dist/index.js';

const ambiguous = () => ({
  original: 'Do not publish.',
  rewritten: 'If approved, publish.',
  constraints: [{ id: 'publish', kind: 'action', source: { quote: 'Do not publish.' }, action: 'publish', policy: 'forbid' }],
});

test('sparse constraint lists are invalid rather than skipping runtime validation', () => {
  const input = { original: 'alpha', rewritten: 'alpha', constraints: new Array(1) };
  assert.throws(() => validateAuditInput(input), AuditInputError);
  assert.throws(() => auditRewrite(input), AuditInputError);
});

test('sparse semantic evidence cannot produce an evidence-free confident result', async () => {
  const result = await auditRewriteWith(ambiguous(), {
    checker: { check: async () => ({ status: 'preserved', reason: 'Accepted by provider.', evidence: new Array(1) }) },
  });
  assert.equal(result.verdict, 'review');
  assert.equal(result.findings[0].status, 'uncertain');
  assert.equal(result.findings[0].method, 'imperative-rule');
});

test('evidence spans are detached from provider-owned objects after review', async () => {
  const input = ambiguous();
  const evidence = [{ start: 13, end: 20, text: 'publish' }];
  const report = await auditRewriteWith(input, {
    checker: { check: async () => ({ status: 'changed', reason: 'Adds an exception.', evidence }) },
  });
  evidence[0].text = 'modified later';
  assert.equal(report.findings[0].rewritten[0].text, 'publish');
  assert.equal(report.verdict, 'changed');
});
