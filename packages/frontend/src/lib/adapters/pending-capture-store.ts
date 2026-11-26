/**
 * pending-capture-store.ts — IndexedDB persistence for the global Dictate slot.
 * (slice voice-pending-persistence, Commit 0)
 *
 * Legacy Record rows share this database and are left untouched.
 */
import {
  type PendingCapture,
  type PendingCaptureStore,
  parsePendingCapture,
} from "@drive-coding/core/voice/pending-capture"

export type { PendingCaptureStore }

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

async function changeDictation(
  database: IDBDatabase,
  id: string,
  update: (capture: PendingCapture, meta: IDBObjectStore, blobs: IDBObjectStore) => void,
): Promise<void> {
  const tx = database.transaction([META_STORE, BLOBS_STORE], "readwrite")
  const meta = tx.objectStore(META_STORE)
  const request = meta.get(id)
  request.onsuccess = () => {
    const capture = parsePendingCapture(request.result)
    if (capture?.source === "dictate") update(capture, meta, tx.objectStore(BLOBS_STORE))
  }
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
      const tx = database.transaction([META_STORE, BLOBS_STORE], "readonly")
      const done = txDone(tx)
      let loaded: MemorySlot | null = null
      const request = tx.objectStore(META_STORE).getAll()
      request.onsuccess = () => {
        const rows: unknown[] = request.result
        const capture = rows.map(parsePendingCapture).find((row) => row?.source === "dictate")
        if (!capture) return
        const blob = tx.objectStore(BLOBS_STORE).get(capture.id)
        blob.onsuccess = () => {
          if (blob.result instanceof Blob) loaded = { capture, blob: blob.result }
        }
      }
      await done
      return loaded
    },

    async save(capture, blob) {
      if (capture.source !== "dictate") return
      const database = await db()
      const tx = database.transaction([META_STORE, BLOBS_STORE], "readwrite")
      const meta = tx.objectStore(META_STORE)
      const blobs = tx.objectStore(BLOBS_STORE)
      const request = meta.getAll()
      request.onsuccess = () => {
        const rows: unknown[] = request.result
        // A legacy Record ID belongs to that row even if a caller presents the same ID.
        if (
          rows.some(
            (raw) =>
              typeof raw === "object" &&
              raw !== null &&
              "id" in raw &&
              raw.id === capture.id &&
              parsePendingCapture(raw)?.source !== "dictate",
          )
        )
          return
        for (const raw of rows) {
          const existing = parsePendingCapture(raw)
          if (existing?.source === "dictate") {
            meta.delete(existing.id)
            blobs.delete(existing.id)
          }
        }
        meta.put(capture)
        blobs.put(blob, capture.id)
      }
      await txDone(tx)
    },

    async updateMeta(id, patch) {
      await changeDictation(await db(), id, (capture, meta) =>
        meta.put({ ...capture, ...patch, id, source: "dictate" }),
      )
    },

    async remove(id) {
      await changeDictation(await db(), id, (_capture, meta, blobs) => {
        meta.delete(id)
        blobs.delete(id)
      })
    },
  }
}

export function createPendingCaptureStore(): PendingCaptureStore {
  if (typeof indexedDB === "undefined") {
    return createInMemoryPendingCaptureStore()
  }
  return createIndexedDbPendingCaptureStore()
}
