// getBinaryCache (slice cli-bin-resolution-unify): המטמון המשותף לגילוי ול-spawn.
// הצרכן היחיד הוא http-cli-availability, שמעביר אותו ל-detectAvailableClis כדי
// שהגילוי וה-spawn יראו אותם נתיבים.
//
// ⚠️ **אין לחווט אותו לרענון-קונפיג.** `cli-specs-hot-reload` שקל זאת ו**דחה** אחרי
// שני סבבי אימות: מפתח המטמון כולל את `bin`, ולכן שינוי-קונפיג מייצר מפתח אחר
// והפתירה טרייה ממילא; בנוסף המטמון מאמת `existsSync` בכל פגיעה ואינו שומר
// שליליים. כלומר הכשל שחיווט כזה אמור למנוע **אינו אפשרי**, ואי-אפשר לכתוב לו
// טסט מבחין. `getBinaryCache().clear()` בתוך invalidateCache() יתקמפל ויעבור את
// כל השערים — ועדיין יהיה קוד מת.
export { getBinaryCache } from "./cli-config.js"
export type { CliCommand } from "./cli-config.js"
export {
  getCliCommand,
  getCliSpec,
  getEffectiveCliKinds,
  getEffectiveCliSpecs,
} from "./cli-config.js"
export type { CliSpecOverride, CliSpecsOverride } from "./cli-config-file.js"
export { loadCliSpecsOverride, resolveCliSpecsPath } from "./cli-config-file.js"
