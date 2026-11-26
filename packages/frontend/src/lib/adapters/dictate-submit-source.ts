import {
  type PendingCapture,
  type PendingCaptureStore,
  parsePendingCapture,
} from "@drive-coding/core/voice/pending-capture"
import { type } from "arktype"
import {
  type PromptPayload,
  parsePromptOwner,
  promptPayloadSchema,
} from "../engines/prompt-payload"
import {
  DICTATE_SOURCES,
  PROMPT_STORE,
  promptRecoveryDb,
  RECORD_RECEIPTS,
  readSlot,
} from "./prompt-recovery-idb"

export type DictateSubmitSource = {
  owner: string
  capture: PendingCapture
  blob: Blob
  snapshot: PromptPayload
  version: number
}

const sourceSchema = type({
  owner: "string",
  capture: "object",
  blob: "object",
  snapshot: promptPayloadSchema,
  version: "number.integer > 0",
})

export function readDictateSource(raw: unknown, owner: string): DictateSubmitSource | undefined {
  if (raw === undefined) return
  const row = sourceSchema.assert(raw)
  const capture = parsePendingCapture(row.capture)
  if (row.owner !== owner || capture?.source !== "dictate" || !(row.blob instanceof Blob)) {
    throw new Error("Invalid Dictate Submit source")
  }
  return { ...row, blob: row.blob, capture }
}

export class DictateSourceConflict extends Error {
  constructor(readonly reason: "deleted" | "changed" = "changed") {
    super(reason === "deleted" ? "Prompt owner was deleted" : "Dictate Submit source changed")
  }
}

/** Clear all prompt recovery data for a deleted ACP session in one transaction. */
export function clearPromptOwnerData(db: typeof promptRecoveryDb, owner: string) {
  parsePromptOwner(owner)
  // Receipt keys consist of an owner and a string capture ID.
  const range = IDBKeyRange.bound([owner, ""], [owner, []], false, true)
  return db.transact(
    "readwrite",
    [
      { store: PROMPT_STORE, key: owner },
      { store: DICTATE_SOURCES, key: owner },
      { store: RECORD_RECEIPTS, key: range },
    ],
    (tx, [raw]) => {
      const { version } = readSlot(raw, owner)
      tx.objectStore(PROMPT_STORE).put({ owner, version: version + 1, deleted: true }, owner)
      tx.objectStore(DICTATE_SOURCES).delete(owner)
      tx.objectStore(RECORD_RECEIPTS).delete(range)
    },
  )
}

export function createDictateSubmitSourceDb(db = promptRecoveryDb) {
  function operation<T>(
    owner: string,
    mode: IDBTransactionMode,
    change: (current: DictateSubmitSource | undefined, table: IDBObjectStore) => T,
  ) {
    parsePromptOwner(owner)
    return db.transact(
      mode,
      [
        { store: PROMPT_STORE, key: owner },
        { store: DICTATE_SOURCES, key: owner },
      ],
      (tx, [slot, source]) => {
        const table = tx.objectStore(DICTATE_SOURCES)
        if (
          typeof slot === "object" &&
          slot !== null &&
          "deleted" in slot &&
          slot.deleted === true
        ) {
          if (mode === "readonly") return change(undefined, table)
          throw new DictateSourceConflict("deleted")
        }
        return change(readDictateSource(source, owner), table)
      },
    )
  }

  const load = (owner: string) => operation(owner, "readonly", (current) => current)
  const save = (source: DictateSubmitSource, expectedVersion?: number) =>
    operation(source.owner, "readwrite", (current, table) => {
      if (
        current?.version !== expectedVersion ||
        (current && current.capture.id !== source.capture.id)
      )
        throw new DictateSourceConflict()
      const row = { ...source, version: (current?.version ?? 0) + 1 }
      readDictateSource(row, row.owner)
      table.put(row, row.owner)
      return row
    })
  const remove = (source: DictateSubmitSource) =>
    operation(source.owner, "readwrite", (current, table) => {
      if (current?.capture.id === source.capture.id && current.version === source.version) {
        table.delete(source.owner)
      }
    })

  return { load, save, remove }
}

export const dictateSubmitSourceDb = createDictateSubmitSourceDb()

// This instance is bound to a single operation. The VM retains its last candidate on IO failure.
export function dictateSubmitCaptureStore(opts: {
  owner: string
  snapshot: PromptPayload
  initial?: DictateSubmitSource
  db: ReturnType<typeof createDictateSubmitSourceDb>
  onCandidate(source: DictateSubmitSource, expectedVersion?: number): void
  onSaved(source: DictateSubmitSource): void
}): PendingCaptureStore {
  let current = opts.initial
  async function save(source: DictateSubmitSource, expected?: number) {
    opts.onCandidate(source, expected)
    current = await opts.db.save(source, expected)
    opts.onSaved(current)
  }
  return {
    async load() {
      return current ?? null
    },
    save: (capture, blob) =>
      save({ owner: opts.owner, snapshot: opts.snapshot, capture, blob, version: 1 }),
    async updateMeta(id, patch) {
      if (!current || current.capture.id !== id) throw new DictateSourceConflict()
      await save({ ...current, capture: { ...current.capture, ...patch } }, current.version)
    },
    async remove(id) {
      if (current?.capture.id === id) await opts.db.remove(current)
    },
  }
}

export async function resolveDictateSubmitSource(
  db: typeof dictateSubmitSourceDb,
  expected: DictateSubmitSource,
  candidate: { expectedVersion?: number } | undefined,
): Promise<DictateSubmitSource | undefined> {
  const { owner, capture, version } = expected
  if (!candidate) {
    const stored = await db.load(owner)
    if (stored?.capture.id === capture.id && stored.version === version) return stored
    return
  }
  if (candidate.expectedVersion !== undefined) {
    const stored = await db.load(owner)
    if (stored?.capture.id !== capture.id || stored.version !== candidate.expectedVersion) return
  }
  return db.save(expected, candidate.expectedVersion)
}
