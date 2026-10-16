/** Shared setup-epoch helpers for Connection owners (B4 late-setup guards). */

export type SetupEpoch = number

export function nextSetupEpoch(current: SetupEpoch): SetupEpoch {
  return current + 1
}

export function isSetupLive(epoch: SetupEpoch, liveEpoch: SetupEpoch): boolean {
  return epoch === liveEpoch
}
