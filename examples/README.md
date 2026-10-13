# Local examples

From the repository root, after installing the development dependencies:

```bash
npm run build
node examples/sdk.mjs
node dist/cli.js examples/local-demo.json
node dist/cli.js examples/local-demo.json --json
cat examples/local-demo.json | node dist/cli.js - --json
```

The fixture deliberately raises the word limit and reverses a prohibition while retaining a required literal. The CLI should return exit code `1` because declared constraints changed. The SDK demo prints the report without setting a failure exit code.

The JSON format names the original text, its rewrite, and explicit constraints anchored to quotes in the original. The SDK is imported from the local build; these examples do not assume that a package has been published to npm.

Exit codes: `0` preserved, `1` changed, `2` review required, `3` invalid input or I/O error. A preserved result applies only to supplied constraints and supported checks; it does not prove semantic equivalence.
