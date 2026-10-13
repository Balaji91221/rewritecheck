import { readFile } from 'node:fs/promises';
import { auditRewrite } from '../dist/index.js';

const cases = JSON.parse(await readFile(new URL('./cases.json', import.meta.url), 'utf8'));
const json = process.argv.slice(2).includes('--json');
if (process.argv.slice(2).some((arg) => arg !== '--json')) {
  console.error('Usage: node benchmark/run.mjs [--json]');
  process.exitCode = 2;
} else {
  const results = cases.map((item) => {
    try {
      const report = auditRewrite(item.input);
      return {
        id: item.id,
        category: item.category,
        expected: item.expected,
        actual: report.verdict,
        passed: report.verdict === item.expected,
        findings: report.findings.map(({ status, reason }) => ({ status, reason })),
      };
    } catch (error) {
      return {
        id: item.id,
        category: item.category,
        expected: item.expected,
        actual: 'error',
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  const passed = results.filter((result) => result.passed).length;
  const summary = {
    benchmark: 'Curated explicit-constraint examples',
    cases: cases.length,
    passed,
    failed: cases.length - passed,
    scope: 'Hand-authored regression cases, not a representative semantic-accuracy benchmark.',
    results,
  };
  if (json) console.log(JSON.stringify(summary, null, 2));
  else {
    for (const result of results) {
      console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.id}: expected=${result.expected} actual=${result.actual}`);
      if (!result.passed) console.log(`  ${result.error ?? result.findings.map((finding) => `${finding.status}: ${finding.reason}`).join('; ')}`);
    }
    console.log(`\n${passed}/${cases.length} curated cases matched their expected verdicts.`);
    console.log(summary.scope);
  }
  process.exitCode = passed === cases.length ? 0 : 1;
}
