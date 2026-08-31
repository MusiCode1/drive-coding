/**
 * NotifyEngine — OS notifications via ServiceWorkerRegistration.showNotification.
 *
 * Browser-only glue (engines/). Gated on enabled + granted permission + document.hidden.
 * slice notify-local
 */

/** Local copy of VM TurnState values. Do NOT import from view-models. */
export type NotifyTurnState = "idle" | "waiting" | "thinking" | "responding" | "calling-tool"
export type NotifyKind = "permission-request" | "elicitation" | "turn-end"
export type NotifyPermission = "unsupported" | "default" | "granted" | "denied"

export interface NotifyText {
	title: string
	body: string
}

export class NotifyEngine {
	permission = $state<NotifyPermission>("unsupported")

	#enabled = false
	#text: (kind: NotifyKind) => NotifyText
	#prevTurnState: NotifyTurnState = "idle"
	#prevPermissionPending = false
	#prevElicitationPending = false
	#disposed = false
	#permissionStatus: PermissionStatus | null = null
	#onPermissionChange: (() => void) | null = null

	constructor(opts: { text: (kind: NotifyKind) => NotifyText }) {
		this.#text = opts.text
		this.permission =
			typeof Notification === "undefined" ||
			typeof navigator === "undefined" ||
			!("serviceWorker" in navigator)
				? "unsupported"
				: (Notification.permission as NotifyPermission)
	}

	setEnabled(enabled: boolean): void {
		if (this.#disposed) return
		this.#enabled = enabled
	}

	async requestPermission(): Promise<NotifyPermission> {
		if (this.permission === "unsupported") return "unsupported"
		if (this.permission === "granted" || this.permission === "denied") {
			return this.permission
		}
		const result = await Notification.requestPermission()
		this.permission = result as NotifyPermission
		return this.permission
	}

	/** Subscribe to permission changes (Permissions API). No-op if unsupported. */
	watchPermission(): void {
		if (this.#disposed || this.permission === "unsupported") return
		if (this.#permissionStatus) return
		if (typeof navigator === "undefined" || !("permissions" in navigator)) return

		void navigator.permissions
			.query({ name: "notifications" as PermissionName })
			.then((status) => {
				if (this.#disposed || this.#permissionStatus) return
				this.#permissionStatus = status
				const handler = () => {
					if (this.#disposed) return
					this.refreshPermission()
				}
				this.#onPermissionChange = handler
				status.onchange = handler
			})
			.catch(() => {
				/* Permissions API unavailable — no-op */
			})
	}

	/** Refresh this.permission from Notification.permission (and stop quietly). */
	refreshPermission(): NotifyPermission {
		if (this.permission === "unsupported") return "unsupported"
		if (typeof Notification === "undefined") return this.permission
		this.permission = Notification.permission as NotifyPermission
		return this.permission
	}

	notifyTurn(ts: NotifyTurnState): void {
		if (this.#disposed) return
		const justFinished = this.#prevTurnState !== "idle" && ts === "idle"
		this.#prevTurnState = ts
		if (justFinished) void this.#show("turn-end")
	}

	notifyPermissionPending(pending: boolean): void {
		if (this.#disposed) return
		const rising = !this.#prevPermissionPending && pending
		this.#prevPermissionPending = pending
		if (rising) void this.#show("permission-request")
	}

	notifyElicitationPending(pending: boolean): void {
		if (this.#disposed) return
		const rising = !this.#prevElicitationPending && pending
		this.#prevElicitationPending = pending
		if (rising) void this.#show("elicitation")
	}

	dispose(): void {
		if (this.#disposed) return
		this.#disposed = true
		if (this.#permissionStatus && this.#onPermissionChange) {
			this.#permissionStatus.onchange = null
		}
		this.#permissionStatus = null
		this.#onPermissionChange = null
		this.setEnabled(false)
	}

	async #show(kind: NotifyKind): Promise<void> {
		if (!this.#enabled || this.permission !== "granted" || !document.hidden) return
		if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return

		const reg = await Promise.race([
			navigator.serviceWorker.ready,
			new Promise<undefined>((r) => setTimeout(() => r(undefined), 3000)),
		])
		if (!reg) return

		const { title, body } = this.#text(kind)
		await reg.showNotification(title, { body, tag: kind, data: { url: "/chat" } })
	}
}
