# Codex hooks

Lifecycle: `SessionStart` via workspace/plugin `hooks.json`
(see https://developers.openai.com/codex/hooks).

Stdout shape: plain text **or** `hookSpecificOutput.additionalContext`
(developer context). Keep payloads under Codex’s additionalContext token cap.

Wire preference: `config.developer_instructions` when connecting in-process.

Scripts: TBD — call `../_shared/fetch-prompt.sh`, wrap as needed, exit 0 on empty.
