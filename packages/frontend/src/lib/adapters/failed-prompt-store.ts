import { type } from "arktype"
import {
  type PromptPayload,
  hasPromptContent,
  parsePromptOwner,
  promptPayload,
  promptPayloadSchema,
} from "../engines/prompt-payload"
import { safeUUID } from "../util/uuid"
import { readDictateSource } from "./dictate-submit-source"
import {
  DICTATE_SOURCES,
  PROMPT_STORE,
  RECORD_RECEIPTS,
  promptRecoveryDb,
} from "./prompt-recovery-idb"

export const PROMPT_CLAIM_MS = 45_000

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
type PromptStamp = Pick<FailedPrompt, "owner" | "version" | "attemptId">
type Completion =
  | { delivery: "accepted" | "unknown" | "not-started" }
  | { delivery: "rejected"; reason: string; retryable: boolean }

type Origin =
  | { recordCaptureId: string }
  | { dictate: { id: string; version: number } }

const slotSchema = type({
  owner: "string",
  version: "number.integer >= 0",
  "deleted?": "boolean",
  "record?": recordSchema,
})
const receiptSchema = type({
  initialAttemptId: "string > 0",
  version: "number.integer > 0",
})

function readSlot(raw: unknown, owner: string): typeof slotSchema.infer {
  if (raw === undefined) return { owner, version: 0 }
  const row = slotSchema.assert(raw)
  if (row.owner !== owner || (row.record &&
      (row.deleted || row.record.owner !== owner || row.record.version !== row.version))) {
    throw new Error("Invalid stored prompt owner")
  }
  return row
}

function matches(record: FailedPrompt | undefined, expected: PromptStamp): record is FailedPrompt {
  return record?.owner === expected.owner && record.version === expected.version &&
    record.attemptId === expected.attemptId
}

export function canSendStoredPrompt(record: FailedPrompt): boolean {
  return record.delivery === "not-started" ||
    (record.delivery === "rejected" && record.retryable === true)
}

function receiptKey(owner: string, id: string): [string, string] {
  return [owner, id]
}

export function createFailedPromptStore(db = promptRecoveryDb, now = Date.now) {
  function rowRead(owner: string) {
    parsePromptOwner(owner)
    return { store: PROMPT_STORE, key: owner }
  }
  const persist = (tx: IDBTransaction, row: typeof slotSchema.infer) =>
    tx.objectStore(PROMPT_STORE).put(row, row.owner)

  function claim(tx: IDBTransaction, owner: string, version: number, payload: PromptPayload,
      recordCaptureId?: string) {
    const record: FailedPrompt = {
      owner, version, payload, attemptId: safeUUID(), delivery: "unknown",
      claimUntil: now() + PROMPT_CLAIM_MS,
      ...(recordCaptureId === undefined ? {} : { recordCaptureId }),
    }
    persist(tx, { owner, version, record })
    return record
  }

  const ownerChanges = new Set<(owner: string, failed: boolean) => void>()
  const onOwnerDeleted = (listener: (owner: string, failed: boolean) => void) => {
    ownerChanges.add(listener)
    return () => { ownerChanges.delete(listener) }
  }

  const load = (owner: string) =>
    db.transact("readonly", [rowRead(owner)], (_tx, [raw]) => readSlot(raw, owner).record)

  function adopt(owner: string, input: PromptPayload, origin?: Origin) {
    const payload = promptPayloadSchema.assert(promptPayload(input.text, input.attachments, input.recordingId))
    if (!hasPromptContent(payload)) throw new Error("Empty prompt")
    const recordId = origin && "recordCaptureId" in origin ? origin.recordCaptureId : undefined
    const dictate = origin && "dictate" in origin ? origin.dictate : undefined
    const reads = [rowRead(owner), { store: DICTATE_SOURCES, key: owner }] as const
    const receipt = recordId === undefined ? undefined : receiptKey(owner, recordId)
    const allReads = receipt ? [...reads, { store: RECORD_RECEIPTS, key: receipt }] as const : reads

    return db.transact("readwrite", allReads, (tx, [raw, rawSource, rawReceipt]) => {
      const slot = readSlot(raw, owner)
      if (slot.deleted) return { kind: "stale" } as const
      if (receipt && rawReceipt !== undefined) {
        receiptSchema.assert(rawReceipt)
        return { kind: "already-adopted" } as const
      }
      const source = readDictateSource(rawSource, owner)
      if (dictate && (source?.capture.id !== dictate.id || source.version !== dictate.version)) {
        return { kind: "stale" } as const
      }
      if (slot.record || (source && !dictate)) return { kind: "occupied" } as const
      const record = claim(tx, owner, slot.version + 1, payload, recordId)
      if (receipt) {
        tx.objectStore(RECORD_RECEIPTS).put({
          initialAttemptId: record.attemptId, version: record.version,
        }, receipt)
      }
      if (dictate) tx.objectStore(DICTATE_SOURCES).delete(owner)
      return { kind: "claimed", record } as const
    })
  }

  function retry(expected: PromptStamp) {
    return db.transact("readwrite", [rowRead(expected.owner)], (tx, [raw]) => {
      const { record, version } = readSlot(raw, expected.owner)
      if (!matches(record, expected) || !canSendStoredPrompt(record)) return
      if ((record.claimUntil ?? 0) > now()) return
      return claim(tx, record.owner, version + 1, record.payload, record.recordCaptureId)
    })
  }
  function settle(expected: PromptStamp, outcome: Completion) {
    return db.transact("readwrite", [rowRead(expected.owner)], (tx, [raw]) => {
      const { record, version } = readSlot(raw, expected.owner)
      if (!matches(record, expected) || record.claimUntil === undefined) return false
      const { delivery, ...details } = outcome
      if (delivery === "not-started" && record.claimUntil <= now()) return false
      const next = { owner: record.owner, version: version + 1 }
      if (delivery === "accepted") persist(tx, next)
      else {
        const { claimUntil: _claim, ...previous } = record
        persist(tx, { ...next, record: { ...previous, ...details, delivery, version: next.version } })
      }
      return true
    })
  }
  function dismiss(expected: PromptStamp) {
    return db.transact("readwrite", [rowRead(expected.owner)], (tx, [raw]) => {
      const { record, version } = readSlot(raw, expected.owner)
      if (!matches(record, expected) || (record.claimUntil ?? 0) > now()) return false
      persist(tx, { owner: expected.owner, version: version + 1 })
      return true
    })
  }

  function hasRecordReceipt(owner: string, id: string) {
    return db.transact("readonly", [
      rowRead(owner), { store: RECORD_RECEIPTS, key: receiptKey(owner, id) },
    ], (_tx, [raw, receipt]) =>
      !readSlot(raw, owner).deleted && receipt !== undefined && !!receiptSchema.assert(receipt))
  }

  async function deleteOwner(owner: string): Promise<boolean> {
    try {
      // All receipt keys consist of the owner and a string capture ID.
      const range = IDBKeyRange.bound([owner, ""], [owner, []], false, true)
      await db.transact("readwrite", [
        rowRead(owner), { store: DICTATE_SOURCES, key: owner },
        { store: RECORD_RECEIPTS, key: range },
      ], (tx, [raw]) => {
        const { version } = readSlot(raw, owner)
        persist(tx, { owner, version: version + 1, deleted: true })
        tx.objectStore(DICTATE_SOURCES).delete(owner)
        tx.objectStore(RECORD_RECEIPTS).delete(range)
      })
    } catch {
      for (const listener of ownerChanges) listener(owner, true)
      return false
    }
    for (const listener of ownerChanges) listener(owner, false)
    return true
  }

  return { load, adopt, retry, settle, dismiss, hasRecordReceipt, deleteOwner, onOwnerDeleted }
}

export const failedPromptStore = createFailedPromptStore()
