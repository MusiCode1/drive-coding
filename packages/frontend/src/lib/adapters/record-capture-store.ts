import {
  type PendingCapture,
  type PendingCaptureStore,
  parsePendingCapture,
} from "@drive-coding/core/voice/pending-capture"

const DB_NAME = "drive-coding-record-pending"
const STORE = "captures"
const QUARANTINE = 0

type Slot = { ownerKey: string | null; capture: PendingCapture; blob: Blob }
type OwnerState = { revision: number; overlay?: Slot | null; snapshot: Slot | null }
type RecordSlotStore = PendingCaptureStore & { matches(id: string): Promise<boolean> }

function parseSlot(raw: unknown, ownerKey: string | null): Slot | null {
  if (typeof raw !== "object" || raw === null || !("ownerKey" in raw) || raw.ownerKey !== ownerKey)
    return null
  if (!("blob" in raw) || !(raw.blob instanceof Blob) || !("capture" in raw)) return null
  const capture = parsePendingCapture(raw.capture)
  return capture?.source === "mic" ? { ownerKey, capture, blob: raw.blob } : null
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"))
    request.onsuccess = () => resolve(request.result)
  })
}

function transaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, result: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    let outcome: T
    tx.oncomplete = () => resolve(outcome)
    tx.onabort = () => reject(tx.error ?? new Error("Record capture transaction aborted"))
    run(tx.objectStore(STORE), (value) => {
      outcome = value
    })
  })
}

export function createRecordCaptureStore() {
  let opening: Promise<IDBDatabase> | undefined
  const owners = new Map<string | null, OwnerState>()
  const db = () =>
    (opening ??= openDb().catch((error: unknown) => {
      opening = undefined
      throw error
    }))

  function forOwner(ownerKey: string | null): RecordSlotStore {
    const key = ownerKey ?? QUARANTINE
    const state = owners.get(ownerKey) ?? { revision: 0, snapshot: null }
    owners.set(ownerKey, state)

    async function read(allowSnapshot: boolean): Promise<Slot | null> {
      const { revision, overlay } = state
      if (overlay !== undefined) return overlay
      try {
        const database = await db()
        const slot = await transaction<Slot | null>(database, "readonly", (store, result) => {
          const request = store.get(key)
          request.onsuccess = () => result(parseSlot(request.result, ownerKey))
        })
        if (state.revision !== revision) return state.overlay ?? null
        state.snapshot = slot
        return slot
      } catch (error) {
        console.warn("[record-capture-store] read failed", error)
        if (state.revision !== revision) return state.overlay ?? null
        return allowSnapshot ? state.snapshot : null
      }
    }

    async function compareAndSet(id: string, next: (slot: Slot) => Slot | null) {
      const database = await db()
      return transaction<"applied" | "mismatch">(database, "readwrite", (store, result) => {
        const request = store.get(key)
        request.onsuccess = () => {
          const slot = parseSlot(request.result, ownerKey)
          if (slot?.capture.id !== id) {
            result("mismatch")
            return
          }
          const replacement = next(slot)
          if (replacement) store.put(replacement, key)
          else store.delete(key)
          result("applied")
        }
      })
    }

    async function change(id: string, next: (slot: Slot) => Slot | null, removing = false) {
      const previous = state.overlay === undefined ? state.snapshot : state.overlay
      if (state.overlay !== undefined && previous?.capture.id !== id) return
      const revision = ++state.revision
      const replacement = previous?.capture.id === id ? next(previous) : undefined
      if (state.overlay !== undefined || (removing && replacement === null)) {
        state.overlay = replacement
      }
      try {
        const result = await compareAndSet(id, next)
        if (state.revision !== revision) return
        if (result === "applied") {
          state.overlay = undefined
          state.snapshot = replacement ?? null
        } else if (state.overlay === undefined && state.snapshot?.capture.id === id) {
          state.snapshot = null
        }
      } catch (error) {
        if (state.revision === revision && replacement !== undefined) state.overlay = replacement
        console.warn("[record-capture-store] conditional write failed", error)
      }
    }

    return {
      async load() {
        const slot = await read(true)
        return slot ? { capture: { ...slot.capture }, blob: slot.blob } : null
      },
      matches: async (id) => ownerKey !== null && (await read(false))?.capture.id === id,
      async save(capture, blob) {
        const slot = parseSlot({ ownerKey, capture, blob }, ownerKey)
        if (!slot) return
        const revision = ++state.revision
        state.overlay = slot
        try {
          const database = await db()
          await transaction<void>(database, "readwrite", (store, result) => {
            store.put(slot, key)
            result()
          })
          if (state.revision !== revision) return
          state.snapshot = slot
          state.overlay = undefined
        } catch (error) {
          console.warn("[record-capture-store] save failed", error)
        }
      },
      updateMeta: (id, patch) =>
        change(id, (slot) => ({
          ...slot,
          capture: { ...slot.capture, ...patch, id, source: "mic" },
        })),
      remove: (id) => change(id, () => null, true),
    }
  }

  return { forOwner }
}
