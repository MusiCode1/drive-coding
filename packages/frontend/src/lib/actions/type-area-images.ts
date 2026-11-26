import {
  fileToImageAttachment,
  type ImageAttachment,
  revokeAttachment,
} from "$lib/engines/image-attachment"

type Trays = Map<string, ImageAttachment[]>

export function imageHandlers(
  supportsImages: () => boolean,
  currentOwner: () => string,
  read: () => Trays,
  write: (trays: Trays) => void,
) {
  let disposed = false
  function update(owner: string, attachments: ImageAttachment[]) {
    const trays = new Map(read())
    if (attachments.length) trays.set(owner, attachments)
    else trays.delete(owner)
    write(trays)
  }

  async function processImageFile(file: File, owner: string) {
    try {
      const attachment = await fileToImageAttachment(file)
      if (disposed) revokeAttachment(attachment)
      else update(owner, [...(read().get(owner) ?? []), attachment])
    } catch {
      // Unsupported dimensions or compression failure.
    }
  }

  function processImageFiles(files: FileList) {
    const owner = currentOwner()
    for (const file of files) {
      if (file.type.startsWith("image/")) void processImageFile(file, owner)
    }
  }

  function clearAttachments(owner: string, captured: ImageAttachment[]) {
    const ids = new Set(captured.map(({ id }) => id))
    const keep = (read().get(owner) ?? []).filter((attachment) => {
      if (!ids.has(attachment.id)) return true
      revokeAttachment(attachment)
      return false
    })
    update(owner, keep)
  }

  return {
    handlePaste(event: ClipboardEvent) {
      if (!supportsImages()) return
      const owner = currentOwner()
      for (const item of event.clipboardData?.items ?? []) {
        if (item.kind !== "file" || !item.type.startsWith("image/")) continue
        const file = item.getAsFile()
        if (!file) continue
        event.preventDefault()
        void processImageFile(file, owner)
      }
    },
    handleDragOver(event: DragEvent) {
      if (supportsImages()) event.preventDefault()
    },
    handleDrop(event: DragEvent) {
      if (!supportsImages()) return
      event.preventDefault()
      if (event.dataTransfer?.files) processImageFiles(event.dataTransfer.files)
    },
    handleFileChange(event: Event) {
      if (!supportsImages()) return
      const input = event.currentTarget as HTMLInputElement
      if (!input.files) return
      processImageFiles(input.files)
      input.value = ""
    },
    removeAttachment: (attachment: ImageAttachment) =>
      clearAttachments(currentOwner(), [attachment]),
    clearAttachments,
    dispose() {
      disposed = true
      for (const attachments of read().values()) attachments.forEach(revokeAttachment)
      read().clear()
    },
  }
}
