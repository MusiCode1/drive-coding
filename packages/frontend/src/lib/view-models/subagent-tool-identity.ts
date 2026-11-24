/** קריאת-כלי שהיא שיגור תת-סוכן (Agent/Task של Claude Code). */
export function isSubagentToolCall(
  kind: string | undefined,
  meta: Record<string, unknown> | undefined,
): boolean {
  const claudeCode = meta?.claudeCode
  if (typeof claudeCode === "object" && claudeCode !== null) {
    const toolName = (claudeCode as Record<string, unknown>).toolName
    if (typeof toolName === "string") {
      return toolName === "Agent" || toolName === "Task"
    }
  }
  return kind === "think"
}
