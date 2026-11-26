import { type } from "arktype"
import { promptPayloadSchema } from "../engines/prompt-payload"

export const PROMPT_DB_NAME = "drive-coding-prompt-recovery"
export const PROMPT_STORE = "prompts"
export const RECORD_RECEIPTS = "record-receipts"
export const DICTATE_SOURCES = "dictate-submit"
const OPERATION_MS = 5_000

const recordSchema = type({
  owner: "string",
  attemptId: "string > 0",
  version: "number.integer > 0",
  payload: promptPayloadSchema,
  delivery: "'unknown' | 'not-started' | 'rejected'",
  "reason?": "string",
  "retryable?": "boolean",
  "claimUntil?": "number",
  "recordCaptureId?": "string",
})
export type FailedPrompt = typeof recordSchema.infer

const slotSchema = type({
  owner: "string",
  version: "number.integer >= 0",
  "deleted?": "boolean",
  "record?": recordSchema,
})
export const receiptSchema = type({
  initialAttemptId: "string > 0",
  version: "number.integer > 0",
})

export type PromptSlot = typeof slotSchema.infer

export function readSlot(raw: unknown, owner: string): PromptSlot {
  if (raw === undefined) return { owner, version: 0 }
  const row = slotSchema.assert(raw)
  if (
    row.owner !== owner ||
    (row.record &&
      (row.deleted || row.record.owner !== owner || row.record.version !== row.version))
  ) {
    throw new Error("Invalid stored prompt owner")
  }
  return row
}

export type PromptStamp = Pick<FailedPrompt, "owner" | "version" | "attemptId">

export function matches(record: FailedPrompt | undefined, expected: PromptStamp): record is FailedPrompt {
  return (
    record?.owner === expected.owner &&
    record.version === expected.version &&
    record.attemptId === expected.attemptId
  )
}

export function receiptKey(owner: string, id: string): [string, string] {
  return [owner, id]
}

type Read = { store: string; key: IDBValidKey | IDBKeyRange }

function storageTimeout() {
  return new Error("Prompt storage timed out")
}

export function createPromptRecoveryDb() {
  let opening: Promise<IDBDatabase> | undefined
  function open(deadline: number) {
    if (opening) return opening
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(PROMPT_DB_NAME, 1)
      let finished = false
      const fail = (error: unknown) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        reject(error)
      }
      const timer = setTimeout(() => fail(storageTimeout()), Math.max(0, deadline - Date.now()))
      request.onblocked = () => fail(new Error("Prompt storage is blocked"))
      request.onerror = () => fail(request.error)
      request.onupgradeneeded = () => {
        if (finished) {
          request.transaction?.abort()
          return
        }
        request.result.createObjectStore(PROMPT_STORE)
        request.result.createObjectStore(RECORD_RECEIPTS)
        request.result.createObjectStore(DICTATE_SOURCES)
      }
      request.onsuccess = () => {
        const db = request.result
        if (finished) {
          db.close()
          return
        }
        finished = true
        clearTimeout(timer)
        db.onversionchange = () => {
          db.close()
          if (opening === pending) opening = undefined
        }
        db.onclose = () => {
          if (opening === pending) opening = undefined
        }
        resolve(db)
      }
    })
    opening = pending
    void pending.catch(() => {
      if (opening === pending) opening = undefined
    })
    return pending
  }

  // Read callbacks and conditional writes share one active IDB transaction.
  async function transact<T>(
    mode: IDBTransactionMode,
    reads: readonly [Read, ...Read[]],
    apply: (tx: IDBTransaction, values: unknown[]) => T,
  ): Promise<T> {
    const deadline = Date.now() + OPERATION_MS
    const db = await open(deadline)
    if (Date.now() >= deadline) throw storageTimeout()
    return new Promise<T>((resolve, reject) => {
      const stores = [...new Set(reads.map(({ store }) => store))]
      const tx = db.transaction(stores, mode, {
        durability: mode === "readwrite" ? "strict" : "default",
      })
      let finished = false
      let applied = false
      let value: T
      let failure: unknown
      let fallback: ReturnType<typeof setTimeout> | undefined
      const finish = (ok: boolean) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        clearTimeout(fallback)
        if (ok && applied) resolve(value)
        else reject(failure ?? tx.error ?? new Error("Prompt storage transaction failed"))
      }
      const timer = setTimeout(
        () => {
          if (finished) return
          try {
            tx.abort()
            failure = storageTimeout()
            finish(false)
          } catch {
            // An already finished transaction can have a completion event queued.
            fallback = setTimeout(() => {
              failure = storageTimeout()
              finish(false)
            }, 0)
          }
        },
        Math.max(0, deadline - Date.now()),
      )
      tx.oncomplete = () => finish(true)
      tx.onabort = () => finish(false)
      const values: unknown[] = []
      let remaining = reads.length
      reads.forEach(({ store, key }, index) => {
        const request = tx.objectStore(store).get(key)
        request.onsuccess = () => {
          if (finished) return
          values[index] = request.result
          if (--remaining !== 0) return
          try {
            if (Date.now() >= deadline) throw storageTimeout()
            value = apply(tx, values)
            applied = true
          } catch (error) {
            failure = error
            tx.abort()
          }
        }
      })
    })
  }

  return { transact }
}

export const promptRecoveryDb = createPromptRecoveryDb()
