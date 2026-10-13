/** Offsets use JavaScript UTF-16 code units; end is exclusive. */
export interface EvidenceSpan { start: number; end: number; text: string }
export interface SourceRef { quote: string; occurrence?: number }
interface BaseConstraint { id: string; source: SourceRef }
/** Checks literal presence only, not how the literal is used. */
export interface LiteralConstraint extends BaseConstraint {
  kind: "literal";
  caseSensitive?: boolean;
}
/** English numeric bounds, e.g. "at most 150 words". */
export interface LimitConstraint extends BaseConstraint {
  kind: "limit";
  unit: string;
  operator: "lt" | "lte" | "eq" | "gte" | "gt";
  value: number;
}
/** Conservative English imperative checks. Complex scope requires review. */
export interface ActionConstraint extends BaseConstraint {
  kind: "action";
  action: string;
  aliases?: readonly string[];
  policy: "require" | "forbid";
  target?: string;
}
export type Constraint = LiteralConstraint | LimitConstraint | ActionConstraint;
export type FindingStatus = "preserved" | "changed" | "contradicted" | "missing" | "uncertain";
export interface Finding {
  id: string;
  kind: Constraint["kind"];
  status: FindingStatus;
  method: "literal" | "numeric-bound" | "imperative-rule" | "semantic-checker";
  reason: string;
  original: EvidenceSpan;
  rewritten: EvidenceSpan[];
}
export interface AuditInput {
  original: string;
  rewritten: string;
  constraints: readonly Constraint[];
}
export interface AuditReport {
  schemaVersion: "1.0";
  /** Only supplied constraints are checked. This is never a safety certificate. */
  verdict: "preserved" | "changed" | "review";
  findings: Finding[];
  counts: Record<FindingStatus, number>;
  checkedConstraints: number;
}
/** Optional review hook; no model or network access is bundled in the core. */
export interface SemanticChecker {
  check(input: { original: string; rewritten: string; constraint: Constraint; finding: Finding; signal: AbortSignal }): Promise<{
    status: FindingStatus;
    reason: string;
    evidence: EvidenceSpan[];
  }>;
}
export interface SemanticOptions { checker: SemanticChecker; timeoutMs?: number; signal?: AbortSignal }
