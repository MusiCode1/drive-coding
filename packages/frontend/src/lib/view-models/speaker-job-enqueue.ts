/**
 * speaker-job-enqueue.ts — create pending TTS jobs + enqueue observability ring.
 *
 * tts-model-choice: חילוץ מ-speaker.svelte.ts (#enqueue, tool job creation).
 */

import type { OrderKey } from "@drive-coding/core/voice/tts-queue"
import { safeUUID } from "$lib/util/uuid"
import type { TtsJob } from "./speaker.svelte"

export function createMessageThoughtJob(
  kind: "message" | "thought",
  messageId: string | null,
  text: string,
  bubbleId: string | undefined,
  orderKey: OrderKey,
): { job: TtsJob; bid: string } {
  const bid = bubbleId ?? messageId ?? safeUUID()
  const segmentId = safeUUID()
  return {
    bid,
    job: {
      segmentId,
      kind,
      messageId,
      text,
      status: "pending",
      abort: new AbortController(),
      bubbleId,
      orderKey,
    },
  }
}

export function createToolJob(bubbleId: string, toolCallId: string, orderKey: OrderKey): TtsJob {
  return {
    segmentId: safeUUID(),
    kind: "tool",
    messageId: null,
    text: "",
    status: "pending",
    abort: new AbortController(),
    bubbleId,
    toolCallId,
    orderKey,
  }
}

export function recordEnqueueObservability(
  recentTexts: string[],
  recentSources: string[],
  text: string,
  bubbleId: string | undefined,
): void {
  recentTexts.push(text.slice(0, 60))
  if (recentTexts.length > 8) recentTexts.shift()
  if (bubbleId !== undefined) {
    recentSources.push(bubbleId)
    if (recentSources.length > 8) recentSources.shift()
  }
}
