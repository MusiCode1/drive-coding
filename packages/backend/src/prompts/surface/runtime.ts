/**
 * Surface prompt — this BE instance (PID, port, URLs, env).
 * Built at inject time from live process / registry values — never hardcode a host
 * in the catalog.
 */

export type SurfaceRuntimeEnv = {
  DRIVE_CODING_BASE?: string
  DC_BASE?: string
  DRIVE_CODING_AGENT_ID?: string
  DC_PARENT?: string
  PUBLIC_BASE_URL?: string
}

export type SurfaceRuntimeInfo = {
  /** Loopback or listen URL the child uses for API/MCP (e.g. http://127.0.0.1:4001). */
  baseUrl: string
  port: number
  pid: number
  /**
   * Optional public HTTPS origin (tunnel / VPS) for links the user opens in a
   * signed-in browser. When set, prefer it for markdown links the user will click.
   * Not the same as DRIVE_CODING_BASE (children stay on loopback).
   */
  publicBaseUrl?: string
  /** This agent's id when known (DRIVE_CODING_AGENT_ID / X-Drive-Coding-Agent). */
  agentId?: string
  /** Parent agent id when this agent was opened as a child. */
  parentAgentId?: string
  /**
   * Env values the BE knows for this agent / instance. Missing keys render as
   * *(unset)* in the table — do not invent values at compose time.
   */
  env?: SurfaceRuntimeEnv
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "")
}

function envCell(value: string | undefined): string {
  if (value === undefined || value.length === 0) return "*(unset)*"
  return `\`${value}\``
}

/** Build a clickable `/api/fs/file` URL for an absolute local path. */
export function buildFsFileUrl(origin: string, absolutePath: string): string {
  const fileUri = absolutePath.startsWith("file:")
    ? absolutePath
    : `file://${absolutePath.startsWith("/") ? "" : "/"}${absolutePath}`
  return `${stripTrailingSlash(origin)}/api/fs/file?uri=${encodeURIComponent(fileUri)}`
}

/**
 * Fill env bag from runtime info when the caller only set top-level fields.
 * Explicit `env` keys win over derived ones.
 */
export function resolveSurfaceRuntimeEnv(info: SurfaceRuntimeInfo): SurfaceRuntimeEnv {
  const base = stripTrailingSlash(info.baseUrl)
  const publicOrigin = info.publicBaseUrl
    ? stripTrailingSlash(info.publicBaseUrl)
    : undefined
  const derived: SurfaceRuntimeEnv = {
    DRIVE_CODING_BASE: base,
    DC_BASE: base,
  }
  if (info.agentId !== undefined && info.agentId.length > 0) {
    derived.DRIVE_CODING_AGENT_ID = info.agentId
  }
  if (info.parentAgentId !== undefined && info.parentAgentId.length > 0) {
    derived.DC_PARENT = info.parentAgentId
  }
  if (publicOrigin !== undefined) {
    derived.PUBLIC_BASE_URL = publicOrigin
  }
  return { ...derived, ...info.env }
}

export function buildSurfaceRuntime(info: SurfaceRuntimeInfo): string {
  const base = stripTrailingSlash(info.baseUrl)
  const publicOrigin = info.publicBaseUrl
    ? stripTrailingSlash(info.publicBaseUrl)
    : undefined
  const linkOrigin = publicOrigin ?? base
  const examplePath = "/home/user/Projects/example/README.md"
  const exampleLink = buildFsFileUrl(linkOrigin, examplePath)
  const env = resolveSurfaceRuntimeEnv(info)

  const lines = [
    "# This drive-coding instance",
    "",
    `- **PID:** ${info.pid}`,
    `- **Port:** ${info.port}`,
    `- **Base URL (loopback / listen):** ${base}`,
    `- **MCP endpoint:** ${base}/api/mcp`,
    `- **File proxy:** ${base}/api/fs/file?uri=<encodeURIComponent(file:///abs/path)>`,
  ]

  if (publicOrigin !== undefined) {
    lines.push(`- **Public origin (user-facing links):** ${publicOrigin}`)
  }
  if (info.agentId !== undefined && info.agentId.length > 0) {
    lines.push(`- **Your agent id:** ${info.agentId}`)
  }

  lines.push(
    "",
    "## Environment (this process)",
    "",
    "drive-coding sets (or inherits) these so you can reach the same backend without",
    "guessing ports:",
    "",
    "| Variable | Value | Use |",
    "|---|---|---|",
    `| \`DRIVE_CODING_BASE\` | ${envCell(env.DRIVE_CODING_BASE)} | Loopback API / MCP from this machine |`,
    `| \`DC_BASE\` | ${envCell(env.DC_BASE)} | Same as \`DRIVE_CODING_BASE\` (legacy alias) |`,
    `| \`DRIVE_CODING_AGENT_ID\` | ${envCell(env.DRIVE_CODING_AGENT_ID)} | Your id (also \`X-Drive-Coding-Agent\` on MCP) |`,
    `| \`PUBLIC_BASE_URL\` | ${envCell(env.PUBLIC_BASE_URL)} | User-facing HTTPS origin (links the user opens) |`,
    `| \`DC_PARENT\` | ${envCell(env.DC_PARENT)} | Parent agent id when you were opened as a child |`,
    "",
    "- Prefer **\`DRIVE_CODING_BASE\`** for HTTP/MCP to this BE (loopback; no Cloudflare Access).",
    "- Prefer **\`PUBLIC_BASE_URL\`** (when set) for markdown links the **user** clicks in a browser.",
    "- If a row says *(unset)*, that key is not known here — do not invent it.",
    "",
    "When you want the user to **open a local file in the browser**, give a markdown",
    "link through the file proxy — do not only dump a dead path. Example:",
    "",
    `[README.md](${exampleLink})`,
    "",
    "Encode the whole `file://` URI. Never leave trailing `]` or other markdown",
    "punctuation inside the URL. Allowed extensions are listed under display capabilities.",
  )

  return lines.join("\n")
}
