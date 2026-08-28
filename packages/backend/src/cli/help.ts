export const AGENT_HELP = `drive-coding agent — talk to a running drive-coding server over HTTP

Usage:
  drive-coding instances [--json]
  drive-coding agent <command> [options]

Discovery (agent commands only — never guessed):
  --base <url>          Absolute server URL              (wins)
  --port <n>            http://127.0.0.1:<n>             (next)
  DRIVE_CODING_BASE     Env URL                          (next)
  instance registry     Unique live row, else error      (last)
  PORT is NOT read. Zero or 2+ live instances → exit 1.

Commands:
  instances             List live servers. Always exit 0 (empty list is ok).
  agent list            GET /api/agents (needs a unique base)
  agent open            Create a session
  agent send            Prompt + wait for turn end
  agent state           GET /api/agents/:id/state
  agent close           DELETE /api/agents/:id
  agent notify          Push a prompt to a live session (fire-and-forget)

agent open:
  --cli <kind>          Required (cursor, claude, …)
  --cwd <dir>           Default: process.cwd()
  --env K=V             Repeatable. Child also gets DRIVE_CODING_BASE and DC_BASE
  --parent <agentId>    Sets DC_PARENT on child and parentAgentId on server
  --close-on-turn-end   Auto-close agent after first clean turn end
  --permission <policy> allow_once | allow_always | reject_once | ask
  --json
  --public-url <url>    Link host in the printed URL (default: --base)

agent send:
  --agent <id>          Required
  --prompt-file <path>  Required unless --prompt
  --prompt <text>
  --set id=value        Repeatable session/set_config_option before prompt
  --file <path>         Succeed when this path appears
  --marker <s>          Succeed when SSE data contains this string
  --timeout <sec>       Overall wait (default 1800)
  --idle-timeout <sec>  Stuck-turn detector (0 = off)
  --no-wait             Return after POST
  --keep                Do not DELETE on success

agent notify:
  --agent <id>          Required
  --text <s> | --text-file <path>

agent close:
  --agent <id>          Required
  --force               Close even if turnState is not idle

agent state / list:
  --agent <id>          (state only)
  --json
`
