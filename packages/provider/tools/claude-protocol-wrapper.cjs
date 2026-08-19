#!/usr/bin/env node
"use strict";

/**
 * claude-protocol-wrapper.cjs — passive stdio tap between the Claude Agent SDK
 * and the real `claude` executable. A DEBUG TOOL (not part of the product path).
 *
 * Ported from ClaudeCodeACP (`src/wrapper/claude-protocol-wrapper.js`, 2026-06).
 * CommonJS (.cjs) on purpose: it runs as a standalone subprocess (a claude
 * replacement), never imported into the ESM graph — so the ESM-only rule doesn't
 * apply. Kept dependency-free (node builtins only) so it can be pointed at directly.
 *
 * WHAT IT DOES
 *   Spawns the real claude.exe and mirrors EVERY byte in both directions
 *   immediately (stdin→claude, claude→stdout/stderr), while ALSO appending a copy
 *   to per-session log files. It never delays or mutates the stream — a passive
 *   mirror — so it cannot stall the live channel.
 *
 * WHY
 *   claude emits an auto-generated session TITLE (a few turns in) that the
 *   claude-agent-acp adapter does NOT translate into an ACP session/update — so our
 *   FE never sees it. This tap captures the RAW claude↔SDK protocol so we can see
 *   the exact frame (its shape / field) and then teach the FE/adapter to surface it.
 *
 * HOW TO ARM IT (opt-in, isolated — never on a live agent you're working with)
 *   Point the SDK at this wrapper and tell the wrapper where the real claude is:
 *     _meta.claudeCode.options.pathToClaudeCodeExecutable = <this file, run via node/bun>
 *     _meta.claudeCode.options.env.CLAUDE_WRAPPER_REAL_CLAUDE = <real claude.exe>
 *     _meta.claudeCode.options.env.CLAUDE_WRAPPER_LOG_DIR     = <capture dir>   (optional)
 *   (Injection channel: packages/provider/src/connection/claude-env-override.ts —
 *    the same `_meta.claudeCode.options` path already used for env/model.)
 *   Captures land in  CLAUDE_WRAPPER_LOG_DIR/<ts-pid>/{stdin,stdout,stderr}.lines.ndjson
 *
 * ANALYZE
 *   jq -c 'select(.stream=="stdout") | .json' <dir>/stdout.lines.ndjson | grep -i title
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", ".."); // repo root
const DEFAULT_LOG_DIR = path.join(PROJECT_ROOT, "data", "claude-captures");

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function looksLikeClaudeExecutable(value) {
  return typeof value === "string" && /claude(\.exe|\.cmd|\.bat|\.js)?$/i.test(path.basename(value));
}

/**
 * Resolve the REAL claude to spawn.
 * Priority: CLAUDE_WRAPPER_REAL_CLAUDE env → first argv that looks like claude →
 * auto-detect the pnpm-bundled binary.
 */
function resolveRealClaude(argv) {
  if (process.env.CLAUDE_WRAPPER_REAL_CLAUDE) {
    return { realClaude: path.resolve(process.env.CLAUDE_WRAPPER_REAL_CLAUDE), args: argv, source: "env" };
  }
  if (argv.length > 0 && looksLikeClaudeExecutable(argv[0])) {
    return { realClaude: path.resolve(argv[0]), args: argv.slice(1), source: "argv" };
  }
  // auto-detect: node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-win32-*/.../claude.exe
  const pnpm = path.join(PROJECT_ROOT, "node_modules", ".pnpm");
  try {
    const hit = fs
      .readdirSync(pnpm)
      .filter((d) => d.startsWith("@anthropic-ai+claude-agent-sdk-win32"))
      .map((d) => path.join(pnpm, d, "node_modules", "@anthropic-ai", d.split("@")[1].split("+").slice(1).join("+").replace(/@.*/, ""), "claude.exe"))
      .find((p) => fs.existsSync(p));
    if (hit) return { realClaude: hit, args: argv, source: "pnpm-autodetect" };
  } catch {
    /* fall through */
  }
  throw new Error("claude-protocol-wrapper: set CLAUDE_WRAPPER_REAL_CLAUDE — could not auto-detect claude.exe");
}

function openLog(dir, name) {
  return fs.createWriteStream(path.join(dir, name), { flags: "a" });
}

/** Mirrors a byte stream to an ndjson log line-by-line (with parsed JSON when possible). */
class LineMirror {
  constructor(stream, label) {
    this.stream = stream;
    this.label = label;
    this.buffer = "";
  }
  write(chunk) {
    this.buffer += chunk.toString("utf8");
    for (;;) {
      const lf = this.buffer.indexOf("\n");
      if (lf === -1) return;
      const line = this.buffer.slice(0, lf).replace(/\r$/, "");
      this.buffer = this.buffer.slice(lf + 1);
      this.#emit(line);
    }
  }
  end() {
    if (this.buffer.length > 0) this.#emit(this.buffer);
    this.buffer = "";
    this.stream.end();
  }
  #emit(line) {
    const record = { ts: new Date().toISOString(), stream: this.label, raw: line };
    try {
      record.json = JSON.parse(line);
    } catch {
      record.parseError = true;
    }
    this.stream.write(`${JSON.stringify(record)}\n`);
  }
}

function main() {
  const { realClaude, args, source } = resolveRealClaude(process.argv.slice(2));
  const logRoot = path.resolve(process.env.CLAUDE_WRAPPER_LOG_DIR || DEFAULT_LOG_DIR);
  const sessionDir = path.join(logRoot, `${timestampForPath()}-${process.pid}`);
  ensureDir(sessionDir);

  fs.writeFileSync(
    path.join(sessionDir, "meta.json"),
    `${JSON.stringify({ startedAt: new Date().toISOString(), wrapperPid: process.pid, cwd: process.cwd(), realClaude, realClaudeSource: source, args }, null, 2)}\n`,
  );

  const stdinLines = new LineMirror(openLog(sessionDir, "stdin.lines.ndjson"), "stdin");
  const stdoutLines = new LineMirror(openLog(sessionDir, "stdout.lines.ndjson"), "stdout");
  const stderrLines = new LineMirror(openLog(sessionDir, "stderr.lines.ndjson"), "stderr");

  const child = spawn(realClaude, args, { cwd: process.cwd(), env: process.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

  child.on("error", (error) => {
    fs.writeFileSync(path.join(sessionDir, "spawn-error.json"), `${JSON.stringify({ error: error.message, code: error.code }, null, 2)}\n`);
    process.stderr.write(`claude-protocol-wrapper: failed to spawn real claude: ${error.message}\n`);
    process.exitCode = 1;
  });

  // passthrough + mirror — forward first, log second; never block the stream.
  process.stdin.on("data", (c) => { child.stdin.write(c); stdinLines.write(c); });
  process.stdin.on("end", () => { child.stdin.end(); stdinLines.end(); });
  process.stdin.on("error", () => child.stdin.end());
  child.stdout.on("data", (c) => { process.stdout.write(c); stdoutLines.write(c); });
  child.stderr.on("data", (c) => { process.stderr.write(c); stderrLines.write(c); });

  child.on("exit", (code, signal) => {
    stdoutLines.end();
    stderrLines.end();
    fs.writeFileSync(path.join(sessionDir, "exit.json"), `${JSON.stringify({ exitedAt: new Date().toISOString(), code, signal }, null, 2)}\n`);
    if (typeof code === "number") process.exit(code);
    if (signal) { process.kill(process.pid, signal); return; }
    process.exit(0);
  });
}

main();
