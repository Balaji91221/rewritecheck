# Deterministic grammar

RewriteCheck checks caller-supplied constraints. It does not discover every instruction in a prompt, establish semantic equivalence, or authorize an action. These rules intentionally recognize a small English grammar; unsupported phrasing requires review.

All evidence offsets are JavaScript UTF-16 code-unit offsets with an exclusive end. Each evidence span slices back to its exact text. Case normalization never changes evidence offsets.

## Source grounding

The input validator resolves each exact `source.quote` in the original prompt. In the rule layer, the supplied original span must have that exact text and a matching length. Otherwise the finding is `uncertain`.

An action or numeric declaration must also agree with the supported language in its source quote. For example, declaring `operator: "lte"` for `Use at least 150 words.` produces `uncertain`, even if the rewrite says `Use at most 150 words.` A quoted, conditional, or otherwise unsupported source cannot produce a deterministic pass.

The rules see the selected source span, not all surrounding original prose. Select a quote that includes the instruction's scope; quoting only a fragment of a conditional instruction loses information that this layer cannot recover.

## Literal presence

`kind: "literal"` searches for `source.quote` exactly. Regex punctuation in the quote has no special meaning. Matching is case-sensitive by default; `caseSensitive: false` uses JavaScript's Unicode case-insensitive regex matching. It does not perform Unicode normalization or general linguistic equivalence.

- At least one occurrence: `preserved`.
- No occurrence: `missing`.
- The first 64 non-overlapping occurrences are returned as evidence.

This checks presence only. The literal `JSON` is present in `Do not return JSON.`; that finding does **not** prove that JSON output is requested. Use an appropriate action constraint when polarity matters.

## Explicit numeric bounds

The recognized form is `OPERATOR NUMBER UNIT`, optionally inside the simple wrapper below. Operator names and units match without case sensitivity.

| Contract operator | Recognized wording |
| --- | --- |
| `lt` | `less than`, `fewer than`, `under` |
| `lte` | `at most`, `no more than`, `not more than`, `up to` |
| `eq` | `exactly` |
| `gte` | `at least`, `no fewer than`, `no less than` |
| `gt` | `more than`, `over` |

`NUMBER` consists of digits, optionally followed by a decimal point and more digits. Leading zeros and trailing decimal zeros are accepted and compared by numeric value. Spelled numbers, negative signs, thousands separators, scientific notation, fractions, and approximation words are unsupported.

`UNIT` is the configured literal unit, with flexible whitespace between its words. There is no plural inference or conversion: `words`, `word`, `tokens`, and `characters` are different units.

The complete wrapper grammar is:

```text
[please ] [VERB [ [ARTICLE ]OBJECT] [to|within] ] OPERATOR NUMBER UNIT

VERB    = use | write | return | produce | give | keep | limit
ARTICLE = the | your | my
OBJECT  = answer | response | output | summary | description | text | it
```

Brackets indicate optional components; components are separated by whitespace. A bare bound is supported. Examples include `At most 150 words.`, `Use no more than 150 words.`, and `Keep the answer under 150 words.` Additional trailing prose is unsupported. `The answer must be at most 150 words.` is not a supported wrapper.

- Same operator, numeric value, and unit: `preserved`.
- A supported different operator or value: `changed`, including a stricter bound.
- Multiple distinct bounds for the same unit: `uncertain`.
- Identical bounds repeated in separate supported sentences: `preserved`.
- A unit mentioned without a supported bound: `uncertain`.
- No recognized bound or unit mention: `missing`.

Multiple bounds within one sentence are treated as compound scope and require review, even when identical. Numeric evidence highlights the operator, number, and unit, preserving their original spelling and whitespace.

## Simple action imperatives

The complete supported imperative forms are:

```text
[please ] ACTION [TARGET]
[please ] do not ACTION [TARGET]
[please ] don't ACTION [TARGET]
[please ] don’t ACTION [TARGET]
[please ] never ACTION [TARGET]
```

Plain imperatives express `require`; the four negative forms express `forbid`. `ACTION` is the configured action or one of its explicit aliases. Matching is case-insensitive, allows whitespace between words, and does not stem or conjugate verbs. Caller-supplied aliases assert equivalence; the library does not verify synonyms. Longer aliases are considered first.

The configured `target` must match the **whole operand**, after trimming, collapsing whitespace, and lowercasing. With `action: "run"` and `target: "tests"`, `Run tests.` is supported, while `Run tests in staging.` is `uncertain`. Substring matches cannot silently widen or narrow the target. If `target` is omitted, the rule retains the source imperative's exact normalized operand; it does not ignore the operand.

- Same polarity and operand: `preserved`.
- Opposite polarity with the same operand: `contradicted`.
- Both polarities present: `uncertain`.
- Recognized action in unsupported grammar or with a different operand: `uncertain`.
- No configured action or alias token: `missing`, including unconfigured inflections or paraphrases.

Modal prose such as `You should run tests.` is unsupported. So are operands containing `not`, `never`, `must`, `should`, `may`, `might`, `can`, `could`, `would`, or `without`. Action evidence includes the complete matching sentence or line, including any bullet or ending punctuation.

## Scope and segmentation

The parser separates text at periods, exclamation marks, question marks, semicolons, and newlines. Decimal points between digits are retained. Leading `-`, `*`, or `•` bullets are accepted. This is not a Markdown parser or a full sentence parser.

Action and numeric candidates containing a question mark, quote, backtick, parentheses, colon, or comma require review. So do candidates containing these scope words: `and`, `or`, `but`, `if`, `unless`, `when`, `whenever`, `while`, `until`, `after`, `before`, `except`, `only`, `instead`, `otherwise`, `provided`, `although`, or `because`.

Scope can extend beyond a line. Therefore a double quote/backtick, a recognized pair of single quotes, or any of `if`, `unless`, `when`, `whenever`, `until`, `except`, `only`, `otherwise`, or `provided` anywhere in the checked text makes recognized action/bound candidates uncertain. Lines introduced by `Example:`, `Quote:`, `Sample:`, or `Hypothetical:` are also treated conservatively. These checks intentionally allow false alarms instead of assuming that later lines escape earlier scope. Literal presence checks do not use these scope rules.

Word boundaries use ASCII letters, digits, and underscore for action/unit recognition. Non-English morphology, implicit constraints, discourse references, arbitrary Markdown nesting, and semantic equivalence are outside this grammar. `missing` and `uncertain` require human review; neither means that an instruction was definitely removed.

## Bounded evidence

Each finding returns at most 64 rewritten evidence spans. Segments and regex matches are streamed rather than collected without a limit. More than 64 action or numeric candidates produces `uncertain` with the first 64 spans; a later contradiction is never silently discarded to report preservation. Source candidate overflow also produces `uncertain`. Unsupported unit-only evidence is capped at 64 spans.

The literal rule may report `preserved` after collecting 64 occurrences because it promises presence only. The optional semantic-checker interface is separate from these deterministic rules and should not be interpreted as an execution permission check.
