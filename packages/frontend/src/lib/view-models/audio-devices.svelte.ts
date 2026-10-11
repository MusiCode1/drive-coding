import {
  enumerateAudioInputs,
  onDeviceChange,
  openAudioStream,
} from "../adapters/audio-devices"
import type { Settings } from "./settings.svelte"

export class AudioDevicesVM {
  inputs: MediaDeviceInfo[] = $state([])
  /** true when labels are empty and the user must grant mic access to see names. */
  needsPermissionForLabels = $state(false)
  loading = $state(false)

  readonly #settings: Settings

  constructor(opts: { settings: Settings }) {
    this.#settings = opts.settings

    $effect(() => {
      const unsub = onDeviceChange(() => {
        void this.refresh()
      })
      return unsub
    })
  }

  /** Preference when listed; otherwise null (system default). */
  get effectiveInputId(): string | null {
    const pref = this.#settings.inputDeviceId
    if (!pref) return null
    return this.inputs.some((d) => d.deviceId === pref) ? pref : null
  }

  /** enumerateDevices only — does not turn on the mic indicator. */
  refresh = async (): Promise<void> => {
    this.loading = true
    try {
      const list = await enumerateAudioInputs()
      this.inputs = list
      this.needsPermissionForLabels =
        list.length > 0 && list.every((d) => d.label.trim() === "")
    } finally {
      this.loading = false
    }
  }

  /** Short getUserMedia then refresh — only from an explicit user action. */
  primeLabels = async (): Promise<void> => {
    const opened = await openAudioStream(null)
    for (const t of opened.stream.getTracks()) {
      t.stop()
    }
    await this.refresh()
  }

  select(id: string | null): void {
    if (id === null) {
      this.#settings.setInputDevice(null, "")
      return
    }
    const dev = this.inputs.find((d) => d.deviceId === id)
    const label = dev?.label?.trim() ? dev.label : id.slice(0, 8)
    this.#settings.setInputDevice(id, label)
  }
}
