import {
  mergeMedia,
  mediaRefsFromUpdateMeta,
  type DriveMediaRef,
} from "@drive-coding/core/fs/media-catalog"

/** FE-side accumulator for `_drive/media` rows from session/update _meta. */
export class MediaCatalogStore {
  #rows: DriveMediaRef[] = []

  get catalog(): DriveMediaRef[] {
    return this.#rows
  }

  mergeFromUpdate(update: Record<string, unknown>): void {
    const incoming = mediaRefsFromUpdateMeta(update)
    if (incoming.length > 0) {
      this.#rows = mergeMedia(this.#rows, incoming)
    }
  }
}
