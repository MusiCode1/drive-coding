import type { Bubble, ThoughtSegment, ToolCall } from "$lib/types/bubble"
import type { AgentSessionStatus, TurnState } from "./agent-session.svelte"
import type { TranscriptScope } from "./transcript-scope.svelte"

declare const annotationTargetBrand: unique symbol
export type AnnotationTarget = { readonly [annotationTargetBrand]: true }
declare const processingTargetBrand: unique symbol
export type TranscriptProcessingTarget = { readonly [processingTargetBrand]: true }
export type ThoughtSource = { readonly id: string; readonly originalText: string }
type SpeakerReadSegment = Readonly<Pick<ThoughtSegment, "id" | "text" | "originalText">>
type SpeakerReadToolCall = Readonly<
  Pick<ToolCall, "toolCallId" | "status" | "narration" | "kind" | "title" | "name">
>
export type SpeakerReadBubble = Readonly<Pick<Bubble, "id" | "messageId">> &
  (
    | { readonly kind: "user" }
    | { readonly kind: "message" | "thought"; readonly segments: readonly SpeakerReadSegment[] }
    | { readonly kind: "tool"; readonly toolCall: SpeakerReadToolCall }
  )
type SpeakerHistoryMark = {
  readonly segmentCounts: ReadonlyMap<string, number>
  readonly toolCallIds: readonly string[]
}
export type SpeakerHistorySnapshot = {
  readonly mark: SpeakerHistoryMark
  readonly processingTarget: TranscriptProcessingTarget | null
}
export type SpeakerTranscriptControl = {
  status: () => AgentSessionStatus
  turnState: () => TurnState
  isLoadingHistory: () => boolean
  historyEpoch: () => number
  historyMark: () => SpeakerHistorySnapshot
  lastUserMessage: () => string
}
export type SpeakerTranscriptPort = {
  readonly status: AgentSessionStatus
  readonly turnState: TurnState
  readonly bubbles: readonly SpeakerReadBubble[]
  readonly processingTarget: TranscriptProcessingTarget
  readonly isLoadingHistory: boolean
  readonly historyEpoch: number
  readonly historyMark: SpeakerHistorySnapshot
  readonly lastUserMessage: string
  recentAssistantMessages(n?: number): string[]
  captureTarget(): AnnotationTarget
  isCurrent(target: AnnotationTarget): boolean
  writeToolNarration(
    target: AnnotationTarget,
    bubbleId: string,
    toolCallId: string,
    toolKind: string | undefined,
    text: string,
  ): boolean
  writeThoughtTranslation(
    target: AnnotationTarget,
    bubbleId: string,
    segmentIndex: number,
    source: ThoughtSource,
    original: string,
    translated: string,
  ): boolean
}

export function createSpeakerTranscriptPort(
  transcript: TranscriptScope,
  control: SpeakerTranscriptControl,
): SpeakerTranscriptPort {
  return {
    get status() {
      return control.status()
    },
    get turnState() {
      return control.turnState()
    },
    get bubbles() {
      return transcript.bubbles
    },
    get processingTarget() {
      return transcript.captureProcessingTarget()
    },
    get isLoadingHistory() {
      return control.isLoadingHistory()
    },
    get historyEpoch() {
      return control.historyEpoch()
    },
    get historyMark() {
      return control.historyMark()
    },
    get lastUserMessage() {
      return control.lastUserMessage()
    },
    recentAssistantMessages: (n) => transcript.recentAssistantMessages(n),
    captureTarget: () => transcript.captureAnnotationTarget(),
    isCurrent: (target) => transcript.isAnnotationTargetCurrent(target),
    writeToolNarration: (target, bubbleId, toolCallId, toolKind, text) =>
      transcript.writeToolNarration(target, bubbleId, toolCallId, toolKind, text),
    writeThoughtTranslation: (target, bubbleId, segmentIndex, source, original, translated) =>
      transcript.writeThoughtTranslation(
        target,
        bubbleId,
        segmentIndex,
        source,
        original,
        translated,
      ),
  }
}
