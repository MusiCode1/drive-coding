<script lang="ts">
/**
 * message-bubble-harness.svelte — קובץ-רתמה למונטאז' MessageBubble בטסטים.
 *
 * ─── slice/msg-diagrams (Commit 0ב) ───
 *
 * למה זה קיים: `MessageBubble` דורש חמישה קונטקסטים (`getI18n`, `getSession`,
 * `getSpeaker`, `getBubblePlayer`, `getContentViewer`) שנקבעים ב-`+layout.svelte`
 * (composition root). אין תקדים בריפו להרכבת רכיב-Svelte אמיתי בטסט (brief
 * §4 Commit 0ב, אביגיל ממצא 3) — הרתמה הזו היא ה-precedent הראשון.
 *
 * מפתחות ה-context אינם מיוצאים כ-constructors ציבוריים לשימוש-חופשי, אז
 * הרתמה עוטפת עם stubs מינימליים (לא mock של מודול) — רק השדות ש-MessageBubble
 * בפועל קורא: `t`, `cwd`, `speaker.enabled`, `bubblePlayer.playingBubbleId`+`toggle`,
 * `viewer.show`.
 *
 * ⚠️ **שישי, לא חמישי**: `MessageBubble` מרכיב `MarkdownContent`, וזו קוראת
 * גם ל-`getSettings()` (`settings.autoLoadRemoteImages` ל-enhanceRemoteImages)
 * — קונטקסט טרנזיטיבי שהבריף לא מנה במפורש (§4 Commit 0ב מונה 5). בלעדיו:
 * `missing_context` על `getSettings`, לא על אחד מהחמישה שכן חוטו — נמצא ותוקן
 * כאן; נמדד ע"י message-bubble-harness.test.ts.
 *
 * שימוש: `mount(MessageBubbleHarness, { target, props: { bubble } })`.
 */

import {
  setBubblePlayer,
  setContentViewer,
  setI18n,
  setSession,
  setSettings,
  setSpeaker,
} from "$lib/context"
import type { MessageBubble as MessageBubbleType } from "$lib/types/bubble"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { BubblePlayer } from "$lib/view-models/bubble-player.svelte"
import type { ContentViewerVM, ViewerPayload } from "$lib/view-models/content-viewer.svelte"
import type { I18nVM } from "$lib/view-models/i18n.svelte"
import type { Settings } from "$lib/view-models/settings.svelte"
import type { Speaker } from "$lib/view-models/speaker.svelte"
import MessageBubble from "../MessageBubble.svelte"

let {
  bubble,
  onViewerShow,
}: {
  bubble: MessageBubbleType
  /** נקרא אם onclick על כפתור ה-expand (bubble-meta) נלחץ. לא חובה לשימוש. */
  onViewerShow?: (payload: ViewerPayload) => void
} = $props()

// stub — t(key) מזהה (identity); מספיק ל-aria-label/title, לא נבדק בתוכן
const fakeI18n = { t: (key: string) => key } as unknown as I18nVM

// stub — cwd null; MessageBubble מעביר אותו הלאה ל-MarkdownContent/fileLinks
const fakeSession = { cwd: null } as unknown as AgentSession

// stub — speaker מושתק כברירת-מחדל (מסתיר כפתור play, לא רלוונטי לטסט)
const fakeSpeaker = { enabled: false } as unknown as Speaker

const fakeBubblePlayer = {
  playingBubbleId: null,
  toggle: () => {},
} as unknown as BubblePlayer

const fakeViewer = {
  payload: null,
  open: false,
  show: (payload: ViewerPayload) => onViewerShow?.(payload),
  close: () => {},
} as unknown as ContentViewerVM

// stub — קונטקסט טרנזיטיבי דרך MarkdownContent (ר' הערה למעלה)
const fakeSettings = { autoLoadRemoteImages: false } as unknown as Settings

setI18n(fakeI18n)
setSession(fakeSession)
setSpeaker(fakeSpeaker)
setBubblePlayer(fakeBubblePlayer)
setContentViewer(fakeViewer)
setSettings(fakeSettings)
</script>

<MessageBubble {bubble} />
