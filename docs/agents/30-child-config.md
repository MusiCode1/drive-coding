---
id: child-config
title: Child config — models, permissions, and sets
summary: How to change a spawned agent's model, permission mode, and other CLI options using the live catalog, not guessed ids.
read_when:
  - You want a child agent to run on a different model or permission mode
  - You are about to guess a config option id instead of reading the catalog
  - A sets call was accepted and nothing changed
tags: [config, session]
surface: [http, mcp]
stability: stable
mcp_tools: [session_open, session_send, session_state]
docs_version: 1.1.0
updated: 2026-09-28
---

# Child config

Every CLI exposes different knobs. drive-coding does **not** hard-code option names — it
forwards the **live ACP catalog** from the running child.

## Where the catalog comes from

After **session_open** (or **session_state**), inspect:

- **`cli.displayName`** — which CLI this is.
- **`configOptions`** — ACP options: `id`, name/description, category, `currentValue`,
  allowed values.
- **`modes.availableModes`** — session modes (often permission / plan / bypass), each with
  `id` and description.

MCP **`MCP_CONFIGURE_HINT`** (returned on open) states: options are the CLI's **live**
settings — model, permission, agent persona, thinking, etc. Change them with
**`sets: { "<id>": "<value>" }` on session_send**. Use **only ids from this catalog**.

HTTP **`POST /api/agents`** accepts the same spawn fields; ongoing changes go through
**`session_send.sets`** or RPC config methods where exposed.

## Permission at spawn — MCP vs HTTP field names

The stored value is always **`permissionPolicy`** on the agent record, but the **request
field name differs by surface**:

| Surface | Field in the open body | Schema anchor |
|---|---|---|
| **MCP** `session_open` | **`permission`** | `AgentOpenInput.permission` → mapped in `session-open-body.ts` |
| **HTTP** `POST /api/agents` | **`permissionPolicy` only** | `create-agent-input.ts` — there is **no** `permission` key |

On HTTP, `{"permission": "ask"}` is **silently ignored** (undeclared keys are not applied).
Use **`permissionPolicy`**:

```json
POST /api/agents
{ "cliKind": "cursor", "cwd": "/abs/path", "permissionPolicy": "ask" }
```

MCP **`session_open`** accepts **`permission`** with the same enum values.

Validated **policy enum** (what the backend enforces):

| Value | Meaning |
|---|---|
| `allow_once` | Allow each permission prompt once |
| `allow_always` | Allow ongoing |
| `reject_once` | Reject once |
| `ask` | Prompt the user |

These are **`PermissionPolicy`** values — not tool names. Do **not** confuse with ACP
**permission prompt answer** kinds (`allow_once`, `allow_always`, `reject_once`,
`reject_always`) used when answering a single SDK prompt.

Schema text on MCP may mention examples like **`bypassPermissions`** — that string is **not**
in the enforced enum (likely a CLI **mode id**). For non-policy behavior, check
**`modes.availableModes`** in the catalog and apply via **`sets`**, not `permission`.

## Applying changes with `sets`

On **session_send**, optional **`sets`** is a map of **option id → string value**:

```json
{
  "agent": "<uuid>",
  "prompt": "…",
  "sets": { "model": "…", "permission": "…" }
}
```

Rules:

1. Keys **must** be ids from **`configOptions`** or mode ids from **`modes`** — never invented names.
2. Read each option's **description and allowed values** before writing.
3. If an option is missing from the catalog, this CLI does not expose it over MCP.
4. **`sets` runs before the prompt** for that send. If nothing changed, you likely used a
   wrong id, a value outside allowed values, or a read-only option.

CLI **`drive-coding agent send --set id=value`** uses the same mechanism.

## HTTP PATCH (metadata only)

**`PATCH /api/agents/:id`** whitelists user metadata (`title`, `userNotes`, `persistent`, …)
and a guarded **connection tuple** (`acpSessionId` + `status` + `cwd`). It is **not** the
primary path for model/permission — use **`sets`** on send or ACP RPC config calls.

## Workflow checklist

1. **session_open** → save `agent` id and skim `configOptions` / `modes`.
2. Decide ids and legal values from the catalog (not from memory).
3. **session_send** with `sets` + prompt, or send with `sets` alone on a no-op prompt if your client allows.
4. **session_state** → confirm `currentValue` updated before relying on behavior.

## When config seems ignored

- Wrong **id** (typo or from a different CLI) — silent no-op or ACP error in turn.
- Value not in **allowed** list — child may reject the turn; check **`lastTurnError`** in
  send result or state.
- Expecting **`permission`** to set a **mode** name — use **`sets`** with a **mode id** instead.
