import type { Bubble, MessageBubble, UserBubble } from "$lib/types/bubble"
import { safeUUID } from "$lib/util/uuid"

type BubbleAppendVm = {
  bubbles: Bubble[]
}

/**
 * §11: מצרף image-attachment לבועת-user — קיבוץ לפי messageId כמו #appendChunk.
 *
 * הערה על reactivity: #appendChunk משתמש ב-segments.push() — עובד כי segments[]
 * הוא deep $state proxy ב-Svelte 5. attachments מתחיל undefined (optional ב-UserBubble),
 * לכן .push() על undefined יקרוס. לכן כאן **השמה** (`[..., a]`) — פותרת גם את
 * ה-undefined-init וגם מבטיחה reactivity על מערך שנוסף מאפס.
 */
export function appendUserImage(
  vm: BubbleAppendVm,
  messageId: string | null,
  img: { mimeType: string; data: string },
): void {
  const last = vm.bubbles[vm.bubbles.length - 1]
  const canGroup =
    last !== undefined &&
    last.kind === "user" &&
    (messageId !== null ? last.messageId === messageId : last.messageId === null)

  const attachment = { mimeType: img.mimeType, dataBase64: img.data }

  if (canGroup && last !== undefined) {
    const userBubble = last as UserBubble
    // השמה (לא push) כי attachments מתחיל undefined — ר' הערה מעל
    userBubble.attachments = [...(userBubble.attachments ?? []), attachment]
  } else {
    const newBubble: UserBubble = {
      id: safeUUID(),
      kind: "user",
      messageId,
      createdAt: Date.now(),
      segments: [],
      attachments: [attachment],
    }
    vm.bubbles.push(newBubble)
  }
}

/**
 * §11.3א: מצרף placeholder מבני לבועת-user עבור ContentBlocks לא-טקסטואליים (resource_link / audio / resource).
 *
 * אותה לוגיקת קיבוץ כמו #appendUserImage — grouping לפי messageId.
 * contentPlaceholders מתחיל undefined → **השמה** (לא push), כמו attachments.
 * ה-VM לא מייבא t ולא כותב שום מחרוזת-תצוגה או מפתח i18n — i18n שייך לשכבת-הרכיב.
 */
export function appendUserPlaceholder(
  vm: BubbleAppendVm,
  messageId: string | null,
  ph: { kind: "resource_link" | "audio" | "resource"; label?: string; uri?: string },
): void {
  const last = vm.bubbles[vm.bubbles.length - 1]
  const canGroup =
    last !== undefined &&
    last.kind === "user" &&
    (messageId !== null ? last.messageId === messageId : last.messageId === null)

  if (canGroup && last !== undefined) {
    const userBubble = last as UserBubble
    // השמה (לא push) כי contentPlaceholders מתחיל undefined — ר' הערה ב-#appendUserImage
    userBubble.contentPlaceholders = [...(userBubble.contentPlaceholders ?? []), ph]
  } else {
    const newBubble: UserBubble = {
      id: safeUUID(),
      kind: "user",
      messageId,
      createdAt: Date.now(),
      segments: [],
      contentPlaceholders: [ph],
    }
    vm.bubbles.push(newBubble)
  }
}

/**
 * tool-render-fidelity: placeholder for non-text agent_message_chunk (§11.3א pattern).
 * i18n belongs to MessageBubble — VM stores structural marker only.
 */
export function appendAgentPlaceholder(
  vm: BubbleAppendVm,
  messageId: string | null,
  ph: {
    kind: "resource_link" | "audio" | "resource" | "image"
    label?: string
    uri?: string
  },
): void {
  const last = vm.bubbles[vm.bubbles.length - 1]
  const canGroup =
    last !== undefined &&
    last.kind === "message" &&
    (messageId !== null ? last.messageId === messageId : last.messageId === null)

  if (canGroup && last !== undefined) {
    const msgBubble = last as MessageBubble
    msgBubble.contentPlaceholders = [...(msgBubble.contentPlaceholders ?? []), ph]
  } else {
    const newBubble: MessageBubble = {
      id: safeUUID(),
      kind: "message",
      messageId,
      createdAt: Date.now(),
      segments: [],
      contentPlaceholders: [ph],
    }
    vm.bubbles.push(newBubble)
  }
}
