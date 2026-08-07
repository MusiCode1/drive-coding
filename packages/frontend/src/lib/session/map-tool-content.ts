/**
 * map-tool-content.ts — פונקציות מיפוי raw ACP content ל-FE types.
 *
 * חולצו מ-#mapToolContent / #mapLocations ב-agent-session.svelte.ts.
 * שתיהן טהורות, 0 שימוש ב-`this` — מאפשרות שימוש גם ב-applyPatchMutable.
 *
 * ─── slice session-state-reducer C3 ───
 */
import type { ToolContent, ToolLocation } from "$lib/types/bubble"

/**
 * mapToolContent — ממפה raw content מ-ACP ל-ToolContent[].
 * חולץ מ-#mapToolContent ב-agent-session.svelte.ts — לוגיקה זהה, 0 שינוי.
 */
export function mapToolContent(raw: unknown): ToolContent[] {
  if (!Array.isArray(raw)) return []
  const out: ToolContent[] = []
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue
    const t = (item as { type?: string }).type
    if (t === "content") {
      // { type:"content", content: ContentBlock }
      const cb = (item as { content?: { type?: string; text?: string } }).content
      if (cb?.type === "text" && typeof cb.text === "string") {
        out.push({ type: "text", text: cb.text })
      } else if (
        // chat-render-polish: ACP ImageContent — { type:"image", data:base64, mimeType }
        cb?.type === "image" &&
        typeof (cb as { data?: unknown }).data === "string" &&
        typeof (cb as { mimeType?: unknown }).mimeType === "string" &&
        (cb as { mimeType: string }).mimeType.startsWith("image/")
      ) {
        const img = cb as { data: string; mimeType: string }
        out.push({ type: "image", data: img.data, mimeType: img.mimeType })
      } else if (cb?.type === "resource") {
        // chat-render-polish: EmbeddedResource { resource: { blob, mimeType, uri } } — רק blob עם image/*
        const r = (cb as { resource?: { blob?: unknown; mimeType?: unknown } }).resource
        if (
          typeof r?.blob === "string" &&
          typeof r.mimeType === "string" &&
          r.mimeType.startsWith("image/")
        ) {
          out.push({ type: "image", data: r.blob, mimeType: r.mimeType })
        } else {
          out.push({ type: "other", raw: item })
        }
      } else {
        out.push({ type: "other", raw: item })
      }
    } else if (t === "diff") {
      const d = item as { path?: string; oldText?: string | null; newText?: string }
      if (typeof d.path === "string" && typeof d.newText === "string") {
        out.push({
          type: "diff",
          path: d.path,
          oldText: d.oldText ?? undefined,
          newText: d.newText,
        })
      } else {
        out.push({ type: "other", raw: item })
      }
    } else if (t === "terminal") {
      const term = item as { terminalId?: string }
      if (typeof term.terminalId === "string") {
        out.push({ type: "terminal", terminalId: term.terminalId })
      } else {
        out.push({ type: "other", raw: item })
      }
    } else {
      out.push({ type: "other", raw: item })
    }
  }
  return out
}

/**
 * mapLocations — ממפה raw locations מ-ACP ל-ToolLocation[].
 * חולץ מ-#mapLocations ב-agent-session.svelte.ts — לוגיקה זהה, 0 שינוי.
 */
export function mapLocations(raw: unknown): ToolLocation[] {
  if (!Array.isArray(raw)) return []
  const out: ToolLocation[] = []
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue
    const l = item as { path?: string; line?: number }
    if (typeof l.path === "string") {
      out.push({ path: l.path, line: l.line })
    }
  }
  return out
}
