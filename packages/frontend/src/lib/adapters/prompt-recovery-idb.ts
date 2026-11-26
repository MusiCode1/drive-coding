export const PROMPT_DB_NAME = "drive-coding-prompt-recovery"
export const PROMPT_STORE = "prompts"
export const RECORD_RECEIPTS = "record-receipts"
export const DICTATE_SOURCES = "dictate-submit"
const OPERATION_MS = 5_000

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
      const tx = db.transaction(stores, mode, { durability: mode === "readwrite" ? "strict" : "default" })
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
      const timer = setTimeout(() => {
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
      }, Math.max(0, deadline - Date.now()))
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
