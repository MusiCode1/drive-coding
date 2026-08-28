/**
 * connect-in-process.ts — connectInProcess: ProviderConnection wrapping ClaudeAcpAgent in-process.
 *
 * Model 2: agentApp.connect(stream) — the FE is the ACP client.
 * No internal clientApp. The stream-bridge exposes agentEnd (for agentApp) and
 * wireEnd (for ProviderConnection.wire). The FE drives the ACP protocol over the wire.
 *
 * Architecture:
 *   FE ←[wire: string onLine/write]→ streamBridge ←[Stream: AnyMessage]→ agentApp (ClaudeAcpAgent)
 *
 * onFrame tap: tap wireEnd.onLine (agent→FE, dir="in") + wrap wire.write (FE→agent, dir="out").
 * turn-tracker: observed on dir="in" only (matches bridge-manager convention).
 * capabilities: mapClaudeCapabilities(null) — claude static (thinkingTokens=true, rename=true, mcp=true).
 * ext: undefined (ext lives inside the wire via agentApp.onRequest handlers).
 * pid: null — no child process for in-process (documented).
 *
 * modelOverride: wired via SDK query option during agentApp.connect (see below).
 */

import { ClaudeAcpAgent } from "@agentclientprotocol/claude-agent-acp"
import type { NewSessionRequest } from "@agentclientprotocol/sdk"
import { extractPromptCaps } from "@drive-coding/core/acp/extract-prompt-caps"
import { createLogger } from "@drive-coding/core/log"
import { agent, methods, RequestError } from "@agentclientprotocol/sdk"
import { getCliSpec } from "../config/index.js"
import { parseExtParams } from "../extensions/index.js"
import { mapClaudeCapabilities } from "../providers/claude/capabilities.js"
import { makeAcpClientFromCtx } from "../providers/claude/client-bridge.js"
import { getQuery } from "../providers/claude/query-access.js"
import { createClaudeQuotaHandler } from "../providers/claude/quota-handler.js"
import { createTurnTracker } from "../shared/turn-tracker.js"
import { decodeWireLine } from "../shared/wire-decode.js"
import type { NormalizedCapabilities } from "../types.js"
import { buildClaudeEnvOverride, injectEnvOverride } from "./claude-env-override.js"
import { createStreamBridge } from "./stream-bridge.js"
import type { ConnectOpts, ProviderConnection, WireFrame } from "./types.js"

/** Merge cli-spec env override with per-agent keys (DRIVE_CODING_AGENT_ID). */
function mergeAgentEnv(
  specOverride: Record<string, string | undefined> | undefined,
  agentEnv: Record<string, string> | undefined,
): Record<string, string | undefined> | undefined {
  if (specOverride === undefined && (agentEnv === undefined || Object.keys(agentEnv).length === 0)) {
    return undefined
  }
  return { ...specOverride, ...agentEnv }
}

const log = createLogger("provider.connect-in-process")

/** #5 — timeout budget for claudeAgent.dispose() during close(); see brief §9 Q2. */
const DISPOSE_TIMEOUT_MS = 5000

/**
 * withTimeout — races a promise against a timer, rejecting if the promise doesn't
 * settle within `ms`. Local helper — no shared "race with timeout" utility exists
 * in provider (checked: only inline Promise.race in ws.ts:107 / client.ts:256).
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      const t = setTimeout(() => reject(new Error("dispose timeout")), ms)
      t.unref?.()
    }),
  ])
}

/**
 * connectInProcess — creates a ProviderConnection that hosts ClaudeAcpAgent in-process.
 *
 * The agentApp connects to a stream bridge. The returned ProviderConnection.wire
 * exposes the string-based onLine/write interface, which the BE/FE gateway uses.
 *
 * @param opts - ConnectOpts: cwd (passed to initialize), modelOverride
 * @returns ProviderConnection with wire, capabilities, onFrame, turn, onCrash, close, pid
 */

/**
 * Injects modelOverride into session/new params via _meta.claudeCode.options.model.
 * Returns params unchanged if modelOverride is null/undefined.
 */
function injectModelOverride(
  params: Record<string, unknown>,
  modelOverride: string | null | undefined,
): Record<string, unknown> {
  if (modelOverride == null) return params
  const existingMeta = params._meta as Record<string, unknown> | undefined
  const existingClaudeCode = existingMeta?.claudeCode as Record<string, unknown> | undefined
  const existingOptions = existingClaudeCode?.options as Record<string, unknown> | undefined
  return {
    ...params,
    _meta: {
      ...existingMeta,
      claudeCode: {
        ...existingClaudeCode,
        options: {
          ...existingOptions,
          model: modelOverride,
        },
      },
    },
  }
}

/**
 * injectSystemPrompt — מוסיף _meta.systemPrompt:{append} ל-session/new params (קלוד בלבד).
 * המתאם claude-agent-acp@0.58.1 (acp-agent.js:2808) קורא params._meta.systemPrompt:
 *   object {append} → מתווסף ל-preset claude_code. אומת חי 2026-07-19.
 * null/undefined/מחרוזת-ריקה → params ללא שינוי (no-op).
 * additive: משמר _meta.claudeCode ושדות _meta קיימים (deep-spread כמו injectModelOverride).
 */
export function injectSystemPrompt(
  params: Record<string, unknown>,
  systemPrompt: string | null | undefined,
): Record<string, unknown> {
  if (systemPrompt == null || systemPrompt === "") return params
  const existingMeta = params._meta as Record<string, unknown> | undefined
  return {
    ...params,
    _meta: {
      ...existingMeta,
      systemPrompt: { append: systemPrompt },
    },
  }
}

export async function connectInProcess(opts: ConnectOpts): Promise<ProviderConnection> {
  // Listeners for onFrame — broadcast decoded frames.
  const frameListeners = new Set<(f: WireFrame) => void>()

  // turn-tracker — pull-based busy indicator.
  const tracker = createTurnTracker()

  // onChange: last busy state emitted (used to detect transitions).
  let lastBusy = false
  const changeListeners = new Set<(busy: boolean) => void>()

  /** Emit onChange if busy state changed since last frame. */
  function emitBusyChange(): void {
    const nowBusy = tracker.isBusy(Date.now())
    if (nowBusy !== lastBusy) {
      lastBusy = nowBusy
      for (const cb of changeListeners) {
        try {
          cb(nowBusy)
        } catch {
          /* listener must not break the pipe */
        }
      }
    }
  }

  /** Decode a raw line and emit to frameListeners. */
  function handleLine(dir: "in" | "out", rawLine: string): void {
    const normalized = rawLine.endsWith("\n") ? rawLine.slice(0, -1) : rawLine
    const s = decodeWireLine(normalized)

    // turn-tracker: observed on dir="in" only (agent→FE, matches bridge-manager convention).
    if (dir === "in") {
      tracker.observe(s, Date.now())
      emitBusyChange()

      // slice reattach-state-sync Commit 1 — tap the initialize response for the real
      // promptCapabilities (structural: responseKind==="result" + agentCapabilities present).
      const promptCaps = extractPromptCaps(s.parsed)
      if (promptCaps) {
        caps = { ...caps, image: promptCaps.image === true }
      }
    }

    // Derive type label (same as connectSpawn).
    const type =
      s.sessionUpdate ?? s.method ?? s.responseKind ?? (s.unparsed ? "unparsed" : "unknown")

    const frame: WireFrame = {
      dir,
      type,
      id: s.id,
      raw: normalized,
      parsed: s.parsed,
    }

    for (const cb of frameListeners) {
      try {
        cb(frame)
      } catch {
        /* listener must not break the pipe */
      }
    }
  }

  // Create the stream bridge.
  const bridge = createStreamBridge()

  // onCrash listeners — in-process has no child process crash, but we expose
  // the interface for API symmetry (matches dev behavior: onCrash never fires for in-process).
  // C3 wiring (stream-error → crashListeners) was reverted: stream rejections are transient
  // (race with close, transport blip) and not a reliable crash signal. teardown via agentConn.closed.
  const crashListeners = new Set<(info: import("../spawn/index.js").BridgeCrashInfo) => void>()

  // Internal claudeAgent reference (set inside onConnect).
  let claudeAgent: ClaudeAcpAgent | undefined

  // Compute env override from cli-spec once per connection.
  // _meta.claudeCode.options.env is the SDK channel: merged over process.env by createSession,
  // then passed verbatim to spawn(claude, {env}). Node drops keys with value=undefined on spawn
  // ⇒ unset semantics without mutating process.env globally (BE TTS proxy stays intact).
  // loadCliSpecsOverride is memoized per-process — this call is cheap.
  const envOverride = mergeAgentEnv(
    buildClaudeEnvOverride(getCliSpec("claude", process.env)),
    opts.agentEnv,
  )

  // Build agentApp — mirrors in-process-host.ts but connects to stream instead of clientApp.
  // All ext handlers (_drive/*) are registered here.
  let agentApp = agent({ name: "drive-coding-inprocess-stream" })
    .onConnect((conn) => {
      claudeAgent = new ClaudeAcpAgent(makeAcpClientFromCtx(conn.client))
    })
    .onRequest(methods.agent.initialize, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before initialize")
      return claudeAgent.initialize(ctx.params)
    })
    .onRequest(methods.agent.session.new, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before session/new")
      // modelOverride: inject into _meta.claudeCode.options.model if provided (brief §3).
      // envOverride: inject into _meta.claudeCode.options.env for unset/set env shaping.
      // systemPrompt: inject into _meta.systemPrompt:{append} (slice project-system-prompt).
      // All three compose additively (no overwrite) — see injectSystemPrompt doc comment.
      // Cast: all functions return Record<string,unknown> with additive _meta only.
      const withModel = injectModelOverride(ctx.params, opts.modelOverride)
      const withEnv = injectEnvOverride(withModel, envOverride)
      const params = injectSystemPrompt(withEnv, opts.systemPrompt) as NewSessionRequest
      return claudeAgent.newSession(params)
    })
    .onRequest(methods.agent.session.prompt, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before session/prompt")
      return claudeAgent.prompt(ctx.params)
    })
    .onRequest(methods.agent.session.load, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before session/load")
      return claudeAgent.loadSession(injectEnvOverride(ctx.params, envOverride))
    })
    .onRequest(methods.agent.session.setConfigOption, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before session/set_config_option")
      return claudeAgent.setSessionConfigOption(ctx.params)
    })
    .onNotification(methods.agent.session.cancel, (ctx) => {
      if (!claudeAgent) return
      claudeAgent.cancel(ctx.params)
    })
    .onRequest(methods.agent.session.fork, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before session/fork")
      return claudeAgent.unstable_forkSession(injectEnvOverride(ctx.params, envOverride))
    })
    .onRequest(methods.agent.session.list, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before session/list")
      return claudeAgent.listSessions(ctx.params)
    })
    .onRequest(methods.agent.session.delete, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before session/delete")
      return claudeAgent.deleteSession(ctx.params)
    })
    .onRequest(methods.agent.session.resume, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before session/resume")
      return claudeAgent.resumeSession(injectEnvOverride(ctx.params, envOverride))
    })
    .onRequest(methods.agent.session.close, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before session/close")
      return claudeAgent.closeSession(ctx.params)
    })
    .onRequest(methods.agent.session.setMode, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before session/set_mode")
      return claudeAgent.setSessionMode(ctx.params)
    })
    .onRequest(methods.agent.authenticate, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before authenticate")
      return claudeAgent.authenticate(ctx.params)
    })

  // Register _drive/setThinkingTokens ext handler (mirrors in-process-host.ts:193-212).
  agentApp = agentApp.onRequest(
    "_drive/setThinkingTokens",
    { parse: (p: unknown) => p as Record<string, unknown> },
    async (ctx) => {
      if (!claudeAgent) throw new Error("_drive/setThinkingTokens called before start()")
      let parsed: ReturnType<typeof parseExtParams<"_drive/setThinkingTokens">>
      try {
        parsed = parseExtParams("_drive/setThinkingTokens", ctx.params)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        throw RequestError.invalidParams({}, msg)
      }
      const { sessionId, n } = parsed
      await getQuery(claudeAgent, sessionId).setMaxThinkingTokens(n)
      return { ok: true }
    },
  )

  // Register _drive/getQuota ext handler (slice session-budget-meter Commit 3).
  // Wiring-only per brief §2 "חריג wiring בלבד" — handler prepared entirely inside
  // providers/claude/quota-handler.ts; no quota SDK symbols/response fields/mapping
  // here. Same handler factory as in-process-host.ts (no duplicate normalizer).
  const getQuotaHandler = createClaudeQuotaHandler(() => claudeAgent)
  agentApp = agentApp.onRequest(
    "_drive/getQuota",
    { parse: (p: unknown) => p as Record<string, unknown> },
    (ctx) => getQuotaHandler(ctx.params),
  )

  // Connect agentApp to stream bridge (Model 2).
  // agentApp.connect(stream) fires onConnect synchronously → claudeAgent is set.
  // Returns AgentConnection (we keep it for close()).
  const agentConn = agentApp.connect(bridge.agentEnd)

  // Suppress unhandledRejection from agentConn.closed — it rejects when the stream
  // closes (expected behavior; we handle it in our own close() method).
  agentConn.closed.catch(() => {
    /* expected: stream closed */
  })

  // Wire tap: subscribe to outbound (agent→FE) lines via wireEnd.onLine.
  bridge.wireEnd.onLine((line) => {
    handleLine("in", line)
  })

  // Build the wire interface with tap on write (FE→agent direction).
  const wire: ProviderConnection["wire"] = {
    onLine(cb: (line: string) => void): () => void {
      return bridge.wireEnd.onLine(cb)
    },
    write(line: string): boolean {
      // Tap FE→agent direction for onFrame (dir="out").
      handleLine("out", line)
      return bridge.wireEnd.write(line)
    },
  }

  // caps: mapClaudeCapabilities(null) — static baseline for claude in-process.
  // initResult is not captured here; the FE sends initialize over the wire.
  // mapClaudeCapabilities(null) returns: mcp=false, rename=true, thinkingTokens=true, image=false.
  // Note: mcp stays false until we tap the initialize response (future improvement).
  // Per brief §3: "BE-side, mapClaudeCapabilities — already includes rename/thinkingTokens".
  // mutable — slice reattach-state-sync Commit 1: the init-frame tap (handleLine, dir="in")
  // updates `image` in place once it observes a real initialize response.
  let caps = mapClaudeCapabilities(null)

  const connection: ProviderConnection = {
    wire,
    get capabilities(): NormalizedCapabilities {
      return caps
    },

    onFrame(cb: (f: WireFrame) => void): () => void {
      frameListeners.add(cb)
      return () => {
        frameListeners.delete(cb)
      }
    },

    turn: {
      isBusy(): boolean {
        return tracker.isBusy(Date.now())
      },
      lastActivityAt(): number | null {
        return tracker.getLastActivityAt()
      },
      onChange(cb: (busy: boolean) => void): () => void {
        changeListeners.add(cb)
        return () => {
          changeListeners.delete(cb)
        }
      },
    },

    onCrash(cb: (info: import("../spawn/index.js").BridgeCrashInfo) => void): () => void {
      crashListeners.add(cb)
      return () => {
        crashListeners.delete(cb)
      }
    },

    async close(): Promise<void> {
      // #5 — סיים את כל ה-SDK sessions → query.close() מסיים את ה-claude subprocess.
      // בלי זה ה-child דולף (be-shutdown kill-tree לא מכסה in-process). dispose אידמפוטנטי
      // ובטוח על 0 sessions (Promise.all([])). timeout-guard: turn תקוע לא יתקע את close לנצח.
      // נקרא רק כאן — מ-close() המפורש — ולא מ-.catch של agentConn/bridge (נתיב-C3 נשאר log-only).
      if (claudeAgent) {
        await withTimeout(claudeAgent.dispose(), DISPOSE_TIMEOUT_MS).catch((err) => {
          // dispose נכשל/נתקע — ממשיכים לסגור bridge; ה-subprocess ייתפס ע"י
          // graceful-shutdown/kill-tree של ה-BE כרשת-בטחון. לא זורקים החוצה.
          log.warn({ err }, "claudeAgent.dispose() failed/timed-out during close — continuing")
        })
      }
      // Close the stream bridge first to terminate the underlying stream.
      // The agentConn will detect the stream closure and close itself.
      // We do NOT call agentConn.close() explicitly — it would create a double-close
      // which triggers unhandled rejections from the SDK's pending reader cancellations.
      bridge.close()
      // Wait for agentConn to finish closing (aborts pending requests).
      // agentConn.closed always resolves (never rejects — signal.addEventListener → resolve).
      await agentConn.closed.catch(() => {
        /* ignore any unexpected rejection */
      })
      frameListeners.clear()
      changeListeners.clear()
      crashListeners.clear()
    },

    ext: undefined,

    // pid: null — in-process, no child process.
    // Per brief §3: "claude child תחת ה-SDK — חשוף אם נגיש; אחרת null + תעד."
    // In-process mode has no child process; ClaudeAcpAgent manages sessions in-memory.
    get pid(): null {
      return null
    },
  }

  return connection
}
