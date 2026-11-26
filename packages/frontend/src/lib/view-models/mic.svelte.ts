/** Device state for Record. Pending audio is scoped to the captured chat entry. */
import type { MessageKey } from "@drive-coding/core/i18n"
import type { CuesEngine } from "../engines/cues"
import {
  createRecordAttempt,
  RecordCaptureCoordinator,
  type RecordCaptureEntry,
  type RecordTarget,
  type RecordTargetSource,
} from "../engines/pending-capture-wiring"
import { Recorder } from "../engines/recorder"
import { probeMicPermission } from "../util/mic-permission"
import type { AgentSession } from "./agent-session.svelte"

export type MicState = "idle" | "requesting" | "recording" | "transcribing"

type ActiveAttempt = { entry?: RecordCaptureEntry }

export class Mic {
  state: MicState = $state("idle")
  permissionHint: MessageKey | null = $state(null)
  permissionDenied: boolean = $state(false)
  awaitingPermissionDialog: boolean = $state(false)
  hydrationRevision = $state(0)

  #captureError = $state.raw<{ target: RecordTarget; error: MessageKey } | null>(null)
  #pendingRevision = $state(0)
  readonly #pending = new RecordCaptureCoordinator(() => this.#pendingRevision++)
  readonly #recorder = new Recorder()
  #captureTarget: RecordTarget | null = null
  #active: ActiveAttempt | null = null

  constructor(
    private readonly opts: {
      session: Pick<AgentSession, "sendPrompt">
      targets: RecordTargetSource
      cues?: CuesEngine
      getInputDeviceId?: () => string | null
    },
  ) {
    void this.refreshPermissionHint()
  }

  #entry(target: RecordTarget | null): RecordCaptureEntry | undefined {
    // The coordinator owns the per-owner data. This dependency refreshes Svelte consumers.
    void this.#pendingRevision
    return target ? this.#pending.get(target.ownerKey) : undefined
  }

  get canRetry(): boolean {
    return this.state === "idle" && !!this.#entry(this.opts.targets.current())
  }

  get pendingRestored(): boolean {
    return this.#entry(this.opts.targets.current())?.restored ?? false
  }

  get error(): MessageKey | null {
    const failure = this.#captureError
    if (failure && this.opts.targets.isCurrent(failure.target)) return failure.error
    return this.#entry(this.opts.targets.current())?.capture.lastError ?? null
  }

  bindPendingActions() {
    const target = this.opts.targets.current()
    const entry = this.#entry(target)
    const failure = this.#captureError
    const isCurrent = () => target && this.opts.targets.isCurrent(target)
    return {
      onRetry: () => {
        if (!target || !isCurrent() || !entry || !this.#pending.has(entry)) return
        if (this.state !== "idle") return
        const operation = this.#beginAttempt(entry)
        return this.#pending
          .retry(entry, this.#attempt(target, operation))
          .finally(() => this.#finishAttempt(operation, target))
      },
      onDismiss: () => {
        if (!isCurrent() || (entry && !this.#pending.has(entry))) return
        if (this.#captureError === failure) this.#captureError = null
        if (!entry) return
        const removing = this.#pending.dismiss(entry)
        const operation = this.#active
        if (operation?.entry?.capture.id === entry.capture.id) this.#finishAttempt(operation)
        return removing
      },
    }
  }

  hydratePending(target: RecordTarget): Promise<void> {
    return this.#pending.hydrate(target.ownerKey, () => this.opts.targets.isCurrent(target))
  }

  refreshPermissionHint = async (): Promise<void> => {
    const state = await probeMicPermission()
    this.permissionHint = state === "prompt" ? "mic.hint.needsAllow" : null
    // "unknown" cannot erase a denial already reported by getUserMedia.
    if (state !== "unknown") this.permissionDenied = state === "denied"
  }

  toggle = async (): Promise<void> => {
    if (this.state === "idle") {
      const target = this.opts.targets.current()
      this.#captureTarget = target
      this.state = "requesting"
      this.#captureError = null
      this.awaitingPermissionDialog = this.permissionHint === "mic.hint.needsAllow"
      void probeMicPermission().then((perm) => {
        if (this.state !== "requesting") return
        this.awaitingPermissionDialog = perm === "prompt"
        this.permissionHint = perm === "prompt" ? "mic.hint.needsAllow" : null
      })
      try {
        await this.#recorder.start(this.opts.getInputDeviceId?.() ?? null)
      } catch (error) {
        this.state = "idle"
        this.awaitingPermissionDialog = false
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          this.permissionDenied = true
          this.permissionHint = null
        } else {
          const key =
            error instanceof DOMException && error.name === "NotFoundError"
              ? "mic.error.notFound"
              : "mic.error.generic"
          this.#showCaptureError(target, key)
        }
        void this.refreshPermissionHint()
        return
      }
      this.state = "recording"
      this.awaitingPermissionDialog = false
      this.permissionHint = null
      this.permissionDenied = false
      this.opts.cues?.play("recordingStart")
      return
    }

    if (this.state !== "recording") return
    const target = this.#captureTarget
    const operation = this.#beginAttempt()
    this.opts.cues?.play("recordingStop")
    try {
      const { blob, mimeType } = await this.#recorder.stop()
      const attempt = target && this.#attempt(target, operation)
      await this.#pending.process(target?.ownerKey ?? null, blob, mimeType, attempt)
    } catch (error) {
      console.warn("[mic] capture failed", error)
      this.#showCaptureError(target, "mic.error.generic")
    } finally {
      this.#finishAttempt(operation, target)
    }
  }

  cancel(): void {
    if (this.state === "recording") {
      void this.#recorder.stop().catch(() => {})
      this.state = "idle"
      this.#captureError = null
    }
    // A pending getUserMedia cannot be reliably aborted.
  }

  #showCaptureError(target: RecordTarget | null, error: MessageKey) {
    if (target && this.opts.targets.isCurrent(target)) this.#captureError = { target, error }
  }

  #beginAttempt(entry?: RecordCaptureEntry): ActiveAttempt {
    const operation = { entry }
    this.#active = operation
    this.#captureError = null
    this.state = "transcribing"
    return operation
  }

  #finishAttempt(operation: ActiveAttempt, target?: RecordTarget | null): void {
    if (this.#active !== operation) return
    this.#active = null
    this.state = "idle"
    if (target && !this.opts.targets.isCurrent(target)) {
      if (this.opts.targets.current()?.ownerKey === target.ownerKey) this.hydrationRevision++
    }
  }

  #attempt(target: RecordTarget, operation: ActiveAttempt) {
    return createRecordAttempt(target.backendBaseUrl, (text, recordingId) => {
      if (this.#active !== operation || !this.opts.targets.isCurrent(target)) return false
      void this.opts.session.sendPrompt(text, { recordingId })
      return true
    })
  }
}
