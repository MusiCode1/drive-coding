/**
 * orchestrator.ts — Voice orchestration engine (Phase 3).
 *
 * Subscribes to ACP sessionUpdate notifications via agentSession.
 * Accumulates text streams, splits into sentences, enqueues TTS jobs.
 * Manages prefetch with lookahead=2.
 * Handles AbortController per in-flight fetch, cancels on jump.
 *
 * opencode thought-only pattern (learnings 2026-05-13):
 *   opencode sometimes emits only thought chunks (no message chunks).
 *   Thoughts are handled identically to messages for TTS.
 */

import { splitIntoSentences } from "@drive-coding/core/voice/sentence-boundary"
import { createLogger } from "$lib/log"
import type { AgentSessionPublic } from "$lib/stores/agent-session.svelte"
import type { createPlayerStore } from "$lib/stores/player.svelte"
import type { AudioStream } from "./audio-stream"
import { narrate } from "./narrate-client"
import { translate } from "./translate-client"
import { synthesizeStreaming } from "./tts-client"

const log = createLogger("fe.orchestrator")

const PREFETCH_LOOKAHEAD = 2

export type TtsJobStatus = "pending" | "fetching" | "ready" | "playing" | "done" | "failed"

export type TtsJob = {
  segmentId: string
  kind: "message" | "thought" | "narration"
  text: string
  messageId: string | null
  status: TtsJobStatus
  abort: AbortController | null
}

export type OrchestratorDeps = {
  agentSession: AgentSessionPublic
  player: ReturnType<typeof createPlayerStore>
  audioStream: AudioStream
  getVoiceId: () => string
}

export function createVoiceOrchestrator(deps: OrchestratorDeps) {
  const { agentSession, player, audioStream } = deps

  // Per-prompt accumulators
  let messageBuffer = ""
  let thoughtBuffer = ""
  let currentMessageId: string | null = null
  let currentThoughtId: string | null = null
  const recentMessages: string[] = [] // FIFO max 3
  let userMessage = ""

  // TTS job queue (parallel to player.playlist)
  const sentenceQueue: TtsJob[] = []

  // Playback loop running
  let playbackRunning = false

  // ── ACP notification handler ────────────────────────────────────────────────

  function handleNotification(raw: string): void {
    let n: Record<string, unknown>
    try {
      n = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }

    const type = n.type as string | undefined

    switch (type) {
      case "agent_message_chunk": {
        if (thoughtBuffer.length > 0) flushThought()
        if (!currentMessageId) currentMessageId = (n.messageId as string) ?? crypto.randomUUID()
        messageBuffer += (n.text as string) ?? ""
        const { sentences, remaining } = splitIntoSentences(messageBuffer)
        messageBuffer = remaining
        for (const s of sentences) {
          enqueueSentence("message", s, currentMessageId)
        }
        break
      }

      case "agent_thought_chunk": {
        if (messageBuffer.length > 0) flushMessage()
        if (!currentThoughtId) currentThoughtId = (n.messageId as string) ?? crypto.randomUUID()
        thoughtBuffer += (n.text as string) ?? ""
        const { sentences, remaining } = splitIntoSentences(thoughtBuffer)
        thoughtBuffer = remaining
        for (const s of sentences) {
          enqueueSentence("thought", s, currentThoughtId)
        }
        break
      }

      case "tool_call": {
        flushMessage()
        flushThought()
        const toolCallId = (n.toolCallId as string) ?? crypto.randomUUID()
        const title = (n.title as string) ?? ""
        const kind = n.kind as string | undefined
        enqueueNarration(toolCallId, title, kind)
        break
      }

      case "done":
      case "end_turn": {
        // Flush any remaining buffers
        flushMessage()
        flushThought()
        // Track last response for replayLast
        if (recentMessages.length >= 3) recentMessages.shift()
        if (messageBuffer || thoughtBuffer) {
          // already flushed above
        }
        break
      }

      case "stt_partial": {
        // Update user message for narration context
        userMessage = (n.text as string) ?? userMessage
        break
      }
    }
  }

  function flushMessage(): void {
    if (messageBuffer.trim().length > 0 && currentMessageId) {
      enqueueSentence("message", messageBuffer.trim(), currentMessageId)
    }
    messageBuffer = ""
  }

  function flushThought(): void {
    if (thoughtBuffer.trim().length > 0 && currentThoughtId) {
      enqueueSentence("thought", thoughtBuffer.trim(), currentThoughtId)
    }
    thoughtBuffer = ""
  }

  // ── Queue management ────────────────────────────────────────────────────────

  function enqueueSentence(kind: "message" | "thought", text: string, messageId: string): void {
    if (text.trim().length === 0) return
    const segmentId = crypto.randomUUID()
    player.addSegment(segmentId, kind, messageId)
    sentenceQueue.push({ kind, text, segmentId, messageId, status: "pending", abort: null })
    pumpQueue()
  }

  function enqueueNarration(toolCallId: string, title: string, toolKind?: string): void {
    const segmentId = crypto.randomUUID()
    player.addSegment(segmentId, "narration", null)

    const job: TtsJob = {
      kind: "narration",
      text: title, // will be replaced by narrate() result
      segmentId,
      messageId: null,
      status: "pending",
      abort: null,
    }
    sentenceQueue.push(job)

    // Fetch narration text first, then proceed via pumpQueue
    const ac = new AbortController()
    job.abort = ac
    job.status = "fetching"

    narrate({
      userMessage,
      recentMessages: [...recentMessages],
      tool: { toolCallId, title, kind: toolKind },
      signal: ac.signal,
    })
      .then((text) => {
        if (job.status === "fetching") {
          job.text = text
          job.status = "pending"
          job.abort = null
          pumpQueue()
        }
      })
      .catch(() => {
        if (job.status === "fetching") {
          job.text = title // fallback
          job.status = "pending"
          job.abort = null
          pumpQueue()
        }
      })
  }

  // ── Prefetch policy (lookahead=2) ───────────────────────────────────────────

  function pumpQueue(): void {
    const playing = Math.max(0, player.currentIndex)
    const target = Math.min(playing + PREFETCH_LOOKAHEAD, sentenceQueue.length - 1)

    for (let i = playing; i <= target; i++) {
      const job = sentenceQueue[i]
      if (!job || job.status !== "pending") continue
      job.status = "fetching"
      fetchSegment(job).catch((err: unknown) => {
        const e = err as Error
        if (e.name !== "AbortError" && !e.message?.includes("AbortError")) {
          log.warn({ err: e.message, segmentId: job.segmentId.slice(0, 8) }, "tts fetch failed")
        }
      })
    }

    // Start playback loop if not running
    if (
      !playbackRunning &&
      sentenceQueue.some(
        (j) => j.status === "ready" || j.status === "fetching" || j.status === "pending",
      )
    ) {
      startPlaybackLoop()
    }
  }

  async function fetchSegment(job: TtsJob): Promise<void> {
    const ac = new AbortController()
    job.abort = ac

    try {
      // 1. Translate text to Hebrew
      const translated = await translate(job.text, "he", ac.signal)
      if (translated === null || ac.signal.aborted) {
        job.status = "failed"
        return
      }

      // 2. TTS streaming
      const stream = await synthesizeStreaming({
        text: translated,
        voiceId: deps.getVoiceId(),
        signal: ac.signal,
      })

      // 3. Attach stream to AudioStream (prepare MediaSource)
      await audioStream.prepareSegment(job.segmentId, stream, ac)

      if (!ac.signal.aborted) {
        job.status = "ready"
        // Kick playback loop
        if (!playbackRunning) {
          startPlaybackLoop()
        }
      }
    } catch (e) {
      if (job.status !== "done") {
        job.status = "failed"
      }
      throw e
    } finally {
      if (job.abort === ac) {
        job.abort = null
      }
    }
  }

  // ── Playback loop ───────────────────────────────────────────────────────────

  async function startPlaybackLoop(): Promise<void> {
    if (playbackRunning) return
    playbackRunning = true

    try {
      while (true) {
        // Find next segment to play
        const nextIdx = findNextToPlay()
        if (nextIdx < 0) break

        const job = sentenceQueue[nextIdx]
        if (!job) break

        // Wait for ready
        if (job.status === "fetching" || job.status === "pending") {
          await waitForJobReady(job)
        }

        if (job.status === "failed" || job.status === "done") {
          // Skip failed segments — advance to next
          player.advance()
          continue
        }

        if (job.status !== "ready") break

        job.status = "playing"
        // Update player index to this segment
        player.jumpToSegment(job.segmentId)

        try {
          await audioStream.play(job.segmentId)
          job.status = "done"
        } catch (_e) {
          // MIN-5: play rejected (cancelled/error) → skip to next
          job.status = "failed"
        }

        player.advance()
        pumpQueue()
      }
    } finally {
      playbackRunning = false
    }
  }

  function findNextToPlay(): number {
    // Find first segment that hasn't been played/failed yet
    for (let i = 0; i < sentenceQueue.length; i++) {
      const job = sentenceQueue[i]
      if (
        job &&
        (job.status === "pending" || job.status === "fetching" || job.status === "ready")
      ) {
        return i
      }
    }
    return -1
  }

  function waitForJobReady(job: TtsJob): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (job.status !== "fetching" && job.status !== "pending") {
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      check()
    })
  }

  // ── Jump handling ───────────────────────────────────────────────────────────

  player.onJump((newIndex) => {
    // Cancel all in-flight fetches for segments after newIndex
    for (let i = newIndex + 1; i < sentenceQueue.length; i++) {
      const job = sentenceQueue[i]
      if (job && job.status === "fetching") {
        job.abort?.abort()
        job.abort = null
        job.status = "pending" // reset for re-fetch
        audioStream.cancel(job.segmentId)
      }
    }
    pumpQueue()
  })

  player.onAdvance(() => {
    pumpQueue()
  })

  // ── Cancel all ──────────────────────────────────────────────────────────────

  function cancelAll(): void {
    for (const job of sentenceQueue) {
      if (job.status === "fetching") {
        job.abort?.abort()
        job.abort = null
      }
      audioStream.cancel(job.segmentId)
    }
    sentenceQueue.length = 0
    playbackRunning = false
    messageBuffer = ""
    thoughtBuffer = ""
    currentMessageId = null
    currentThoughtId = null
  }

  function reset(): void {
    cancelAll()
    audioStream.clear()
  }

  // ── Update user message ─────────────────────────────────────────────────────

  function setUserMessage(text: string): void {
    userMessage = text
    // Update recentMessages when a new user prompt is sent
    if (text) {
      if (recentMessages.length >= 3) recentMessages.shift()
      recentMessages.push(text)
    }
  }

  // ── Register handler on agentSession ────────────────────────────────────────
  // Phase 3: voice orchestrator subscribes to ACP sessionUpdate notifications
  // via the voiceMessageHandler delegate on agentSession.
  agentSession.setVoiceMessageHandler(handleNotification)

  return {
    handleNotification,
    cancelAll,
    reset,
    setUserMessage,
    get sentenceQueue() {
      return sentenceQueue
    },
  }
}
