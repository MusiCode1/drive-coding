import type { CliKind } from "@drive-coding/core"

/** מזהה ID של mode עקיפת-הרשאות, פר-ספק.
 * ⚠️ claude בלבד כרגע. כשיושלם תכנון מנגנון-ה-ACP המאוחד (roadmap Track C
 * "ממשק אישור-בקשות") — נאחד את זיהוי-המצבים לכל הספקים שבדקנו (opencode/codex)
 * במקום אחד. עד אז: ספק שאינו claude → isBypassMode=false → אזהרה תמיד. */
const BYPASS_MODE_ID: Partial<Record<CliKind, string>> = {
  claude: "bypassPermissions",
}

export function isBypassMode(
  cliKind: string | null,
  currentModeId: string | null | undefined,
): boolean {
  if (!cliKind || !currentModeId) return false
  // open-cli-registry-fe: cliKind התרחב ל-string (יכול להיות CLI מהקונפ' שלא ב-CliKind).
  // BYPASS_MODE_ID נשאר מוקלד CliKind בכוונה (בדיקת-שמות) — הצרה מקומית ל-lookup.
  if (!(cliKind in BYPASS_MODE_ID)) return false
  return BYPASS_MODE_ID[cliKind as CliKind] === currentModeId
}
