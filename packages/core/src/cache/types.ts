/**
 * Generic async cache interface.
 * T is the stored value type; the implementation decides how to persist it.
 */
export interface Cache<T> {
  /** Returns the cached value, or null on cache miss. */
  get(key: string): Promise<T | null>
  /** Stores a value under the given key. */
  set(key: string, value: T): Promise<void>
  /** Returns true if the key exists without deserialising the value. */
  has(key: string): Promise<boolean>
}
