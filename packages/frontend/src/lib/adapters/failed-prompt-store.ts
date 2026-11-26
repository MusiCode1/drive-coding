import {
  hasPromptContent,
  type PromptPayload,
  parsePromptOwner,
  promptPayload,
  promptPayloadSchema,
} from "../engines/prompt-payload"
import { safeUUID } from "../util/uuid"
import { clearPromptOwnerData, readDictateSource } from "./dictate-submit-source"
import {
  DICTATE_SOURCES,
  type FailedPrompt,
  matches,
  PROMPT_STORE,
  type PromptSlot,
  type PromptStamp,
  promptRecoveryDb,
  RECORD_RECEIPTS,
  readSlot,
  receiptKey,
  receiptSchema,
} from "./prompt-recovery-idb"

export type { FailedPrompt } from "./prompt-recovery-idb"

export const PROMPT_CLAIM_MS = 45_000

type Completion =
  | { delivery: "accepted" | "unknown" | "not-started" }
  | { delivery: "rejected"; reason: string; retryable: boolean }

type Origin = { recordCaptureId: string } | { dictate: { id: string; version: number } }

export function canSendStoredPrompt(record: FailedPrompt): boolean {
  return (
    record.delivery === "not-started" ||
    (record.delivery === "rejected" && record.retryable === true)
  )
}

export function createFailedPromptStore(db = promptRecoveryDb, now = Date.now) {
  function rowRead(owner: string) {
    parsePromptOwner(owner)
    return { store: PROMPT_STORE, key: owner }
  }
  const persist = (tx: IDBTransaction, row: PromptSlot) =>
    tx.objectStore(PROMPT_STORE).put(row, row.owner)

  function claim(
    tx: IDBTransaction,
    owner: string,
    version: number,
    payload: PromptPayload,
    recordCaptureId?: string,
  ) {
    const record: FailedPrompt = {
      owner,
      version,
      payload,
      attemptId: safeUUID(),
      delivery: "unknown",
      claimUntil: now() + PROMPT_CLAIM_MS,
      ...(recordCaptureId === undefined ? {} : { recordCaptureId }),
    }
    persist(tx, { owner, version, record })
    return record
  }

  const ownerChanges = new Set<(owner: string, failed: boolean) => void>()
  const onOwnerDeleted = (listener: (owner: string, failed: boolean) => void) => {
    ownerChanges.add(listener)
    return () => {
      ownerChanges.delete(listener)
    }
  }

  const load = (owner: string) =>
    db.transact("readonly", [rowRead(owner)], (_tx, [raw]) => readSlot(raw, owner).record)

  function adopt(owner: string, input: PromptPayload, origin?: Origin) {
    const payload = promptPayloadSchema.assert(
      promptPayload(input.text, input.attachments, input.recordingId),
    )
    if (!hasPromptContent(payload)) throw new Error("Empty prompt")
    const recordId = origin && "recordCaptureId" in origin ? origin.recordCaptureId : undefined
    const dictate = origin && "dictate" in origin ? origin.dictate : undefined
    const reads = [rowRead(owner), { store: DICTATE_SOURCES, key: owner }] as const
    const receipt = recordId === undefined ? undefined : receiptKey(owner, recordId)
    const allReads = receipt
      ? ([...reads, { store: RECORD_RECEIPTS, key: receipt }] as const)
      : reads

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
        tx.objectStore(RECORD_RECEIPTS).put(
          {
            initialAttemptId: record.attemptId,
            version: record.version,
          },
          receipt,
        )
      }
      if (dictate) tx.objectStore(DICTATE_SOURCES).delete(owner)
      return { kind: "claimed", record } as const
    })
  }

  function claimRetry(expected: PromptStamp, eligible: (record: FailedPrompt) => boolean) {
    return db.transact("readwrite", [rowRead(expected.owner)], (tx, [raw]) => {
      const { record, version } = readSlot(raw, expected.owner)
      if (!matches(record, expected) || !eligible(record)) return
      if ((record.claimUntil ?? 0) > now()) return
      return claim(tx, record.owner, version + 1, record.payload, record.recordCaptureId)
    })
  }
  const retry = (expected: PromptStamp) => claimRetry(expected, canSendStoredPrompt)
  const claimConfirmedRetry = (expected: PromptStamp) =>
    claimRetry(expected, (record) => record.delivery === "unknown")

  function settle(expected: PromptStamp, outcome: Completion, requireLiveClaim = false) {
    return db.transact("readwrite", [rowRead(expected.owner)], (tx, [raw]) => {
      const { record, version } = readSlot(raw, expected.owner)
      if (!matches(record, expected) || record.claimUntil === undefined) return false
      const { delivery, ...details } = outcome
      if ((requireLiveClaim || delivery === "not-started") && record.claimUntil <= now())
        return false
      const next = { owner: record.owner, version: version + 1 }
      if (delivery === "accepted") persist(tx, next)
      else {
        const { claimUntil: _claim, ...previous } = record
        persist(tx, {
          ...next,
          record: { ...previous, ...details, delivery, version: next.version },
        })
      }
      return true
    })
  }
  function settleConfirmedRetry(expected: PromptStamp, accepted: boolean) {
    return settle(expected, { delivery: accepted ? "accepted" : "unknown" }, true)
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
    return db.transact(
      "readonly",
      [rowRead(owner), { store: RECORD_RECEIPTS, key: receiptKey(owner, id) }],
      (_tx, [raw, receipt]) =>
        !readSlot(raw, owner).deleted && receipt !== undefined && !!receiptSchema.assert(receipt),
    )
  }

  async function deleteOwner(owner: string): Promise<boolean> {
    try {
      await clearPromptOwnerData(db, owner)
    } catch {
      for (const listener of ownerChanges) listener(owner, true)
      return false
    }
    for (const listener of ownerChanges) listener(owner, false)
    return true
  }

  return {
    load,
    adopt,
    retry,
    claimConfirmedRetry,
    settle,
    settleConfirmedRetry,
    dismiss,
    hasRecordReceipt,
    deleteOwner,
    onOwnerDeleted,
  }
}

export const failedPromptStore = createFailedPromptStore()
