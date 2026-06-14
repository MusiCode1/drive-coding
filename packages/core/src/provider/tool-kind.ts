import type { ToolKind } from "./events"

/**
 * ממפה ACP ToolKind (10 ערכים) → canonical ToolKind (7 ערכים).
 *
 * ACP kinds: read | edit | delete | move | execute | search | fetch | think | switch_mode | other
 * Canonical: read | edit | execute | search | fetch | think | other
 *
 * מיפוי:
 *   delete → edit  (מוטציית-קובץ; החלטה §9 #2)
 *   move   → edit  (מוטציית-קובץ; החלטה §9 #2)
 *   switch_mode → other
 *   other  → other
 *   לא-מוכר → other (default)
 *
 * switch מפורש (ולא index-into-map) כי tsconfig.base noUncheckedIndexedAccess:true
 * היה גורם map-lookup להחזיר ToolKind|undefined.
 */
export function classifyToolKind(acpKind: string): ToolKind {
  switch (acpKind) {
    case "read":
      return "read"
    case "edit":
    case "delete":
    case "move":
      return "edit"
    case "execute":
      return "execute"
    case "search":
      return "search"
    case "fetch":
      return "fetch"
    case "think":
      return "think"
    default:
      // switch_mode, other, כל ערך לא-מוכר
      return "other"
  }
}
