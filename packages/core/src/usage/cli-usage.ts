/** Pure cycle aggregates — shared by BE aggregation and FE token-usage adapter. */

type CycleLike = { readonly peakUsed: number }

export const compactionsFromCycles = (c: readonly CycleLike[]): number => Math.max(0, c.length - 1)

export const sumOfCyclePeaks = (c: readonly CycleLike[]): number =>
  c.reduce((s, x) => s + x.peakUsed, 0)

export const peakOfCycles = (c: readonly CycleLike[]): number =>
  c.reduce((m, x) => Math.max(m, x.peakUsed), 0)
