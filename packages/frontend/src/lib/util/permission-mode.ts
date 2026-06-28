import type { CliKind } from "@drive-coding/core"

/** מזהה ID של mode עקיפת-הרשאות, פר-ספק.
 * ⚠️ claude בלבד כרגע. כשיושלם תכנון מנגנון-ה-ACP המאוחד (roadmap Track C
 * "ממשק אישור-בקשות") — נאחד את זיהוי-המצבים לכל הספקים שבדקנו (opencode/codex)
 * במקום אחד. עד אז: ספק שאינו claude → isBypassMode=false → אזהרה תמיד. */
const BYPASS_MODE_ID: Partial<Record<CliKind, string>> = {
  claude: "bypassPermissions",
}

export function isBypassMode(
  cliKind: CliKind | null,
  currentModeId: string | null | undefined,
): boolean {
  if (!cliKind || !currentModeId) return false
  return BYPASS_MODE_ID[cliKind] === currentModeId
}
