export type OpenedStream = {
  stream: MediaStream
  /** Resolved device; null means the system default. */
  deviceId: string | null
  /** true when exact deviceId failed and we opened with `{ audio: true }`. */
  fellBack: boolean
}

export async function enumerateAudioInputs(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return []
  }
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === "audioinput")
}

export function onDeviceChange(cb: () => void): () => void {
  const md = navigator.mediaDevices
  if (!md?.addEventListener) {
    return () => {}
  }
  md.addEventListener("devicechange", cb)
  return () => md.removeEventListener("devicechange", cb)
}

export async function openAudioStream(deviceId: string | null): Promise<OpenedStream> {
  const md = navigator.mediaDevices
  if (!md?.getUserMedia) {
    throw new Error("getUserMedia unavailable")
  }

  const openDefault = async (): Promise<OpenedStream> => {
    const stream = await md.getUserMedia({ audio: true })
    return { stream, deviceId: null, fellBack: false }
  }

  if (!deviceId) {
    return openDefault()
  }

  try {
    const stream = await md.getUserMedia({
      audio: { deviceId: { exact: deviceId } },
    })
    return { stream, deviceId, fellBack: false }
  } catch (firstErr) {
    const name =
      firstErr instanceof Error ? firstErr.name : "UnknownError"
    console.warn("openAudioStream: exact deviceId failed, falling back to default", {
      deviceId,
      errName: name,
    })
    try {
      const stream = await md.getUserMedia({ audio: true })
      return { stream, deviceId: null, fellBack: true }
    } catch (fallbackErr) {
      throw fallbackErr
    }
  }
}
