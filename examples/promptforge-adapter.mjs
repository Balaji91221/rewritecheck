import { auditRewrite } from '../dist/index.js';

/**
 * Adapt PromptForge's real PromptHelperResult shape. Constraints are supplied by
 * the caller; neither PromptForge's quality estimate nor its model output is
 * treated as a constraint extractor or a verification result.
 */
export function checkPromptForgeResult({ original, result, constraints, rewritten }) {
  if (!result || typeof result.refined_prompt !== 'string') {
    throw new TypeError('Expected a PromptForge result with refined_prompt.');
  }
  const current = rewritten === undefined ? result.refined_prompt : rewritten;
  if (typeof current !== 'string') throw new TypeError('rewritten must be a string.');
  return {
    ...result,
    refined_prompt: current,
    // Always replace any model-supplied or stale report with a fresh local one.
    rewritecheck: auditRewrite({ original, rewritten: current, constraints }),
  };
}

/** Call PromptForge's actual refine() function with a caller-owned provider. */
export async function refineWithChecks({ original, constraints, refine, call }) {
  const output = await refine(original, call);
  if (output.status !== 'ok' || !output.result) return output;
  return {
    ...output,
    result: checkPromptForgeResult({ original, result: output.result, constraints }),
  };
}

/** Recompute against the current edited text at the final acceptance boundary. */
export function reviewPromptForgeAcceptance(input) {
  const result = checkPromptForgeResult(input);
  return {
    // This demo requires all supplied checks to pass before filling its preview.
    // This is a UI policy, not a claim that the full prompt is semantically safe.
    canAccept: result.rewritecheck.checkedConstraints > 0 && result.rewritecheck.verdict === 'preserved',
    result,
  };
}
