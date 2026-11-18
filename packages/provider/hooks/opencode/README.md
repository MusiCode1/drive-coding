# OpenCode

OpenCode does **not** use Claude/Cursor-style `hooks.json`. Injection in
production today is the in-process plugin:

`packages/backend/plugins/prompt-injector.ts`
+ `OPENCODE_CONFIG_CONTENT` / `PROMPT_INJECTOR_TEXT`.

This directory is reserved if we later add a thin HTTP-fed variant or document
how the plugin should call the same BE endpoint for parity with other CLIs.
