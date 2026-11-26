import type { PromptBlocks } from "@drive-coding/provider/client"
import { type } from "arktype"

const promptImage = type({ mimeType: "string", dataBase64: "string" })
export const promptPayloadSchema = type({
  text: "string",
  attachments: promptImage.array(),
  "recordingId?": "string",
})
export type PromptPayload = typeof promptPayloadSchema.infer

export function promptPayload(
  text: string,
  attachments: ReadonlyArray<PromptPayload["attachments"][number]> = [],
  recordingId?: string,
): PromptPayload {
  return {
    text,
    attachments: attachments.map(({ mimeType, dataBase64 }) => ({ mimeType, dataBase64 })),
    ...(recordingId === undefined ? {} : { recordingId }),
  }
}

export function buildPrompt(payload: PromptPayload) {
  const { text, attachments, recordingId } = payload
  const content: PromptBlocks = [
    ...(text.trim() ? [{ type: "text" as const, text }] : []),
    ...attachments.map(({ mimeType, dataBase64 }) => ({
      type: "image" as const,
      mimeType,
      data: dataBase64,
    })),
  ]
  return { content, meta: recordingId === undefined ? undefined : { recordingId } }
}

export function hasPromptContent({ text, attachments }: PromptPayload): boolean {
  return !!text.trim() || attachments.length > 0
}

const ownerTuple = type(["string > 0", "string > 0", "string > 0"])

export function promptOwner(backendBaseUrl: string, cliKind: string, sessionId: string): string {
  return JSON.stringify([backendBaseUrl, cliKind, sessionId])
}

export function parsePromptOwner(owner: string) {
  const parsed: unknown = JSON.parse(owner)
  const value = ownerTuple.assert(parsed)
  if (promptOwner(...value) !== owner) throw new Error("Invalid prompt owner")
  return { backendBaseUrl: value[0], cliKind: value[1], sessionId: value[2] }
}
