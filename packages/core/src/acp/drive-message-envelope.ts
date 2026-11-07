/**
 * drive-message-envelope.ts — XML v1 codec for drive-coding agent/system prompts.
 * Scoped parser: no DTD, external entities, CDATA, comments, or DOM.
 */
import { type } from "arktype"
import { err, ok, type Result } from "neverthrow"

export type DriveMessageContext = { kind: "project-charter"; text: string }

export type DriveMessageAgent = {
  source: "agent"
  context?: DriveMessageContext
  sender: { id: string; name?: string }
  body: string
}

export type DriveMessageSystem = {
  source: "system"
  context?: DriveMessageContext
  eventKind: "turn-ended" | "stall-suspected"
  subjectAgent: { id: string; name?: string }
  at: number
  stopReason?: string
  silentMs?: number
  lastTurnError?: { message: string }
  lastAssistantText?: { text: string; truncated: boolean }
}

export type DriveMessage = DriveMessageAgent | DriveMessageSystem

export type ParseFailure = "not-envelope" | "unknown-version" | "malformed"
export type ParseResult = Result<DriveMessage, ParseFailure>

export type InsertContextResult = Result<
  { text: string; offset: number; insertedText: string },
  "not-envelope" | "context-exists" | "insert-unverified"
>

const ROOT = "drive-coding-msg"
const KNOWN_VERSION = "1"

const DriveMessageContextSchema = type({
  kind: "'project-charter'",
  text: "string",
})

const DriveMessageAgentSchema = type({
  source: "'agent'",
  "context?": DriveMessageContextSchema,
  sender: { id: "string", "name?": "string" },
  body: "string",
})

const DriveMessageSystemSchema = type({
  source: "'system'",
  "context?": DriveMessageContextSchema,
  eventKind: "'turn-ended' | 'stall-suspected'",
  subjectAgent: { id: "string", "name?": "string" },
  at: "number",
  "stopReason?": "string",
  "silentMs?": "number",
  "lastTurnError?": { message: "string" },
  "lastAssistantText?": { text: "string", truncated: "boolean" },
})

function encodeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function encodeAttr(value: string): string {
  return encodeText(value).replaceAll('"', "&quot;").replaceAll("'", "&apos;")
}

function decodeTextOnce(raw: string): string | null {
  let out = ""
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch !== "&") {
      out += ch
      continue
    }
    const semi = raw.indexOf(";", i + 1)
    if (semi < 0) return null
    const entity = raw.slice(i + 1, semi)
    const decoded =
      entity === "amp"
        ? "&"
        : entity === "lt"
          ? "<"
          : entity === "gt"
            ? ">"
            : entity === "quot"
              ? '"'
              : entity === "apos"
                ? "'"
                : null
    if (decoded === null) return null
    out += decoded
    i = semi
  }
  return out
}

function trimOuterWs(s: string): { inner: string; lead: number; trail: number } {
  let start = 0
  let end = s.length
  while (start < end && /\s/.test(s[start] ?? "")) start++
  while (end > start && /\s/.test(s[end - 1] ?? "")) end--
  return { inner: s.slice(start, end), lead: start, trail: s.length - end }
}

type Attrs = Record<string, string>

class Scan {
  readonly src: string
  pos = 0

  constructor(src: string, start = 0) {
    this.src = src
    this.pos = start
  }

  eof(): boolean {
    return this.pos >= this.src.length
  }

  peek(): string {
    return this.src[this.pos] ?? ""
  }

  skipWs(): void {
    while (!this.eof() && /\s/.test(this.peek())) this.pos++
  }

  expectLiteral(lit: string): boolean {
    if (!this.src.startsWith(lit, this.pos)) return false
    this.pos += lit.length
    return true
  }

  parseName(): string | null {
    const start = this.pos
    if (!/[A-Za-z]/.test(this.peek())) return null
    this.pos++
    while (!this.eof() && /[-A-Za-z0-9_]/.test(this.peek())) this.pos++
    return this.src.slice(start, this.pos)
  }

  parseAttrs(allowed: Set<string>): Attrs | null {
    const attrs: Attrs = {}
    this.skipWs()
    while (!this.eof() && this.peek() !== ">" && this.peek() !== "/") {
      const name = this.parseName()
      if (!name) return null
      if (!allowed.has(name)) return null
      if (!this.expectLiteral("=")) return null
      const quote = this.peek()
      if (quote !== '"' && quote !== "'") return null
      this.pos++
      const vStart = this.pos
      while (!this.eof() && this.peek() !== quote) this.pos++
      if (this.eof()) return null
      const rawVal = this.src.slice(vStart, this.pos)
      this.pos++
      const decoded = decodeTextOnce(rawVal)
      if (decoded === null) return null
      if (name in attrs) return null
      attrs[name] = decoded
      this.skipWs()
    }
    return attrs
  }

  parseTextElement(tag: string): string | null {
    const open = `<${tag}>`
    if (!this.expectLiteral(open)) return null
    const start = this.pos
    const close = `</${tag}>`
    const closeIdx = this.src.indexOf(close, start)
    if (closeIdx < 0) return null
    const raw = this.src.slice(start, closeIdx)
    if (raw.includes("<")) return null
    const decoded = decodeTextOnce(raw)
    if (decoded === null) return null
    this.pos = closeIdx + close.length
    return decoded
  }

  parseElementWithAttrs(
    tag: string,
    allowedAttrs: Set<string>,
  ): { attrs: Attrs; innerStart: number; innerEnd: number } | null {
    if (!this.expectLiteral(`<${tag}`)) return null
    const attrs = this.parseAttrs(allowedAttrs)
    if (attrs === null) return null
    if (!this.expectLiteral(">")) return null
    const innerStart = this.pos
    const close = `</${tag}>`
    const closeIdx = this.src.indexOf(close, innerStart)
    if (closeIdx < 0) return null
    this.pos = closeIdx + close.length
    return { attrs, innerStart, innerEnd: closeIdx }
  }

  parseLeafWithAttr(tag: string, attrName: string): { text: string; attr: string } | null {
    if (!this.expectLiteral(`<${tag}`)) return null
    const attrs = this.parseAttrs(new Set([attrName]))
    if (attrs === null || !(attrName in attrs)) return null
    if (!this.expectLiteral(">")) return null
    const start = this.pos
    const close = `</${tag}>`
    const closeIdx = this.src.indexOf(close, start)
    if (closeIdx < 0) return null
    const raw = this.src.slice(start, closeIdx)
    if (raw.includes("<")) return null
    const decoded = decodeTextOnce(raw)
    if (decoded === null) return null
    this.pos = closeIdx + close.length
    return { text: decoded, attr: attrs[attrName] ?? "" }
  }
}

type ParsedEnvelope = {
  message: DriveMessage
  /** UTF-16 index in original wholeText immediately after root opening `>`. */
  rootOpenEnd: number
}

function parseEnvelopeInner(wholeText: string): Result<ParsedEnvelope, ParseFailure> {
  const { inner, lead } = trimOuterWs(wholeText)
  if (!inner.startsWith(`<${ROOT}`)) return err("not-envelope")

  const scan = new Scan(inner)
  if (!scan.expectLiteral(`<${ROOT}`)) return err("not-envelope")
  const rootAttrs = scan.parseAttrs(new Set(["version", "source"]))
  if (rootAttrs === null) return err("malformed")
  if (rootAttrs.version === undefined || rootAttrs.source === undefined) return err("malformed")
  if (rootAttrs.version !== KNOWN_VERSION) return err("unknown-version")
  if (rootAttrs.source !== "agent" && rootAttrs.source !== "system") return err("malformed")
  if (!scan.expectLiteral(">")) return err("malformed")
  const rootOpenEnd = lead + scan.pos

  const childrenStart = scan.pos
  const rootClose = `</${ROOT}>`
  const rootCloseIdx = inner.lastIndexOf(rootClose)
  if (rootCloseIdx < childrenStart) return err("malformed")
  const childrenSlice = inner.slice(childrenStart, rootCloseIdx)
  scan.pos = rootCloseIdx + rootClose.length
  scan.skipWs()
  if (!scan.eof()) return err("malformed")

  const childScan = new Scan(childrenSlice)
  childScan.skipWs()

  let context: DriveMessageContext | undefined
  if (childScan.expectLiteral("<context")) {
    const ctxAttrs = childScan.parseAttrs(new Set(["kind"]))
    if (ctxAttrs === null || ctxAttrs.kind === undefined) return err("malformed")
    if (ctxAttrs.kind !== "project-charter") return err("malformed")
    if (!childScan.expectLiteral(">")) return err("malformed")
    const tStart = childScan.pos
    const ctxClose = "</context>"
    const ctxCloseIdx = childrenSlice.indexOf(ctxClose, tStart)
    if (ctxCloseIdx < 0) return err("malformed")
    const rawCtx = childrenSlice.slice(tStart, ctxCloseIdx)
    if (rawCtx.includes("<")) return err("malformed")
    const ctxText = decodeTextOnce(rawCtx)
    if (ctxText === null) return err("malformed")
    childScan.pos = ctxCloseIdx + ctxClose.length
    context = { kind: "project-charter", text: ctxText }
    childScan.skipWs()
  }

  if (rootAttrs.source === "agent") {
    childScan.skipWs()
    const senderEl = childScan.parseElementWithAttrs("sender", new Set(["id"]))
    if (senderEl === null || senderEl.attrs.id === undefined) return err("malformed")
    const innerScan = new Scan(childrenSlice, senderEl.innerStart)
    innerScan.skipWs()
    let senderName: string | undefined
    const nameText = innerScan.parseTextElement("name")
    if (nameText !== null) senderName = nameText
    innerScan.skipWs()
    if (innerScan.pos !== senderEl.innerEnd) return err("malformed")

    childScan.skipWs()
    const body = childScan.parseTextElement("body")
    if (body === null) return err("malformed")
    childScan.skipWs()
    if (!childScan.eof()) return err("malformed")

    const message: DriveMessageAgent = {
      source: "agent",
      ...(context ? { context } : {}),
      sender: { id: senderEl.attrs.id, ...(senderName !== undefined ? { name: senderName } : {}) },
      body,
    }
    const validated = DriveMessageAgentSchema(message)
    if (validated instanceof type.errors) return err("malformed")
    return ok({ message, rootOpenEnd })
  }

  childScan.skipWs()
  const eventKind = childScan.parseTextElement("event-kind")
  if (eventKind !== "turn-ended" && eventKind !== "stall-suspected") return err("malformed")

  childScan.skipWs()
  const subjectEl = childScan.parseElementWithAttrs("subject-agent", new Set(["id"]))
  if (subjectEl === null || subjectEl.attrs.id === undefined) return err("malformed")
  const subInner = new Scan(childrenSlice, subjectEl.innerStart)
  subInner.skipWs()
  let subjectName: string | undefined
  const subName = subInner.parseTextElement("name")
  if (subName !== null) subjectName = subName
  subInner.skipWs()
  if (subInner.pos !== subjectEl.innerEnd) return err("malformed")

  childScan.skipWs()
  const atText = childScan.parseTextElement("at")
  if (atText === null) return err("malformed")
  const atNum = Number(atText)
  if (!Number.isSafeInteger(atNum) || atNum < 0) return err("malformed")

  let stopReason: string | undefined
  let silentMs: number | undefined
  let lastTurnError: { message: string } | undefined
  let lastAssistantText: { text: string; truncated: boolean } | undefined

  while (!childScan.eof()) {
    childScan.skipWs()
    if (childScan.eof()) break
    if (childScan.peek() === "<") {
      childScan.pos++
      const tag = childScan.parseName()
      if (tag === null) return err("malformed")
      childScan.pos -= tag.length + 1
      if (tag === "stop-reason") {
        if (stopReason !== undefined) return err("malformed")
        const v = childScan.parseTextElement("stop-reason")
        if (v === null) return err("malformed")
        stopReason = v
        continue
      }
      if (tag === "silent-ms") {
        if (silentMs !== undefined) return err("malformed")
        const v = childScan.parseTextElement("silent-ms")
        if (v === null) return err("malformed")
        const n = Number(v)
        if (!Number.isSafeInteger(n) || n < 0) return err("malformed")
        silentMs = n
        continue
      }
      if (tag === "last-turn-error") {
        if (lastTurnError !== undefined) return err("malformed")
        const el = childScan.parseElementWithAttrs("last-turn-error", new Set([]))
        if (el === null) return err("malformed")
        const errScan = new Scan(childrenSlice, el.innerStart)
        errScan.skipWs()
        const msg = errScan.parseTextElement("message")
        if (msg === null) return err("malformed")
        lastTurnError = { message: msg }
        continue
      }
      if (tag === "last-assistant-text") {
        if (lastAssistantText !== undefined) return err("malformed")
        const leaf = childScan.parseLeafWithAttr("last-assistant-text", "truncated")
        if (leaf === null) return err("malformed")
        if (leaf.attr !== "true" && leaf.attr !== "false") return err("malformed")
        lastAssistantText = { text: leaf.text, truncated: leaf.attr === "true" }
        continue
      }
    }
    return err("malformed")
  }

  const message: DriveMessageSystem = {
    source: "system",
    ...(context ? { context } : {}),
    eventKind,
    subjectAgent: {
      id: subjectEl.attrs.id,
      ...(subjectName !== undefined ? { name: subjectName } : {}),
    },
    at: atNum,
    ...(stopReason !== undefined ? { stopReason } : {}),
    ...(silentMs !== undefined ? { silentMs } : {}),
    ...(lastTurnError !== undefined ? { lastTurnError } : {}),
    ...(lastAssistantText !== undefined ? { lastAssistantText } : {}),
  }
  const validated = DriveMessageSystemSchema(message)
  if (validated instanceof type.errors) {
    return err("malformed")
  }
  return ok({ message, rootOpenEnd })
}

export function parseDriveMessage(wholeText: string): ParseResult {
  return parseEnvelopeInner(wholeText).map((p) => p.message)
}

function formatContext(ctx: DriveMessageContext): string {
  return `  <context kind="${encodeAttr(ctx.kind)}">${encodeText(ctx.text)}</context>\n`
}

function formatSender(id: string, name?: string): string {
  const nameLine = name !== undefined ? `    <name>${encodeText(name)}</name>\n` : ""
  return `  <sender id="${encodeAttr(id)}">\n${nameLine}  </sender>\n`
}

function formatSubject(id: string, name?: string): string {
  const nameLine = name !== undefined ? `    <name>${encodeText(name)}</name>\n` : ""
  return `  <subject-agent id="${encodeAttr(id)}">\n${nameLine}  </subject-agent>\n`
}

export function serializeDriveMessage(msg: DriveMessage): string {
  if (msg.source === "agent") {
    let out = `<${ROOT} version="${KNOWN_VERSION}" source="agent">\n`
    if (msg.context) out += formatContext(msg.context)
    out += formatSender(msg.sender.id, msg.sender.name)
    out += `  <body>${encodeText(msg.body)}</body>\n`
    out += `</${ROOT}>\n`
    return out
  }

  let out = `<${ROOT} version="${KNOWN_VERSION}" source="system">\n`
  if (msg.context) out += formatContext(msg.context)
  out += `  <event-kind>${encodeText(msg.eventKind)}</event-kind>\n`
  out += formatSubject(msg.subjectAgent.id, msg.subjectAgent.name)
  out += `  <at>${msg.at}</at>\n`
  if (msg.stopReason !== undefined) {
    out += `  <stop-reason>${encodeText(msg.stopReason)}</stop-reason>\n`
  }
  if (msg.silentMs !== undefined) {
    out += `  <silent-ms>${msg.silentMs}</silent-ms>\n`
  }
  if (msg.lastTurnError !== undefined) {
    out += `  <last-turn-error>\n    <message>${encodeText(msg.lastTurnError.message)}</message>\n  </last-turn-error>\n`
  }
  if (msg.lastAssistantText !== undefined) {
    const tr = msg.lastAssistantText.truncated ? "true" : "false"
    out += `  <last-assistant-text truncated="${tr}">${encodeText(msg.lastAssistantText.text)}</last-assistant-text>\n`
  }
  out += `</${ROOT}>\n`
  return out
}

export function insertEnvelopeContext(
  wholeText: string,
  context: DriveMessageContext,
): InsertContextResult {
  const parsed = parseEnvelopeInner(wholeText)
  if (parsed.isErr()) {
    if (parsed.error === "unknown-version" || parsed.error === "not-envelope") {
      return err("not-envelope")
    }
    return err("insert-unverified")
  }
  if (parsed.value.message.context !== undefined) return err("context-exists")

  const insertedText = `\n  <context kind="${encodeAttr(context.kind)}">${encodeText(context.text)}</context>`
  const offset = parsed.value.rootOpenEnd
  const text = wholeText.slice(0, offset) + insertedText + wholeText.slice(offset)
  const verify = parseDriveMessage(text)
  if (verify.isErr()) return err("insert-unverified")
  const v = verify.value
  if (v.context?.kind !== "project-charter" || v.context.text !== context.text) {
    return err("insert-unverified")
  }
  return ok({ text, offset, insertedText })
}
