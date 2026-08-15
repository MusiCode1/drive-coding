/**
 * session-options-panel.systemprompt-warning.test.svelte.ts
 *
 * DoD #9 — טסט רכיב אמיתי עם assertion על ה-HTML לשלושת המצבים:
 *   1. capabilities === null  → אין אזהרה (יכולות טרם הגיעו)
 *   2. capabilities.systemPrompt === true  → אין אזהרה
 *   3. capabilities.systemPrompt === false → יש אזהרה
 *
 * מייצג בדיוק את הלוגיקה של SessionOptionsPanel.svelte:486-488:
 *   {#if session.capabilities !== null && !session.capabilities.systemPrompt}
 *
 * משתמש ב-svelte/server render (SSR) כדי לבדוק HTML output ישירות —
 * מתאים ל-environment:"node" של vitest.config.ts ואינו דורש jsdom.
 */

import type { NormalizedCapabilities } from "@drive-coding/provider/types"
import { render } from "svelte/server"
import { describe, expect, it } from "vitest"
import SystemPromptWarning from "./SystemPromptWarning.test.svelte"

function makeCapabilities(overrides: Partial<NormalizedCapabilities>): NormalizedCapabilities {
  return {
    mcp: false,
    compact: false,
    commands: false,
    usage: false,
    configOptions: false,
    rename: false,
    thinkingTokens: false,
    image: false,
    systemPrompt: false,
    ...overrides,
  }
}

function renderHtml(capabilities: NormalizedCapabilities | null): string {
  return render(SystemPromptWarning, { props: { capabilities } }).body
}

describe("SessionOptionsPanel — systemPrompt warning (DoD #9)", () => {
  it("מצב 1: capabilities=null (יכולות טרם הגיעו) — אין אזהרה", () => {
    const html = renderHtml(null)
    expect(html).not.toContain('data-testid="sp-warning"')
  })

  it("מצב 2: capabilities.systemPrompt=true (נתמך) — אין אזהרה", () => {
    const html = renderHtml(makeCapabilities({ systemPrompt: true }))
    expect(html).not.toContain('data-testid="sp-warning"')
  })

  it("מצב 3: capabilities.systemPrompt=false (לא נתמך) — יש אזהרה", () => {
    const html = renderHtml(makeCapabilities({ systemPrompt: false }))
    expect(html).toContain('data-testid="sp-warning"')
    expect(html).toContain("does not support")
  })
})
