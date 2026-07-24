import { resolveCliBinary } from "@drive-coding/core"

/**
 * Prefer a `claude` on PATH over the SDK's embedded (platform-specific) binary.
 * The claude-agent-acp bridge resolves pathToClaudeCodeExecutable as
 * `process.env.CLAUDE_CODE_EXECUTABLE ?? <SDK embedded>` — it never consults PATH,
 * and overrides any _meta.claudeCode.options value. So process.env is the only lever.
 *
 * No-op when: CLAUDE_CODE_EXECUTABLE is already set (respect explicit override),
 * or no `claude` is found (leave unset → bridge falls back to the SDK binary).
 * Mutates `env` in place (default process.env) — deliberate one-time boot resolution.
 */
export function preferPathClaudeExecutable(env: NodeJS.ProcessEnv = process.env): void {
  if (env.CLAUDE_CODE_EXECUTABLE) return
  const resolved = resolveCliBinary({ bin: "claude" }, env)
  if (resolved) env.CLAUDE_CODE_EXECUTABLE = resolved
}
