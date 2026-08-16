// getBinaryCache (slice cli-bin-resolution-unify): המטמון המשותף לגילוי ול-spawn.
// ייצרך ע"י cli-specs-hot-reload. אין צרכן ב-slice הזה.
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
