import type { AuditInput, AuditReport, EvidenceSpan, Finding, FindingStatus, SemanticOptions } from './types.js';
import { checkConstraint } from './rules.js';
import { AuditInputError, resolveSource, validateAuditInput } from './validation.js';

function aggregate(findings: Finding[]): AuditReport {
  const counts = { preserved: 0, changed: 0, contradicted: 0, missing: 0, uncertain: 0 };
  for (const finding of findings) counts[finding.status]++;
  return {
    schemaVersion: '1.0',
    verdict: counts.changed + counts.contradicted > 0 ? 'changed' : counts.missing + counts.uncertain > 0 ? 'review' : 'preserved',
    checkedConstraints: findings.length,
    counts,
    findings,
  };
}
function run(input: AuditInput): AuditReport {
  return aggregate(input.constraints.map(c => checkConstraint(c, resolveSource(input.original, c.source), input.rewritten)));
}
/** Checks only supplied constraints; preserved is not a semantic-equivalence or safety guarantee. */
export function auditRewrite(input: AuditInput): AuditReport {
  return run(validateAuditInput(input));
}

const statuses: readonly FindingStatus[] = ['preserved', 'changed', 'contradicted', 'missing', 'uncertain'];
function validEvidence(value: unknown, text: string): value is EvidenceSpan {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as EvidenceSpan;
  return Number.isSafeInteger(e.start) && Number.isSafeInteger(e.end) && e.start >= 0 && e.end > e.start && e.end <= text.length && typeof e.text === 'string' && text.slice(e.start, e.end) === e.text;
}
/** Optional interpretation of uncertain findings. timeoutMs bounds the entire semantic phase. */
export async function auditRewriteWith(input: AuditInput, options: SemanticOptions): Promise<AuditReport> {
  const checked = validateAuditInput(input);
  if (!options || !options.checker || typeof options.checker.check !== 'function') throw new AuditInputError('options.checker.check must be a function.');
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new AuditInputError('timeoutMs must be between 1 and 60000.');
  const report = run(checked);
  const deadline = Date.now() + timeoutMs;
  for (let index = 0; index < report.findings.length; index++) {
    const finding = report.findings[index]!;
    if (finding.status !== 'uncertain') continue;
    if (options.signal?.aborted || Date.now() >= deadline) {
      finding.reason += options.signal?.aborted ? ' Semantic review was cancelled.' : ' Semantic review timed out.';
      continue;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      const interrupted = new Promise<never>((_, reject) => {
        abort = () => { controller.abort(); reject(new Error('cancelled')); };
        options.signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => { controller.abort(); reject(new Error('timed out')); }, Math.max(1, deadline - Date.now()));
      });
      // Pass detached data. A checker cannot mutate the deterministic report or another contract.
      const answer = await Promise.race([
        Promise.resolve().then(() => options.checker.check({
          original: checked.original,
          rewritten: checked.rewritten,
          constraint: structuredClone(checked.constraints[index]!),
          finding: structuredClone(finding),
          signal: controller.signal,
        })),
        interrupted,
      ]);
      if (!answer || !statuses.includes(answer.status) || typeof answer.reason !== 'string' || !answer.reason.trim() || answer.reason.length > 4096 || !Array.isArray(answer.evidence) || answer.evidence.length > 256 || !Array.from(answer.evidence).every(e => validEvidence(e, checked.rewritten)) || (['preserved', 'changed', 'contradicted'].includes(answer.status) && answer.evidence.length === 0)) {
        finding.reason += ' Semantic review returned invalid evidence or an invalid result; the deterministic finding is retained.';
        continue;
      }
      report.findings[index] = { ...finding, status: answer.status, method: 'semantic-checker', reason: answer.reason, rewritten: answer.evidence.map(e => ({ start: e.start, end: e.end, text: e.text })) };
    } catch {
      finding.reason += controller.signal.aborted ? ' Semantic review timed out or was cancelled; the deterministic finding is retained.' : ' Semantic review failed; the deterministic finding is retained.';
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort) options.signal?.removeEventListener('abort', abort);
      controller.abort();
    }
  }
  return aggregate(report.findings);
}
