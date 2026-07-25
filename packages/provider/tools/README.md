# provider/tools — debug helpers

Standalone debug tools for the provider layer. **Not** part of the product path;
opt-in only.

## `claude-protocol-wrapper.cjs`

A passive stdio tap between the Claude Agent SDK and the real `claude` executable.
Spawns the real claude and mirrors every byte in both directions **immediately**,
appending a copy to per-session ndjson logs. It never delays/mutates the stream, so
it cannot stall the live channel.

**Why**: claude emits an auto-generated session **title** (a few turns into a chat)
that `claude-agent-acp` does *not* forward as an ACP `session/update` — so our FE
never sees it (attach/reconnect show no title). This tap captures the raw claude↔SDK
protocol so we can find the exact frame and teach the FE/adapter to surface it.

### Arm it (isolated — never on a live agent you're using)

Inject via the existing `_meta.claudeCode.options` channel
(`src/connection/claude-env-override.ts`):

```
_meta.claudeCode.options.pathToClaudeCodeExecutable = <node|bun> + this file
_meta.claudeCode.options.env.CLAUDE_WRAPPER_REAL_CLAUDE = <path to real claude.exe>
_meta.claudeCode.options.env.CLAUDE_WRAPPER_LOG_DIR     = <capture dir>   # optional
```

- Real claude auto-detects from `node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-win32-*`
  if `CLAUDE_WRAPPER_REAL_CLAUDE` is unset.
- Captures land in `CLAUDE_WRAPPER_LOG_DIR/<ts-pid>/` (default `data/claude-captures/`,
  gitignored): `stdin.lines.ndjson`, `stdout.lines.ndjson`, `stderr.lines.ndjson`, `meta.json`.

### Find the title frame

```bash
# claude → SDK direction; look for the title it generates a few turns in
jq -rc 'select(.stream=="stdout") | .json | select(.!=null)' \
  data/claude-captures/*/stdout.lines.ndjson | grep -iE 'title|summary'
```

### Safety

- Passthrough-first, log-second — zero added latency, cannot stall the pipe.
- Per-invocation (own session dir); run it only against a **dedicated test agent**,
  not the sessions you're actively working with.
