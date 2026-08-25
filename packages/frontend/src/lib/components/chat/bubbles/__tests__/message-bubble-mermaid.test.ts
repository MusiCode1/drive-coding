// @vitest-environment jsdom
/**
 * message-bubble-mermaid.test.ts — DoD 6 (brief-msg-diagrams.md §5).
 *
 * 🔴 המשטח שעליו זה נמדד: MessageBubble.svelte — בועת ה*סוכן* (brief §1).
 * נכשל אם התרשים נבדק רק ב-UserBubble — הטסט הזה מרכיב MessageBubble בשמו,
 * ו-UserBubble אינו מופיע כאן בכלל.
 *
 * mermaid לא מרנדר ב-jsdom (getBBox חסר — §11-ג), ו-MarkdownContent לא חושף
 * פרמטר `render` להזרקה (זה יהיה scope-creep על ה-API הציבורי של הרכיב
 * המשותף). לכן הטסט נבדק על ה-state הסינכרוני "pending" — בדיוק מה ש-brief
 * §4 Commit 1 סעיף 5 אומר במפורש: "pending נקבע סינכרונית, לפני ה-await.
 * זה מה ש-DoD 6 נתלה בו." הרינדור החי (ready, בדפדפן אמיתי) מאומת ע"י כלב
 * (DoD 7), לא כאן.
 *
 * ⚠️ ממצא-ריצה שנתפס תוך-כדי כתיבת הטסט (לא היה מתועד באף מקום בריפו):
 * תחת `mount()` (לא ה-flow הרגיל של SvelteKit hydration), `use:`-actions
 * *אינן* רצות סינכרונית מיד עם mount() — יש effect-flush נדחה. `flushSync()`
 * (מ-"svelte") מכריח את ה-effects (כולל actions) לרוץ מיד. בלעדיו,
 * querySelector("[data-mermaid-state]") מיד אחרי mount() מחזיר null —
 * לא כי הקישוט לא קרה, אלא כי הוא עוד לא רץ.
 */
import { flushSync, mount, unmount } from "svelte"
import { afterEach, describe, expect, it } from "vitest"
import type { MessageBubble as MessageBubbleType } from "$lib/types/bubble"
import MessageBubbleHarness from "./message-bubble-harness.svelte"

let target: HTMLDivElement | null = null
let app: object | null = null

afterEach(() => {
  if (app !== null) unmount(app)
  target?.remove()
  target = null
  app = null
})

function makeMermaidBubble(): MessageBubbleType {
  return {
    id: "b-mermaid",
    kind: "message",
    messageId: "m1",
    createdAt: Date.now(),
    segments: [
      {
        id: "s1",
        text: "הנה תרשים:\n\n```mermaid\nflowchart TD\n  A[Start] --> B{OK?}\n```\n",
      },
    ],
  }
}

describe("MessageBubble — DoD 6: mermaid נראה בבועת הסוכן", () => {
  it("מרכיב MessageBubble אמיתי ומאמת [data-mermaid-state] ב-DOM", () => {
    target = document.createElement("div")
    document.body.appendChild(target)

    app = mount(MessageBubbleHarness, {
      target,
      props: { bubble: makeMermaidBubble() },
    })
    // מכריח את ה-use:-actions (כולל enhanceMermaid) לרוץ — ר' הערה למעלה.
    flushSync()

    // renderMarkdown עדיין מחזיר <pre><code class="language-mermaid"> (§3-א) —
    // enhanceMermaid (use: action) מסמן "pending" סינכרונית, לפני שהיא בכלל
    // מנסה לייבא/להריץ mermaid.render (שנכשל בשקט ב-jsdom — §11-ג, לא כאן).
    const marked = target.querySelector<HTMLElement>("[data-mermaid-state]")
    expect(marked).not.toBeNull()
    expect(marked?.dataset["mermaidState"]).toBe("pending")

    // ודא שזה MessageBubble שמייצר את זה — לא UserBubble (brief §1 אזהרה מפורשת)
    expect(target.querySelector(".content-body")).not.toBeNull()
  })
})
