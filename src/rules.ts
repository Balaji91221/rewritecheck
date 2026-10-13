import type { ActionConstraint, Constraint, EvidenceSpan, Finding, LimitConstraint } from "./types.js";

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalized = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();
const MAX_EVIDENCE = 64;

function evidence(text: string, start: number, end: number): EvidenceSpan {
  return { start, end, text: text.slice(start, end) };
}

/** Sentence boundaries preserve decimal points and exact UTF-16 offsets. */
function* segments(text: string): Generator<EvidenceSpan> {
  let start = 0;
  for (let index = 0; index <= text.length; index++) {
    const char = text[index] ?? "";
    const decimal = char === "." && /\d/.test(text[index - 1] ?? "") && /\d/.test(text[index + 1] ?? "");
    if (index < text.length && (!/[.!?;\n]/.test(char) || decimal)) continue;
    const end = index === text.length ? index : index + 1;
    let left = start;
    let right = end;
    while (left < right && /\s/.test(text[left]!)) left++;
    while (right > left && /\s/.test(text[right - 1]!)) right--;
    if (left < right) yield evidence(text, left, right);
    start = end;
  }
}

function body(span: EvidenceSpan): string {
  return span.text.replace(/^[-*•]\s+/, "").replace(/[.!?;]+$/, "").trim();
}

function complexScope(text: string): boolean {
  return /["“”`():,?]/.test(text)
    || /(?:^|\s)['‘][^\n]+['’](?:\s|[.!?;]|$)/.test(text)
    || /\b(?:and|or|but|if|unless|when|whenever|while|until|after|before|except|only|instead|otherwise|provided|although|because)\b/i.test(text);
}

// Quoted/conditional blocks can outlive a sentence or line break. Deliberately
// prefer review over assuming that an isolated line escapes the earlier scope.
function documentScope(text: string): boolean {
  return /["“”`]/.test(text)
    || /(?:^|\s)['‘][\s\S]+['’](?:\s|[.!?;]|$)/.test(text)
    || /\b(?:if|unless|when|whenever|until|except|only|otherwise|provided)\b/i.test(text)
    || /(?:^|\n)\s*(?:example|quote|sample|hypothetical)(?:\s+[^\n:]*)?:/i.test(text);
}

function finding(constraint: Constraint, original: EvidenceSpan, status: Finding["status"], reason: string, rewritten: EvidenceSpan[] = []): Finding {
  return {
    id: constraint.id,
    kind: constraint.kind,
    status,
    method: constraint.kind === "literal" ? "literal" : constraint.kind === "limit" ? "numeric-bound" : "imperative-rule",
    reason,
    original,
    rewritten,
  };
}

const operators: readonly [string, LimitConstraint["operator"]][] = [
  ["at most", "lte"], ["no more than", "lte"], ["not more than", "lte"], ["up to", "lte"],
  ["less than", "lt"], ["fewer than", "lt"], ["under", "lt"],
  ["exactly", "eq"],
  ["at least", "gte"], ["no fewer than", "gte"], ["no less than", "gte"],
  ["more than", "gt"], ["over", "gt"],
];

interface Bound {
  operator: LimitConstraint["operator"];
  value: number;
  span: EvidenceSpan;
  supported: boolean;
}
interface Candidates<T> { items: T[]; overflow: boolean }

/**
 * Only explicit Arabic-number bounds and a small imperative wrapper are parsed.
 * A source mismatch/unsupported source returns uncertain, never a silent pass.
 * Units are literal and case-insensitive; no unit conversion/plural inference.
 */
function bounds(text: string, constraint: LimitConstraint): Candidates<Bound> {
  const opPattern = [...operators].sort((a, b) => b[0].length - a[0].length).map(([word]) => escape(word).replace(/ /g, "\\s+")).join("|");
  const unitPattern = escape(constraint.unit).replace(/\s+/g, "\\s+");
  const pattern = new RegExp(`\\b(${opPattern})\\s+(\\d+(?:\\.\\d+)?)\\s+${unitPattern}(?![A-Za-z0-9_])`, "gi");
  const result: Bound[] = [];
  const scoped = documentScope(text);
  // Keep wrappers intentionally finite. Unrecognized prose around a match is reviewable.
  const prefix = /^(?:please\s+)?(?:(?:use|write|return|produce|give|keep|limit)(?:\s+(?:(?:the|your|my)\s+)?(?:answer|response|output|summary|description|text|it))?(?:\s+(?:to|within))?\s+)?$/i;
  for (const segment of segments(text)) {
    let matchCount = 0;
    const firstIndex = result.length;
    for (const match of segment.text.matchAll(pattern)) {
      if (result.length === MAX_EVIDENCE) return { items: result, overflow: true };
      matchCount++;
      if (matchCount > 1) result[firstIndex]!.supported = false;
      const local = match.index!;
      const before = segment.text.slice(0, local).replace(/^[-*•]\s+/, "");
      const after = segment.text.slice(local + match[0].length).replace(/[.!?;]+$/, "").trim();
      result.push({
        operator: operators.find(([phrase]) => phrase === normalized(match[1]!))![1],
        value: Number(match[2]),
        span: evidence(text, segment.start + local, segment.start + local + match[0].length),
        supported: matchCount === 1 && !scoped && !complexScope(segment.text) && prefix.test(before) && after === "",
      });
    }
  }
  return { items: result, overflow: false };
}

function checkLimit(constraint: LimitConstraint, original: EvidenceSpan, rewritten: string): Finding {
  const source = bounds(original.text, constraint);
  if (source.overflow || !source.items.length || source.items.some((bound) => !bound.supported || bound.operator !== constraint.operator || bound.value !== constraint.value)) {
    return finding(constraint, original, "uncertain", "The source quote does not unambiguously support the declared numeric bound in the supported grammar.");
  }
  const candidates = bounds(rewritten, constraint);
  const found = candidates.items;
  if (candidates.overflow) {
    return finding(constraint, original, "uncertain", "More than 64 numeric candidates were found; the remaining candidates may change the interpretation.", found.map((bound) => bound.span));
  }
  if (!found.length) {
    const unit = new RegExp(`(?:^|[^A-Za-z0-9_])${escape(constraint.unit)}(?![A-Za-z0-9_])`, "i");
    const related: EvidenceSpan[] = [];
    for (const span of segments(rewritten)) {
      if (unit.test(span.text)) related.push(span);
      if (related.length === MAX_EVIDENCE) break;
    }
    return related.length
      ? finding(constraint, original, "uncertain", "The unit is mentioned, but no supported explicit numeric bound was found.", related)
      : finding(constraint, original, "missing", "No explicit bound for the configured unit was found.");
  }
  if (found.some((bound) => !bound.supported)) {
    return finding(constraint, original, "uncertain", "A numeric bound appears in quoted, compound, conditional, negated, or unsupported scope.", found.map((bound) => bound.span));
  }
  const first = found[0]!;
  if (found.some((bound) => bound.value !== first.value || bound.operator !== first.operator)) {
    return finding(constraint, original, "uncertain", "Multiple different bounds for the same unit require review.", found.map((bound) => bound.span));
  }
  const same = first.operator === constraint.operator && first.value === constraint.value;
  return finding(constraint, original, same ? "preserved" : "changed", same
    ? "The explicit operator, value, and unit are unchanged."
    : "The explicit numeric operator or value changed; a stricter bound also changes the contract.", found.map((bound) => bound.span));
}

interface Imperative {
  span: EvidenceSpan;
  policy?: ActionConstraint["policy"];
  target?: string;
}

function imperatives(text: string, constraint: ActionConstraint): Candidates<Imperative> {
  const names = [...new Set([constraint.action, ...(constraint.aliases ?? [])])].filter(Boolean).sort((a, b) => b.length - a.length);
  const alternatives = names.map((name) => escape(name).replace(/\s+/g, "\\s+")).join("|");
  const relevant = new RegExp(`(?:^|[^A-Za-z0-9_])(?:${alternatives})(?=$|[^A-Za-z0-9_])`, "i");
  const verb = new RegExp(`^(?:${alternatives})(?=$|\\s)(?:\\s+(.*))?$`, "i");
  const result: Imperative[] = [];
  const scoped = documentScope(text);
  for (const span of segments(text)) {
    if (!relevant.test(span.text)) continue;
    if (result.length === MAX_EVIDENCE) return { items: result, overflow: true };
    let content = body(span);
    if (scoped || complexScope(span.text)) {
      result.push({ span });
      continue;
    }
    content = content.replace(/^please\s+/i, "");
    const negative = /^(?:do\s+not|don['’]t|never)\s+/i.test(content);
    content = content.replace(/^(?:do\s+not|don['’]t|never)\s+/i, "");
    const match = content.match(verb);
    // Negation or obligation inside an operand is outside this imperative grammar.
    if (!match || /\b(?:not|never|must|should|may|might|can|could|would|without)\b/i.test(match[1] ?? "")) {
      result.push({ span });
      continue;
    }
    result.push({ span, policy: negative ? "forbid" : "require", target: normalized(match[1] ?? "") });
  }
  return { items: result, overflow: false };
}

/**
 * Action aliases are caller-declared equivalences. A configured target must be
 * the whole operand, not a substring. Without a target, preserve the source's
 * exact normalized operand instead of silently widening/narrowing its scope.
 */
function checkAction(constraint: ActionConstraint, original: EvidenceSpan, rewritten: string): Finding {
  const source = imperatives(original.text, constraint);
  const target = constraint.target === undefined ? source.items[0]?.target : normalized(constraint.target);
  if (source.overflow || !source.items.length || target === undefined || source.items.some((item) => item.policy !== constraint.policy || item.target !== target)) {
    return finding(constraint, original, "uncertain", "The source quote does not unambiguously support the declared action, policy, and target in the supported imperative grammar.");
  }
  const candidates = imperatives(rewritten, constraint);
  const found = candidates.items;
  if (candidates.overflow) {
    return finding(constraint, original, "uncertain", "More than 64 action candidates were found; the remaining candidates may change the interpretation.", found.map((item) => item.span));
  }
  if (!found.length) return finding(constraint, original, "missing", "The configured action or an explicit alias was not found.");
  const spans = found.map((item) => item.span);
  if (found.some((item) => item.policy === undefined || item.target !== target)) {
    return finding(constraint, original, "uncertain", "The action occurs in unsupported scope or with a different operand; review its meaning.", spans);
  }
  if (found.some((item) => item.policy !== found[0]!.policy)) {
    return finding(constraint, original, "uncertain", "Both required and forbidden forms of the action appear.", spans);
  }
  const same = found[0]!.policy === constraint.policy;
  return finding(constraint, original, same ? "preserved" : "contradicted", same
    ? "The simple imperative preserves the declared action polarity and exact operand."
    : "The simple imperative reverses whether the action is required or forbidden.", spans);
}

/** Deterministic evidence checks only; a preserved result is not authorization. */
export function checkConstraint(constraint: Constraint, original: EvidenceSpan, rewritten: string): Finding {
  if (!constraint.source.quote || original.text !== constraint.source.quote || original.end - original.start !== original.text.length) {
    return finding(constraint, original, "uncertain", "The supplied original evidence does not match the source quote.");
  }
  if (constraint.kind === "limit") return checkLimit(constraint, original, rewritten);
  if (constraint.kind === "action") return checkAction(constraint, original, rewritten);
  const pattern = new RegExp(escape(constraint.source.quote), constraint.caseSensitive === false ? "giu" : "gu");
  const matches: EvidenceSpan[] = [];
  for (const match of rewritten.matchAll(pattern)) {
    matches.push(evidence(rewritten, match.index!, match.index! + match[0].length));
    if (matches.length === MAX_EVIDENCE) break;
  }
  return finding(constraint, original, matches.length ? "preserved" : "missing", matches.length
    ? "The literal source quote is present. This checks presence only, not how it is used."
    : "The literal source quote was not found.", matches);
}
