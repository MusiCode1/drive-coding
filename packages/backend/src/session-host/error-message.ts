/** אותה קדימות כמו formatAcpError ב-FE: data.details → data.message → message → String(e). */
export function msgOf(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { message?: unknown; data?: unknown }
    if (e.data && typeof e.data === "object") {
      const data = e.data as { details?: unknown; message?: unknown }
      if (typeof data.details === "string" && data.details.length > 0) return data.details
      if (typeof data.message === "string" && data.message.length > 0) return data.message
    }
    if (typeof e.message === "string" && e.message.length > 0) return e.message
  }
  return String(err)
}
