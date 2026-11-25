import { untrack } from "svelte"
import { patchAgent } from "$lib/adapters/agents-api"

const STORAGE_PREFIX = "dc:session-memo:"
const DEBOUNCE_MS = 300

type PersistedMemo = {
  minimized: boolean
}

export function memoStorageKey(sessionId: string | null): string | null {
  return sessionId ? `${STORAGE_PREFIX}${sessionId}` : null
}

export function parseMemo(raw: string | null): PersistedMemo {
  try {
    const parsed = JSON.parse(raw ?? "null") as Partial<PersistedMemo> | null
    return { minimized: parsed?.minimized !== false }
  } catch {
    return { minimized: true }
  }
}

function readStorage(key: string | null): string | null {
  if (!key) return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string | null, value: string | null): void {
  if (!key) return
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage can be unavailable or full.
  }
}

const POS_KEY = "dc:session-memo-pos"
const SIZE_KEY = "dc:session-memo-size"

export type MemoPos = { left: number; top: number }
export type MemoSize = { width: number; height: number }

/** `null` = לא נגרר מעולם ⇒ המיקום נקבע ב-CSS (פינה תחתונה, צד ההתחלה). */
export function parsePos(raw: string | null): MemoPos | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Partial<MemoPos>
    if (typeof o.left !== "number" || typeof o.top !== "number") return null
    if (!Number.isFinite(o.left) || !Number.isFinite(o.top)) return null
    return { left: o.left, top: o.top }
  } catch {
    return null
  }
}

/** `null` = לא שונה גודל מעולם ⇒ המידות נקבעות ב-CSS. */
export function parseSize(raw: string | null): MemoSize | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Partial<MemoSize>
    if (typeof o.width !== "number" || typeof o.height !== "number") return null
    if (!Number.isFinite(o.width) || !Number.isFinite(o.height)) return null
    if (o.width <= 0 || o.height <= 0) return null
    return { width: o.width, height: o.height }
  } catch {
    return null
  }
}

type MemoSessionSource = {
  readonly agentId: string | null
  readonly sessionId: string | null
  readonly agentNotes?: string
}

type NoteEdit = Readonly<{ agentId: string; text: string }>
type NoteWrite = Readonly<{ text: string; done: Promise<void> }>

export class SessionMemoVM {
  text = $state("")
  minimized = $state(true)

  // Position and size are global browser preferences.
  pos = $state<MemoPos | null>(parsePos(readStorage(POS_KEY)))

  size = $state<MemoSize | null>(parseSize(readStorage(SIZE_KEY)))

  #loadedId: string | null = null
  #loadedAgentId: string | null = null
  #loadedNotes: string | undefined
  #pending: NoteEdit | undefined
  #timer: ReturnType<typeof setTimeout> | undefined
  #writes = new Map<string, NoteWrite>()

  constructor(private readonly source?: MemoSessionSource) {
    if (source) {
      $effect(() => {
        const { sessionId, agentId, agentNotes } = source
        untrack(() => this.setSessionId(sessionId, agentId, agentNotes))
      })
    }

    $effect(() => () => this.#flush())
  }

  setSessionId(sessionId: string | null, agentId: string | null = null, notes?: string): void {
    if (sessionId !== this.#loadedId) {
      this.#loadedId = sessionId
      this.minimized = parseMemo(readStorage(memoStorageKey(sessionId))).minimized
    }

    if (agentId !== this.#loadedAgentId) {
      this.#flush()
      this.#loadedAgentId = agentId
      this.text = (agentId === null ? undefined : this.#writes.get(agentId)?.text) ?? notes ?? ""
    } else if (
      notes !== this.#loadedNotes &&
      this.#pending === undefined &&
      (agentId === null || !this.#writes.has(agentId))
    ) {
      this.text = notes ?? ""
    }
    this.#loadedNotes = notes
  }

  setText(value: string): void {
    const agentId = this.#loadedAgentId
    if ((this.source && agentId !== this.source.agentId) || value === this.text) return

    this.text = value
    if (!agentId) return
    this.#pending = { agentId, text: value }
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.#flush(), DEBOUNCE_MS)
  }

  #flush(): void {
    const edit = this.#pending
    if (!edit) return
    this.#pending = undefined
    clearTimeout(this.#timer)
    this.#timer = undefined

    const { agentId, text } = edit
    const previous = this.#writes.get(agentId)
    const send = async () => {
      try {
        // Older backends accept the legacy spelling.
        await patchAgent(agentId, { userNotes: text })
      } catch {
        // Keep the local text. A failed or timed out write is never retried.
      }
    }
    const done = (previous ? previous.done.then(send) : send()).finally(() => {
      if (this.#writes.get(agentId)?.done === done) this.#writes.delete(agentId)
    })
    this.#writes.set(agentId, { text, done })
  }

  setMinimized(value: boolean): void {
    if (this.minimized === value) return
    this.minimized = value
    // The collapsed default needs no stored entry.
    writeStorage(
      memoStorageKey(this.#loadedId),
      value ? null : JSON.stringify({ minimized: value }),
    )
  }

  setPos(next: MemoPos): void {
    this.pos = next
    writeStorage(POS_KEY, JSON.stringify(next))
  }

  setSize(next: MemoSize): void {
    this.size = next
    writeStorage(SIZE_KEY, JSON.stringify(next))
  }

  toggle(): void {
    this.setMinimized(!this.minimized)
  }

  /** האם יש תוכן — לסימון ויזואלי על הגלולה המצומצמת. */
  get hasContent(): boolean {
    return this.text.trim().length > 0
  }
}
