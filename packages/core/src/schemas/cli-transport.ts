/**
 * cli-transport.ts — per-CLI transport + filesystem descriptors (slice cli-transport).
 *
 * These extend `CliSpec` (schemas/agent.ts) so every cliKind can declare *how*
 * the backend talks to its agent process and *where* that agent's files live.
 * Both are optional: a spec with neither behaves exactly like today — `stdio`
 * transport (in-process/spawn) reading the backend's own local filesystem.
 *
 * Pure types + one pure helper only; no IO. The JSONC override is validated in
 * `provider/config/cli-config-file.ts`, and the backend resolves the WebDAV
 * password (`passEnv`) at the edge — neither belongs here (core = pure logic).
 */

/** How the backend carries the ACP wire to this CLI's agent process. */
export const TRANSPORT_MODES = ["stdio", "unix", "http"] as const
export type TransportMode = (typeof TRANSPORT_MODES)[number]

export type CliTransport = {
  /**
   * stdio = local in-process/spawn (today's behavior).
   * unix  = sidecar over a Unix-domain socket (implemented).
   * http  = 🚧 reserved — not implemented on the backend yet; selecting it errors
   *         clearly at connect time rather than falling back silently.
   */
  readonly mode: TransportMode
  /**
   * Run the agent in a separate process/unit rather than in-process. Undefined
   * defaults to `false` for `stdio` and `true` for `unix`/`http`
   * (see `transportUsesSidecar`).
   */
  readonly sidecar?: boolean
  /**
   * Explicit socket file path for `unix`. Put it in a directory bind-mounted
   * into both the backend container and the agent container to cross the
   * container boundary. Takes precedence over `socketDir`.
   */
  readonly socketPath?: string
  /** Alternative to `socketPath`: a directory; the socket is `<dir>/<agentId>.sock`. */
  readonly socketDir?: string
  /**
   * Never launch — only attach to a socket some other process already bound
   * (the agent container owns the sidecar's lifecycle). Meaningful only with a
   * sidecar transport.
   */
  readonly attachOnly?: boolean
  /** Reserved for `mode:"http"` — the base URL of the remote wire. */
  readonly httpUrl?: string
}

/** Backend reads this CLI's files from its own local disk (today's behavior). */
export type CliFsLocal = { readonly kind: "local" }

/** Backend browses/serves this CLI's files over WebDAV (an external rclone serve). */
export type CliFsWebdav = {
  readonly kind: "webdav"
  /** Base URL, e.g. an SSH-tunneled `http://127.0.0.1:17654`. */
  readonly url: string
  readonly user: string
  /** Inline password — dev only. Prefer `passEnv`. */
  readonly pass?: string
  /** Name of the env var holding the password — the recommended, committable form. */
  readonly passEnv?: string
  /** Absolute path on the remote host that is the WebDAV document root. */
  readonly root: string
}

export type CliFs = CliFsLocal | CliFsWebdav

/**
 * Whether a transport runs the agent in a sidecar. Explicit `sidecar` wins;
 * otherwise `unix`/`http` imply a sidecar and `stdio` does not.
 */
export function transportUsesSidecar(t: CliTransport): boolean {
  return t.sidecar ?? (t.mode === "unix" || t.mode === "http")
}
