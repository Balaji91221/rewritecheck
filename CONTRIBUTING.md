# Contributing

RewriteCheck is a small TypeScript library with no runtime dependencies. Start with a reproducible pair of prompts and an explicit constraint contract.

```sh
npm ci
npm test
npm run benchmark
```

For a new rule or grammar extension, include positive, contradictory, and ambiguous cases. Ambiguous language should remain `uncertain` unless the supported grammar justifies a stronger result. Every evidence span must slice back to the exact input text.

Keep the public SDK browser-compatible. Put filesystem/process code in the CLI. Tests use Node's built-in test runner. Add a labeled benchmark case when it illustrates a real failure, and document grammar or API changes.

Reports concern supplied constraints only. Please avoid claims of universal intent preservation, safety certification, or unbiased model evaluation. A failing case is more useful than an impressive-looking aggregate score.

Before opening a pull request, run tests, the benchmark, and `npm pack --dry-run`; explain the behavior change and its limits. Do not include private prompts, API keys, or provider credentials in fixtures.
