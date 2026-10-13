import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkPromptForgeResult, refineWithChecks, reviewPromptForgeAcceptance } from './promptforge-adapter.mjs';

const original = 'Explain caching. Use at most 150 words. Do not send email. Keep API_KEY unchanged.';
const constraints = [
  { id:'word-limit', kind:'limit', source:{quote:'at most 150 words'}, unit:'words', operator:'lte', value:150 },
  { id:'no-email', kind:'action', source:{quote:'Do not send email'}, action:'send', target:'email', policy:'forbid' },
  { id:'identifier', kind:'literal', source:{quote:'API_KEY'} },
];
const result = {
  intent:'explain', refined_prompt:original,
  applied_techniques:[], suggestions:[], quality_before:30, quality_after:99,
};

test('a user edit is checked instead of reusing the model result', () => {
  const first = checkPromptForgeResult({ original, result, constraints });
  assert.equal(first.rewritecheck.verdict, 'preserved');
  const edited = reviewPromptForgeAcceptance({ original, result:first, constraints,
    rewritten:'Explain caching. Use at most 300 words. Send email. Keep API_KEY unchanged.' });
  assert.equal(edited.canAccept, false);
  assert.equal(edited.result.rewritecheck.verdict, 'changed');
  assert.equal(first.refined_prompt, original);
  assert.equal(first.rewritecheck.verdict, 'preserved');
});

test('restoring explicit constraints restores only the scoped acceptance decision', () => {
  const edited = reviewPromptForgeAcceptance({ original, result, constraints, rewritten:original });
  assert.equal(edited.canAccept, true);
  assert.equal(edited.result.rewritecheck.checkedConstraints, 3);
});

test('forged or stale model evidence is replaced by local checks', () => {
  const forged = { ...result, refined_prompt:'Explain caching.', rewritecheck:{verdict:'preserved', findings:[]} };
  const reviewed = checkPromptForgeResult({ original, result:forged, constraints });
  assert.notEqual(reviewed.rewritecheck.verdict, 'preserved');
  assert.equal(reviewed.rewritecheck.checkedConstraints, 3);
  assert.equal(forged.rewritecheck.verdict, 'preserved');
});

test('an empty contract cannot fill this demo composer', () => {
  assert.throws(() => reviewPromptForgeAcceptance({ original, result, constraints:[] }), /constraints/);
});

test('changing the explicit contract affects the next check', () => {
  const changed = 'Explain caching. Use at most 300 words. Send email. Keep API_KEY unchanged.';
  const reviewed = reviewPromptForgeAcceptance({ original, result, constraints:[constraints[2]], rewritten:changed });
  assert.equal(reviewed.canAccept, true);
  assert.equal(reviewed.result.rewritecheck.checkedConstraints, 1);
  // This demonstrates scoped checking, not correctness of unchecked instructions.
});

test('malformed PromptForge results are rejected', () => {
  assert.throws(() => checkPromptForgeResult({ original, result:{}, constraints }), /refined_prompt/);
});

test('actual PromptForge refine() → SDK report → edited acceptance', { skip:!process.env.PROMPTFORGE_CORE }, async () => {
  const { refine } = await import(pathToFileURL(resolve(process.env.PROMPTFORGE_CORE, 'prompt-helper/index.js')).href);
  let calls = 0;
  const output = await refineWithChecks({ original, constraints, refine, call:async () => {
    calls += 1;
    return JSON.stringify({ ...result, refined_prompt:'Explain caching. Use at most 300 words. Send email. Keep API_KEY unchanged.' });
  } });
  assert.equal(calls, 1);
  assert.equal(output.status, 'ok');
  assert.equal(output.result.rewritecheck.verdict, 'changed');
  assert.equal(typeof output.result.tokens_before, 'number');
  assert.equal(reviewPromptForgeAcceptance({ original, result:output.result, constraints, rewritten:original }).canAccept, true);
});

test('PromptForge short input stays short without a fabricated report', { skip:!process.env.PROMPTFORGE_CORE }, async () => {
  const { refine } = await import(pathToFileURL(resolve(process.env.PROMPTFORGE_CORE, 'prompt-helper/index.js')).href);
  const output = await refineWithChecks({ original:'hi', constraints:[], refine, call:async () => { throw new Error('must not call'); } });
  assert.equal(output.status, 'too_short');
  assert.equal(output.result, undefined);
});
