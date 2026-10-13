import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { refineWithChecks, reviewPromptForgeAcceptance } from './promptforge-adapter.mjs';

// Pass a built PromptForge core directory. For a normal PromptForge checkout:
// node examples/promptforge.mjs /path/to/promptforge/packages/core/dist
const coreDirectory = process.argv[2];
if (!coreDirectory) {
  console.error('Usage: node examples/promptforge.mjs /absolute/path/to/promptforge/core/dist');
  process.exitCode = 2;
} else {
  const { refine } = await import(pathToFileURL(resolve(coreDirectory, 'prompt-helper/index.js')).href);
  const original = 'Explain caching. Use at most 150 words. Do not send email. Keep API_KEY unchanged.';
  const constraints = [
    { id: 'word-limit', kind: 'limit', source: { quote: 'at most 150 words' }, unit: 'words', operator: 'lte', value: 150 },
    { id: 'no-email', kind: 'action', source: { quote: 'Do not send email' }, action: 'send', target: 'email', policy: 'forbid' },
    { id: 'identifier', kind: 'literal', source: { quote: 'API_KEY' } },
  ];
  // Inject a deliberately faulty, authored fixture response. No model is called.
  const call = async () => JSON.stringify({
    intent: 'explain',
    refined_prompt: 'Explain caching. Use at most 300 words. Send email. Keep API_KEY unchanged.',
    applied_techniques: ['clarity'], suggestions: [], quality_before: 30, quality_after: 90,
  });
  const generated = await refineWithChecks({ original, constraints, refine, call });
  if (generated.status !== 'ok' || !generated.result) throw new Error('PromptForge did not return a rewrite.');
  const edited = reviewPromptForgeAcceptance({
    original, constraints, result: generated.result, rewritten: original,
  });
  console.log(JSON.stringify({
    mode: 'Actual PromptForge refine() with an injected fixture provider; no live LLM call',
    generated: generated.result.rewritecheck,
    afterUserEdit: edited.result.rewritecheck,
    canAcceptEdited: edited.canAccept,
    scope: 'Only the three caller-supplied constraints were checked.',
  }, null, 2));
}
