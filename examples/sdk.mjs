import { readFile } from 'node:fs/promises';
import { auditRewrite } from '../dist/index.js';

const input = JSON.parse(await readFile(new URL('./local-demo.json', import.meta.url), 'utf8'));
const report = auditRewrite(input);
console.log(JSON.stringify(report, null, 2));
console.log('\nThis demo checks only the three declared constraints. It does not certify overall meaning.');
