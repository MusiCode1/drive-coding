/**
 * presence-poller.svelte.ts — סקר presence בסשן (slice liveness C3+C4).
 *
 * POST /api/agents/:id/presence כל 12ש׳ כשבסשן+גלוי; שקט ברקע; מיידי בפוקוס;
 * לוקח בעלות מחדש דרך notifySessionAttached כש-attached=false.
 *
 * banner — state נפרד מ-session.error (לא נוגע ב-crashReason / openedElsewhere).
 */
import type { MachineStats } from "@drive-coding/core"
import {
  notifySessionAttached,
  type PresenceResponse,
  postPresence,
} from "$lib/adapters/agents-api"
import type { PresenceBanner } from "$lib/engines/disconnect-banner"
// slice sse-liveness Commit 4ב: PRESENCE_INTERVAL_MS/PRESENCE_BANNER_DELAY_MS
// רוכזו ל-liveness-thresholds.ts (מקום-אחד לכל ספי-החיוּת). מיוצאים-מחדש
// מכאן, לא נמחקו — 12 assertions ב-presence-poller.test.svelte.ts מייבאים
// אותם דרך הקובץ הזה.
import { PRESENCE_BANNER_DELAY_MS, PRESENCE_INTERVAL_MS } from "$lib/engines/liveness-thresholds"
import { beUrl } from "$lib/util/be-url"
import { diagnosedRefresh, isCloudflareChallenge } from "$lib/util/cloudflare-detect"
import { connInfo, connWarn } from "$lib/util/conn-log"
import {
  initPageVisibility,
  isPageHidden,
  onPageBecameVisible,
} from "$lib/util/page-visibility.svelte"
import type { AgentSession } from "./agent-session.svelte"

export { PRESENCE_BANNER_DELAY_MS, PRESENCE_INTERVAL_MS }

export type DisconnectBannerKind = PresenceBanner

export class PresencePoller {
  /** באנר ניתוק — נפרד מ-session.error (§C4, handover decision #2). */
  banner = $state<DisconnectBannerKind | null>(null)

  /** מדדי RAM/CPU מה-presence tick — slice machine-stats-in-session. */
  machine = $state<MachineStats | null>(null)

  readonly #session: AgentSession
  #intervalId: ReturnType<typeof setInterval> | null = null
  #bannerTimer: ReturnType<typeof setTimeout> | null = null
  #failureSince: number | null = null
  #cloudflare = false
  #inFlight = false
  #abort: AbortController | null = null
  #disposeVisibility: (() => void) | null = null
  #unsubVisible: (() => void) | null = null
  #activeAgentId: string | null = null
  #wasActive = false

  constructor(session: AgentSession) {
    this.#session = session
  }

  /** פעם אחת מ-+layout — מאזיני visibility/focus. */
  init(): void {
    if (this.#disposeVisibility) return
    this.#disposeVisibility = initPageVisibility()
    this.#unsubVisible = onPageBecameVisible(() => {
      if (this.#wasActive && this.#activeAgentId && !isPageHidden()) {
        void this.tick("focus")
      }
    })
  }

  dispose(): void {
    this.stop()
    this.#unsubVisible?.()
    this.#unsubVisible = null
    this.#disposeVisibility?.()
    this.#disposeVisibility = null
  }

  /** נקרא מ-$effect ב-layout לפי מצב סשן + נראות. */
  sync(opts: { inSession: boolean; agentId: string | null; hidden: boolean }): void {
    const active = opts.inSession && !!opts.agentId
    if (!active) {
      this.stop()
      this.#wasActive = false
      return
    }
    this.#activeAgentId = opts.agentId
    if (opts.hidden) {
      this.#stopInterval()
      this.#abortInFlight()
      return
    }

    this.#ensureInterval()
    if (!this.#wasActive) {
      void this.tick("initial")
    }
    this.#wasActive = true
  }

  stop(): void {
    this.#activeAgentId = null
    this.#wasActive = false
    this.#stopInterval()
    this.#abortInFlight()
    this.clearBanner()
  }

  onSseReconnected(): void {
    this.clearBanner()
  }

  clearBanner(): void {
    // רק על מעבר — clearBanner נקרא בכל tick מוצלח, ויומן בכל 12ש׳ הוא רעש.
    if (this.banner !== null) connInfo("banner-cleared", { was: this.banner })
    this.banner = null
    this.#failureSince = null
    this.#cloudflare = false
    if (this.#bannerTimer !== null) {
      clearTimeout(this.#bannerTimer)
      this.#bannerTimer = null
    }
  }

  async tick(reason: "interval" | "focus" | "initial"): Promise<void> {
    void reason
    if (isPageHidden()) return
    const agentId = this.#activeAgentId ?? this.#session.agentId
    if (!agentId) return
    // סבב-תיקונים liveness: טרנספורט שנפל הוא **אותו** מצב-ניתוק שהסקר נועד להציג.
    // קודם הייתה כאן `return` סתמית, ולכן הבאנר — שאמור להיות בעל-הבית של מצב
    // החיבור — דווקא **השתתק** ברגע שה-WS נפל, והמסך נשאר עם המחרוזת הגולמית.
    // ה-POST עצמו מדולג (אין למי לפנות), אבל מנגנון-ההשהיה זהה: 5 שניות של
    // חסד לפני שמטרידים את המשתמש, כדי שחזרה מהירה תעבור בשקט.
    if (this.#session.status !== "connected") {
      this.#handleFailure(new Error("transport disconnected"))
      return
    }
    if (this.#inFlight) return

    this.#inFlight = true
    this.#abort = new AbortController()
    try {
      const res = await postPresence(agentId, this.#abort.signal)
      // ⚠️ הסדר קריטי: `agent === null` נבדק **לפני** clearBanner. הפוך היה
      // מנקה את הבאנר ואז מציב אותו מחדש — הבהוב, ובחלון שביניהם "הכל תקין".
      if (res.agent === null || res.agent === undefined) {
        this.#handleGone()
        return
      }
      this.clearBanner()
      this.machine = res.machine
      await this.#maybeRetakeOwnership(agentId, res.agent)
    } catch (err) {
      this.#handleFailure(err)
    } finally {
      this.#inFlight = false
      this.#abort = null
    }
  }

  async refreshPage(): Promise<void> {
    await diagnosedRefresh(beUrl("/"))
  }

  #ensureInterval(): void {
    if (this.#intervalId !== null) return
    this.#intervalId = setInterval(() => {
      void this.tick("interval")
    }, PRESENCE_INTERVAL_MS)
  }

  #stopInterval(): void {
    if (this.#intervalId !== null) {
      clearInterval(this.#intervalId)
      this.#intervalId = null
    }
  }

  #abortInFlight(): void {
    this.#abort?.abort()
    this.#abort = null
    this.#inFlight = false
  }

  async #maybeRetakeOwnership(agentId: string, agent: PresenceResponse["agent"]): Promise<void> {
    if (agent === null || agent === undefined) return // סוכן שאיננו — אין על מה לתפוס בעלות
    if (agent.attached) return
    const sessionId = this.#session.sessionState.sessionId
    if (!sessionId) return
    await notifySessionAttached(agentId, sessionId, { replace: true }).catch(() => {})
  }

  /**
   * `POST /presence` על סוכן שאינו קיים מחזיר 200 `{ok:true, agent:null}`.
   * `agent === null` הוא סיגנל ודאי — סוכן שאיננו, לא תקלה חולפת.
   *
   * 🔴 אל תעצור את הסקר. `sync()` קורא ל-`#ensureInterval()` ללא תנאי, והעצירה
   * אינה מחזיקה. הגארד ב-`#applyBanner` הופך סקרים חוזרים ל-no-op על הבאנר.
   */
  #handleGone(): void {
    if (this.banner === "gone") return
    connWarn("presence-gone", { agentId: this.#activeAgentId })
    if (this.#bannerTimer !== null) {
      clearTimeout(this.#bannerTimer)
      this.#bannerTimer = null
    }
    this.#failureSince = null
    this.banner = "gone"
  }

  #handleFailure(err: unknown): void {
    const { cloudflare } = classifyPresenceError(err)
    if (cloudflare) this.#cloudflare = true

    const now = Date.now()
    if (this.#failureSince === null) {
      this.#failureSince = now
      if (this.#bannerTimer !== null) clearTimeout(this.#bannerTimer)
      this.#bannerTimer = setTimeout(() => {
        this.#bannerTimer = null
        if (this.#failureSince !== null) this.#applyBanner()
      }, PRESENCE_BANNER_DELAY_MS)
      return
    }

    if (now - this.#failureSince >= PRESENCE_BANNER_DELAY_MS) {
      this.#applyBanner()
    }
  }

  #applyBanner(): void {
    if (this.banner === "gone") return // מצב סופי — לא נדרס בהמתנה
    const next = this.#cloudflare ? "cloudflare" : "reconnecting"
    if (this.banner !== next) {
      connWarn("banner", {
        kind: next,
        sinceMs: this.#failureSince ? Date.now() - this.#failureSince : 0,
      })
    }
    this.banner = next
  }
}

/** @internal — לטסטים */
export function classifyPresenceError(err: unknown): { cloudflare: boolean } {
  const message = err instanceof Error ? err.message : String(err)
  const statusMatch = /postPresence failed: (\d+)/.exec(message)
  const status = statusMatch ? Number(statusMatch[1]) : null
  const bodyStart = message.indexOf(" ")
  const body = bodyStart >= 0 ? message.slice(bodyStart) : message
  const fakeRes =
    status !== null
      ? ({
          status,
          headers: { get: () => null },
        } as unknown as Response)
      : null
  return { cloudflare: isCloudflareChallenge(fakeRes, body) }
}
