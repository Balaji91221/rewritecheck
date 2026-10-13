import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
let directory;
before(() => { directory = mkdtempSync(join(tmpdir(), 'rewritecheck-cli-')); });
after(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

function invoke(args, input) {
  return spawnSync(process.execPath, [cli, ...args], {
    input,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 2 * 1024 * 1024,
  });
}

const preserved = {
  original: 'Use pnpm.',
  rewritten: 'Use pnpm for this task.',
  constraints: [{ id: 'package-manager', kind: 'literal', source: { quote: 'pnpm' } }],
};

const changed = {
  original: 'Use at most 150 words.',
  rewritten: 'Use at most 250 words.',
  constraints: [{ id: 'length', kind: 'limit', source: { quote: 'Use at most 150 words.' }, operator: 'lte', value: 150, unit: 'words' }],
};

const review = {
  original: 'Run tests.',
  rewritten: 'Run tests if needed.',
  constraints: [{ id: 'tests', kind: 'action', source: { quote: 'Run tests.' }, action: 'run', target: 'tests', policy: 'require' }],
};

test('help and version work without an input document', () => {
  const help = invoke(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /rewritecheck <json-file \| ->/);
  assert.match(help.stdout, /1 MiB/);
  const version = invoke(['--version']);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), metadata.version);
});

test('a JSON file reports preserved constraints with exit code 0', () => {
  const filename = join(directory, 'preserved.json');
  writeFileSync(filename, JSON.stringify(preserved));
  const result = invoke([filename, '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.verdict, 'preserved');
  assert.equal(report.checkedConstraints, 1);
});

test('stdin JSON reports changed evidence with exit code 1', () => {
  const result = invoke(['-', '--json'], JSON.stringify(changed));
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.verdict, 'changed');
  assert.equal(report.findings[0].id, 'length');
});

test('unsupported conditional scope reports review with exit code 2', () => {
  const result = invoke(['--json', '-'], JSON.stringify(review));
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout).verdict, 'review');
});

test('human-readable output states its limited scope', () => {
  const result = invoke(['-'], JSON.stringify(preserved));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RewriteCheck: PRESERVED/);
  assert.match(result.stdout, /package-manager/);
  assert.match(result.stdout, /not a semantic-equivalence guarantee/);
});

test('malformed JSON has a structured stderr error and exit code 3', () => {
  const result = invoke(['-', '--json'], '{broken');
  assert.equal(result.status, 3);
  assert.equal(result.stdout, '');
  assert.match(JSON.parse(result.stderr).error, /valid JSON/);
});

test('invalid audit input propagates validation failure as exit code 3', () => {
  const result = invoke(['-', '--json'], JSON.stringify({ original: 'hello' }));
  assert.equal(result.status, 3);
  assert.equal(result.stdout, '');
  assert.equal(typeof JSON.parse(result.stderr).error, 'string');
});

test('missing files and invalid argument combinations are input errors', () => {
  for (const args of [[], ['--unknown'], ['--json', '--json', '-'], ['a.json', 'b.json'], [join(directory, 'missing.json')]]) {
    const result = invoke(args, '');
    assert.equal(result.status, 3, `Arguments: ${JSON.stringify(args)}\n${result.stderr}`);
    assert.equal(result.stdout, '');
  }
});

test('stdin larger than 1 MiB is rejected before JSON parsing', () => {
  const result = invoke(['-', '--json'], Buffer.alloc(1024 * 1024 + 1, 32));
  assert.equal(result.status, 3);
  assert.match(JSON.parse(result.stderr).error, /1 MiB/);
});

test('files larger than 1 MiB are rejected before JSON parsing', () => {
  const filename = join(directory, 'oversized.json');
  writeFileSync(filename, Buffer.alloc(1024 * 1024 + 1, 32));
  const result = invoke([filename, '--json']);
  assert.equal(result.status, 3);
  assert.match(JSON.parse(result.stderr).error, /1 MiB/);
});

test('invalid UTF-8 is rejected instead of changing evidence bytes', () => {
  const result = invoke(['-', '--json'], Buffer.from([0xc3, 0x28]));
  assert.equal(result.status, 3);
  assert.match(JSON.parse(result.stderr).error, /UTF-8/);
});
