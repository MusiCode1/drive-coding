// @vitest-environment jsdom
/**
 * notify.svelte.test.ts — unit tests for NotifyEngine
 *
 * #show is async (Promise.race + showNotification). Stub serviceWorker.ready to
 * resolve immediately; use vi.waitFor after notify* calls.
 *
 * slice: notify-local
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NotifyEngine } from "./notify.svelte"

function setDocumentHidden(hidden: boolean) {
	Object.defineProperty(document, "hidden", {
		configurable: true,
		get: () => hidden,
	})
}

let ctorCalls: unknown[][]

function setupNotificationMocks(opts?: { permission?: NotificationPermission }) {
	const showNotification = vi.fn(async () => {})
	const permission = opts?.permission ?? "granted"
	ctorCalls = []

	vi.stubGlobal(
		"Notification",
		class MockNotification {
			static permission = permission
			static requestPermission = vi.fn(async () => permission)
			constructor(...args: unknown[]) {
				ctorCalls.push(args)
			}
		},
	)

	vi.stubGlobal("navigator", {
		serviceWorker: {
			ready: Promise.resolve({ showNotification }),
		},
	})

	return { showNotification }
}

beforeEach(() => {
	setDocumentHidden(false)
	ctorCalls = []
})

afterEach(() => {
	vi.unstubAllGlobals()
	setDocumentHidden(false)
})

describe("NotifyEngine.notifyTurn", () => {
	it("non-idle→idle when hidden + granted + enabled → showNotification once with tag turn-end", async () => {
		const { showNotification } = setupNotificationMocks()
		setDocumentHidden(true)
		const engine = new NotifyEngine({
			text: () => ({ title: "T", body: "B" }),
		})
		engine.setEnabled(true)

		engine.notifyTurn("responding")
		engine.notifyTurn("idle")

		await vi.waitFor(() => expect(showNotification).toHaveBeenCalledTimes(1))
		expect(showNotification).toHaveBeenCalledWith("T", {
			body: "B",
			tag: "turn-end",
			data: { url: "/chat" },
		})
		engine.dispose()
	})

	it("non-idle→idle when page visible → showNotification not called", async () => {
		const { showNotification } = setupNotificationMocks()
		setDocumentHidden(false)
		const engine = new NotifyEngine({
			text: () => ({ title: "T", body: "B" }),
		})
		engine.setEnabled(true)

		engine.notifyTurn("responding")
		engine.notifyTurn("idle")

		await Promise.resolve()
		expect(showNotification).not.toHaveBeenCalled()
		engine.dispose()
	})

	it("non-idle→idle when disabled → showNotification not called", async () => {
		const { showNotification } = setupNotificationMocks()
		setDocumentHidden(true)
		const engine = new NotifyEngine({
			text: () => ({ title: "T", body: "B" }),
		})
		engine.setEnabled(false)

		engine.notifyTurn("responding")
		engine.notifyTurn("idle")

		await Promise.resolve()
		expect(showNotification).not.toHaveBeenCalled()
		engine.dispose()
	})

	it("non-idle→idle when permission denied → showNotification not called", async () => {
		const { showNotification } = setupNotificationMocks({ permission: "denied" })
		setDocumentHidden(true)
		const engine = new NotifyEngine({
			text: () => ({ title: "T", body: "B" }),
		})
		engine.setEnabled(true)

		engine.notifyTurn("responding")
		engine.notifyTurn("idle")

		await Promise.resolve()
		expect(showNotification).not.toHaveBeenCalled()
		engine.dispose()
	})

	it("idle→idle → showNotification not called", async () => {
		const { showNotification } = setupNotificationMocks()
		setDocumentHidden(true)
		const engine = new NotifyEngine({
			text: () => ({ title: "T", body: "B" }),
		})
		engine.setEnabled(true)

		engine.notifyTurn("idle")

		await Promise.resolve()
		expect(showNotification).not.toHaveBeenCalled()
		engine.dispose()
	})
})

describe("NotifyEngine.notifyPermissionPending", () => {
	it("true twice in a row → showNotification called once", async () => {
		const { showNotification } = setupNotificationMocks()
		setDocumentHidden(true)
		const engine = new NotifyEngine({
			text: (kind) => ({ title: kind, body: kind }),
		})
		engine.setEnabled(true)

		engine.notifyPermissionPending(true)
		engine.notifyPermissionPending(true)

		await vi.waitFor(() => expect(showNotification).toHaveBeenCalledTimes(1))
		expect(showNotification).toHaveBeenCalledWith("permission-request", {
			body: "permission-request",
			tag: "permission-request",
			data: { url: "/chat" },
		})
		engine.dispose()
	})

	it("true→false→true → showNotification called twice", async () => {
		const { showNotification } = setupNotificationMocks()
		setDocumentHidden(true)
		const engine = new NotifyEngine({
			text: () => ({ title: "T", body: "B" }),
		})
		engine.setEnabled(true)

		engine.notifyPermissionPending(true)
		engine.notifyPermissionPending(false)
		engine.notifyPermissionPending(true)

		await vi.waitFor(() => expect(showNotification).toHaveBeenCalledTimes(2))
		engine.dispose()
	})
})

describe("NotifyEngine permission", () => {
	it("navigator without serviceWorker → unsupported; requestPermission returns unsupported", async () => {
		vi.stubGlobal(
			"Notification",
			class {
				static permission = "default"
			},
		)
		vi.stubGlobal("navigator", {})

		const engine = new NotifyEngine({ text: () => ({ title: "T", body: "B" }) })
		expect(engine.permission).toBe("unsupported")
		expect(await engine.requestPermission()).toBe("unsupported")
		engine.dispose()
	})

	it("new Notification constructor is never called", async () => {
		const { showNotification } = setupNotificationMocks()
		setDocumentHidden(true)
		const engine = new NotifyEngine({
			text: () => ({ title: "T", body: "B" }),
		})
		engine.setEnabled(true)

		engine.notifyTurn("responding")
		engine.notifyTurn("idle")

		await vi.waitFor(() => expect(showNotification).toHaveBeenCalledTimes(1))
		expect(ctorCalls).toHaveLength(0)
		engine.dispose()
	})
})
