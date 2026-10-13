import type { AuditInput, Constraint, EvidenceSpan, SourceRef } from './types.js';

export const MAX_TEXT_LENGTH = 1_000_000;
export const MAX_CONSTRAINTS = 256;
export class AuditInputError extends Error {
  override name = 'AuditInputError';
}
function fail(message: string): never { throw new AuditInputError(message); }
function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${path} must be an object.`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key} is not a supported field.`);
}
function string(value: unknown, path: string, max = MAX_TEXT_LENGTH, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > max) fail(`${path} must be ${allowEmpty ? 'a' : 'a nonempty'} string of at most ${max} UTF-16 code units.`);
  return value;
}

/** Resolve an exact source quote. Occurrences are zero-based, including overlapping matches. */
export function resolveSource(original: string, source: SourceRef): EvidenceSpan {
  let found = original.indexOf(source.quote);
  if (found < 0) fail('source.quote must occur exactly in original.');
  if (source.occurrence === undefined) {
    if (original.indexOf(source.quote, found + 1) >= 0) fail('Repeated source.quote requires an explicit zero-based source.occurrence.');
  } else {
    for (let i = 0; i < source.occurrence; i++) {
      found = original.indexOf(source.quote, found + 1);
      if (found < 0) fail('source.occurrence does not exist in original.');
    }
  }
  return { start: found, end: found + source.quote.length, text: source.quote };
}

/** Runtime validation is also used by the SDK, not only by the CLI. Returns a detached snapshot. */
export function validateAuditInput(value: unknown): AuditInput {
  const input = record(value, 'input');
  keys(input, ['original', 'rewritten', 'constraints'], 'input');
  const original = string(input.original, 'original');
  const rewritten = string(input.rewritten, 'rewritten', MAX_TEXT_LENGTH, true);
  if (!Array.isArray(input.constraints) || input.constraints.length === 0 || input.constraints.length > MAX_CONSTRAINTS) fail(`constraints must contain 1 to ${MAX_CONSTRAINTS} entries.`);
  const ids = new Set<string>();
  const constraints = Array.from(input.constraints, (item: unknown, index: number): Constraint => {
    const path = `constraints[${index}]`;
    const c = record(item, path);
    const id = string(c.id, `${path}.id`, 128);
    if (ids.has(id)) fail(`${path}.id must be unique.`);
    ids.add(id);
    const rawSource = record(c.source, `${path}.source`);
    keys(rawSource, ['quote', 'occurrence'], `${path}.source`);
    const source: SourceRef = { quote: string(rawSource.quote, `${path}.source.quote`, 16_384) };
    if (rawSource.occurrence !== undefined) {
      if (typeof rawSource.occurrence !== 'number' || !Number.isSafeInteger(rawSource.occurrence) || rawSource.occurrence < 0 || rawSource.occurrence >= MAX_TEXT_LENGTH) fail(`${path}.source.occurrence must be a nonnegative integer below ${MAX_TEXT_LENGTH}.`);
      source.occurrence = rawSource.occurrence;
    }
    resolveSource(original, source);
    switch (c.kind) {
      case 'literal': {
        keys(c, ['id', 'source', 'kind', 'caseSensitive'], path);
        if (c.caseSensitive !== undefined && typeof c.caseSensitive !== 'boolean') fail(`${path}.caseSensitive must be boolean.`);
        return { id, source, kind: 'literal', ...(c.caseSensitive === undefined ? {} : { caseSensitive: c.caseSensitive }) };
      }
      case 'limit': {
        keys(c, ['id', 'source', 'kind', 'unit', 'operator', 'value'], path);
        const unit = string(c.unit, `${path}.unit`, 128);
        if (!['lt', 'lte', 'eq', 'gte', 'gt'].includes(c.operator as string)) fail(`${path}.operator must be lt, lte, eq, gte, or gt.`);
        if (typeof c.value !== 'number' || !Number.isFinite(c.value) || c.value < 0 || c.value > Number.MAX_SAFE_INTEGER) fail(`${path}.value must be a finite nonnegative number no larger than Number.MAX_SAFE_INTEGER.`);
        return { id, source, kind: 'limit', unit, operator: c.operator as 'lt' | 'lte' | 'eq' | 'gte' | 'gt', value: c.value };
      }
      case 'action': {
        keys(c, ['id', 'source', 'kind', 'action', 'aliases', 'policy', 'target'], path);
        const action = string(c.action, `${path}.action`, 128);
        if (c.policy !== 'require' && c.policy !== 'forbid') fail(`${path}.policy must be require or forbid.`);
        let aliases: string[] | undefined;
        if (c.aliases !== undefined) {
          if (!Array.isArray(c.aliases) || c.aliases.length > 32) fail(`${path}.aliases must be an array of at most 32 strings.`);
          aliases = Array.from(c.aliases, (a: unknown) => string(a, `${path}.aliases`, 128));
        }
        const target = c.target === undefined ? undefined : string(c.target, `${path}.target`, 256);
        return { id, source, kind: 'action', action, policy: c.policy, ...(aliases === undefined ? {} : { aliases }), ...(target === undefined ? {} : { target }) };
      }
      default: return fail(`${path}.kind must be literal, limit, or action.`);
    }
  });
  return { original, rewritten, constraints };
}
