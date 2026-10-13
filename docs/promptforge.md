# PromptForge integration example

The example adapts PromptForge's actual `PromptHelperResult` contract and calls
its real `refine()` engine. RewriteCheck checks **explicit caller-supplied
constraints** against `result.refined_prompt`. It does not extract requirements,
trust the model's quality estimate, or add a new model call.

This is a working local adapter and review demo. It is **not installed in the
production PromptForge extension or MCP server**.

## Run the adapter

Build this source checkout with `npm install` and `npm run build`. In a separate
[PromptForge checkout](https://github.com/Balaji91221/promptforge), run its
documented `npm install` and `npm run build:engine` commands. The combined example
requires Node.js 22 or newer because that is PromptForge's declared minimum.

From the RewriteCheck repository:

```bash
node examples/promptforge.mjs /absolute/path/to/promptforge/packages/core/dist
```

The example injects a deliberately faulty **fixture provider** into PromptForge;
it needs no provider account or credentials. The actual engine parses the result,
applies its normal guards, and calculates token estimates. RewriteCheck then
reports the changed word bound and email prohibition. Restoring the original
text gives a fresh report for the three supplied constraints.

To use your own provider, pass its existing `LlmCall` function to
`refineWithChecks()`. The adapter imports only RewriteCheck; PromptForge's
`refine` function is supplied by its caller.

## Inspect and edit in a browser

```bash
node examples/promptforge-server.mjs /absolute/path/to/promptforge/packages/core/dist 4174
```

Open `http://127.0.0.1:4174`. This optional static preview host serves the built
JavaScript modules locally. It does not expose a provider endpoint or call an LLM.

1. Run the authored fixture through PromptForge.
2. Review the original and rewritten evidence for each explicit constraint.
3. Edit the rewritten prompt or the contract JSON. Every edit revalidates it.
4. Restore the original text and use the checked text in the local composer preview.

Acceptance performs another fresh check. A changed or review verdict prevents
this demo from filling its preview. This is the demo's acceptance policy, not a
semantic correctness or safety guarantee. An empty contract does not establish
that a rewrite is correct.

Run the integration checks against the same real engine:

```bash
PROMPTFORGE_CORE=/absolute/path/to/promptforge/packages/core/dist \
  node --test examples/promptforge.integration.test.mjs
```

Without `PROMPTFORGE_CORE`, the two real-engine tests are explicitly skipped;
adapter checks still run. The browser demo is a separate interaction to inspect,
not a claim that the production extension has been browser-tested.

## Adapter boundary

```js
import { refine } from '@promptforge/core';
import { refineWithChecks, reviewPromptForgeAcceptance }
  from './examples/promptforge-adapter.mjs';

const output = await refineWithChecks({ original, constraints, refine, call });
if (output.status === 'ok') {
  const review = reviewPromptForgeAcceptance({
    original,
    constraints,
    result: output.result,
    rewritten: currentEditableText,
  });
  // Render review.result.rewritecheck; apply your own explicit acceptance policy.
}
```

`constraints`, `original`, `call`, and `currentEditableText` above belong to your
application. The SDK has no automatic constraint extraction. Reports are generated
locally and replace stale or model-supplied `rewritecheck` properties.

## Applying this to PromptForge later

- `packages/core/src/prompt-helper/index.ts`: attach a report after the final
  instruction rewrite. For paste mode, audit the instruction separately from the
  locally compressed payload; byte differences in equivalent JSON/CSV are not
  evidence of changed instructions.
- `apps/extension-browser/src/content/Overlay.tsx`: let users specify contracts,
  display findings, and recompute against the current editable text. Its hosted
  streaming route bypasses `refine()`, so a core-only check is insufficient.
- `apps/extension-browser/src/content/index.tsx`: revalidate immediately before
  `writeToComposer()` in the acceptance callback.
- `packages/types/src/index.ts`: add an optional report field without treating
  model-generated JSON as trusted verification evidence.

The demo intentionally starts with short instruction-only prompts. It does not
claim to verify compressed attachments, arbitrary semantics, or constraints that
the user did not supply. No production PromptForge files are modified by these examples.
