/**
 * CLI entry for `drive-coding agent …` and `drive-coding instances`.
 * Invoked from bin/drive-coding.ts AFTER a peek at argv[2], before parseArgs.
 */

export async function runCli(argv: string[]): Promise<number> {
  // C2 fills in commands. C1 only needs the branch to exist so subcommand flags
  // never reach the server parseArgs (strict + allowPositionals:false).
  console.error(`[drive-coding] cli not yet implemented: ${argv.join(" ")}`)
  return 1
}
