# Curated constraint benchmark

This suite contains 30 hand-authored, labeled examples. It exercises literal matching, recognized English phrases with numeric bounds, action polarity, configured aliases, and cases that should require human review.

Run from the repository root:

```bash
npm run build
node benchmark/run.mjs
node benchmark/run.mjs --json
```

The runner compares the public `auditRewrite` verdict with each case's expected verdict. It exits `0` when all cases match and `1` when any differ. Each JSON case includes the input and a short labeling rationale so mismatches can be examined without guessing the intended behavior.

## What the labels mean

- **preserved:** the declared check is supported and its evidence is retained.
- **changed:** recognized evidence changes an operator/value or reverses action polarity.
- **review:** missing, ambiguous, or unsupported evidence prevents a supported conclusion.

A literal can still be present inside a negated instruction. The `literal-scope-limitation` case intentionally demonstrates that presence alone does not preserve intent. Use an action constraint when polarity matters.

Spelled-out numbers, conditionals, quotation, compounds, and expanded action targets are represented as review cases rather than fabricated successes. This suite is not a measured estimate of real-world semantic accuracy, adversarial robustness, or model performance. It is a small regression fixture for the documented rules.
