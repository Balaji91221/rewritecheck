#!/usr/bin/env node
import { createReadStream, readFileSync } from "node:fs";
import type { Readable } from "node:stream";
import { auditRewrite, AuditInputError } from "./index.js";
import type { AuditInput, AuditReport } from "./types.js";

const MAX_INPUT_BYTES = 1024 * 1024;
const HELP = `rewritecheck — audit explicit constraints in a rewritten prompt

Usage:
  rewritecheck <json-file | -> [--json]
  rewritecheck --help
  rewritecheck --version

Input JSON contains original, rewritten, and constraints.
Use - to read standard input. Input is limited to 1 MiB of UTF-8 data.

Options:
  --json       Print the complete audit report as JSON
  --help, -h   Show this help
  --version    Show the installed package version

Exit codes:
  0  Supplied constraints preserved by the supported checks
  1  A supplied constraint changed or was contradicted
  2  Missing, uncertain, or unsupported evidence requires review
  3  Invalid arguments, input, or I/O error

Only supplied constraints are checked. This is not a general guarantee
that two prompts have the same meaning. No model or network call is made.
`;

function safeText(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

async function readBounded(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += bytes.length;
    if (size > MAX_INPUT_BYTES) {
      stream.destroy();
      throw new AuditInputError("Input exceeds the 1 MiB limit.");
    }
    chunks.push(bytes);
  }
  // Reject invalid UTF-8 instead of silently replacing bytes in evidence text.
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

function printReport(report: AuditReport, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const lines = [
    `RewriteCheck: ${report.verdict.toUpperCase()}`,
    `Checked ${report.checkedConstraints} supplied constraint${report.checkedConstraints === 1 ? "" : "s"}.`,
    "",
    ...report.findings.map((finding) =>
      `  [${finding.status}] ${safeText(finding.id)}: ${safeText(finding.reason)}`,
    ),
    "",
    "Only supplied constraints were checked; this is not a semantic-equivalence guarantee.",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  try {
    if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
      process.stdout.write(HELP);
      return;
    }
    if (args.length === 1 && args[0] === "--version") {
      const metadata = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
      process.stdout.write(`${metadata.version}\n`);
      return;
    }
    if (args.filter((arg) => arg === "--json").length > 1) {
      throw new AuditInputError("Pass --json at most once.");
    }
    const paths = args.filter((arg) => arg !== "--json");
    if (paths.length !== 1 || (paths[0] !== "-" && paths[0]?.startsWith("-"))) {
      throw new AuditInputError("Expected one JSON file or -. Run rewritecheck --help for usage.");
    }
    const path = paths[0]!;
    let text: string;
    try {
      text = await readBounded(path === "-" ? process.stdin : createReadStream(path));
    } catch (error) {
      if (error instanceof AuditInputError) throw error;
      if (error instanceof TypeError) throw new AuditInputError("Input must be valid UTF-8 text.");
      const message = error instanceof Error ? error.message : "Unable to read input.";
      throw new AuditInputError(message);
    }
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      throw new AuditInputError("Input is not valid JSON.");
    }
    const report = auditRewrite(input as AuditInput);
    printReport(report, json);
    process.exitCode = report.verdict === "preserved" ? 0 : report.verdict === "changed" ? 1 : 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to audit input.";
    process.stderr.write(json ? `${JSON.stringify({ error: message })}\n` : `rewritecheck: ${safeText(message)}\n`);
    process.exitCode = 3;
  }
}

void main();
