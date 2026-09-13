import { beUrl } from "$lib/util/be-url"

/** Range probe — 2xx means the fs-file proxy can serve the URI. */
export async function probeAudioFile(uri: string, signal: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(beUrl(`/api/fs/file?uri=${encodeURIComponent(uri)}`), {
      headers: { Range: "bytes=0-0" },
      signal,
    })
    return res.ok
  } catch {
    return false
  }
}
