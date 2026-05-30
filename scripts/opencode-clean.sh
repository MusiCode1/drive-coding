#!/bin/bash
# opencode-clean.sh — wrapper that strips OneCLI-injected proxy/placeholder vars
# before launching opencode in ACP mode.
#
# Problem: the BE runs under `onecli run --agent voice-acp`, which injects
#   ANTHROPIC_API_KEY=placeholder  (overrides opencode's own OAuth)
#   HTTP_PROXY / HTTPS_PROXY       (routes opencode through OneCLI proxy)
#   NODE_USE_ENV_PROXY=1           (forces Node/Bun to honour the proxy vars)
#
# opencode has its own stored OAuth token for Anthropic and does NOT need the
# OneCLI proxy. Passing these vars causes "No models available" / "socket
# connection was closed unexpectedly" on every session/new call.
#
# Solution: OPENCODE_BIN points here; bridge-manager.ts uses this instead of
# the bare `opencode` binary. We strip the problematic vars and exec opencode.
exec env \
  -u ANTHROPIC_API_KEY \
  -u HTTP_PROXY \
  -u HTTPS_PROXY \
  -u http_proxy \
  -u https_proxy \
  -u NODE_USE_ENV_PROXY \
  opencode "$@"
