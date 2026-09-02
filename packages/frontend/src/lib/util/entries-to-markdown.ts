/** Renders plan entries as a GitHub-style markdown checklist. */
export function entriesToMarkdown(entries: readonly { content: string; status: string }[]): string {
  if (entries.length === 0) return ""
  return entries
    .map((entry) => {
      const box = entry.status === "completed" ? "x" : " "
      return `- [${box}] ${entry.content}`
    })
    .join("\n")
}
