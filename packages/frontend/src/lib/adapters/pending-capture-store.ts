/**
 * pending-capture-store.ts — IndexedDB persistence for a single pending voice capture.
 * (slice voice-pending-persistence, Commit 0)
 *
 * Single slot per origin: a new save replaces any existing pending capture.
 */
import {
  parsePendingCapture,
  type PendingCapture,
} from "@drive-coding/core/voice/pending-capture"

export type PendingCaptureStore = {
  load(): Promise<{ capture: PendingCapture; blob: Blob } | null>
  save(capture: PendingCapture, blob: Blob): Promise<void>
  updateMeta(id: string, patch: Partial<PendingCapture>): Promise<void>
  remove(id: string): Promise<void>
}

const DB_NAME = "drive-coding-pending"
const DB_VERSION = 1
const META_STORE = "meta"
const BLOBS_STORE = "blobs"

type MemorySlot = {
  capture: PendingCapture
  blob: Blob
}

/** In-memory store for tests and environments without IndexedDB. */
export function createInMemoryPendingCaptureStore(): PendingCaptureStore {
  let slot: MemorySlot | null = null

  return {
    async load() {
      if (!slot) return null
      return { capture: { ...slot.capture }, blob: slot.blob }
    },

    async save(capture, blob) {
      slot = { capture: { ...capture }, blob }
    },

    async updateMeta(id, patch) {
      if (!slot || slot.capture.id !== id) return
      slot.capture = { ...slot.capture, ...patch }
    },

    async remove(id) {
      if (slot?.capture.id === id) slot = null
    },
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error("indexedDB.open failed"))
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains(BLOBS_STORE)) {
        db.createObjectStore(BLOBS_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error("indexedDB transaction failed"))
    tx.onabort = () => reject(tx.error ?? new Error("indexedDB transaction aborted"))
  })
}

function reqResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("indexedDB request failed"))
  })
}

async function clearAllStores(db: IDBDatabase): Promise<void> {
  const tx = db.transaction([META_STORE, BLOBS_STORE], "readwrite")
  tx.objectStore(META_STORE).clear()
  tx.objectStore(BLOBS_STORE).clear()
  await txDone(tx)
}

function createIndexedDbPendingCaptureStore(): PendingCaptureStore {
  let dbPromise: Promise<IDBDatabase> | null = null

  const db = (): Promise<IDBDatabase> => {
    if (!dbPromise) dbPromise = openDb()
    return dbPromise
  }

  return {
    async load() {
      const database = await db()
      const tx = database.transaction(META_STORE, "readonly")
      const all = await reqResult(tx.objectStore(META_STORE).getAll())
      await txDone(tx)
      if (!Array.isArray(all) || all.length === 0) return null
      const raw = all[0]
      const capture = parsePendingCapture(raw)
      if (!capture) return null

      const blobTx = database.transaction(BLOBS_STORE, "readonly")
      const blob = await reqResult(blobTx.objectStore(BLOBS_STORE).get(capture.id))
      await txDone(blobTx)
      if (!(blob instanceof Blob)) return null
      return { capture, blob }
    },

    async save(capture, blob) {
      const database = await db()
      await clearAllStores(database)
      const tx = database.transaction([META_STORE, BLOBS_STORE], "readwrite")
      tx.objectStore(META_STORE).put(capture)
      tx.objectStore(BLOBS_STORE).put(blob, capture.id)
      await txDone(tx)
    },

    async updateMeta(id, patch) {
      const database = await db()
      const readTx = database.transaction(META_STORE, "readonly")
      const existing = await reqResult(readTx.objectStore(META_STORE).get(id))
      await txDone(readTx)
      const capture = parsePendingCapture(existing)
      if (!capture) return

      const updated = { ...capture, ...patch }
      const writeTx = database.transaction(META_STORE, "readwrite")
      writeTx.objectStore(META_STORE).put(updated)
      await txDone(writeTx)
    },

    async remove(id) {
      const database = await db()
      const tx = database.transaction([META_STORE, BLOBS_STORE], "readwrite")
      tx.objectStore(META_STORE).delete(id)
      tx.objectStore(BLOBS_STORE).delete(id)
      await txDone(tx)
    },
  }
}

export function createPendingCaptureStore(): PendingCaptureStore {
  if (typeof indexedDB === "undefined") {
    return createInMemoryPendingCaptureStore()
  }
  return createIndexedDbPendingCaptureStore()
}
