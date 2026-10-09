/** Minimal types for the Bun built-in SQLite driver (runtime-only under Node tsc). */
declare module "bun:sqlite" {
  export class Database {
    constructor(filename: string)
    exec(sql: string): void
    prepare(sql: string): {
      run(...params: (string | number | null)[]): void
      get(...params: (string | number | null)[]): unknown
      all(...params: (string | number | null)[]): unknown[]
    }
    close(): void
  }
}
