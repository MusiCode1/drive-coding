/**
 * notifications-store.svelte.ts — store גלובלי להודעות זמניות (toast-like).
 *
 * אין component גלובלי בשלב זה — כל route שרוצה להציג notifications קורא
 * ל-`notifications.list` ומציג אותן עם ה-pattern הקיים (`error-banner` inline).
 * בהמשך אפשר להוסיף component גלובלי ב-+layout.svelte בלי לשנות עוד קוד.
 *
 * השימוש הראשון (F-5): agent-recovery דוחף הודעה כש-cache miss או recovery נכשל,
 * ה-dashboard קורא ומציג אחרי ניווט.
 *
 * Lifecycle: in-memory בלבד. רענון דף → איבוד. זה acceptable כי ה-flow המקורי
 * (recovery → goto → display) הוא סינכרוני באותו tab.
 */

export type NotificationKind = "info" | "error"

export type Notification = {
  id: string
  kind: NotificationKind
  text: string
  createdAt: number
}

const items = $state<Notification[]>([])

function nextId(): string {
  // crypto.randomUUID() exists in modern browsers; fall back to timestamp for jsdom
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export const notifications = {
  /** Reactive list of pending notifications, oldest first. */
  get list(): readonly Notification[] {
    return items
  },

  /** Push a new notification. Returns its id for optional manual dismiss. */
  push(text: string, kind: NotificationKind = "info"): string {
    const n: Notification = { id: nextId(), kind, text, createdAt: Date.now() }
    items.push(n)
    return n.id
  },

  /** Remove a specific notification by id. No-op if missing. */
  dismiss(id: string): void {
    const idx = items.findIndex((n) => n.id === id)
    if (idx >= 0) items.splice(idx, 1)
  },

  /** Remove all notifications. Used on dashboard mount after rendering. */
  clear(): void {
    items.splice(0, items.length)
  },
}
