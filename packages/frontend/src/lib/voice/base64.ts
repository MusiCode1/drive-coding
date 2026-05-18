/**
 * base64.ts — chunked Uint8Array → base64 conversion.
 *
 * MED-5 (audit): btoa(String.fromCharCode(...bytes)) throws "Maximum call stack size exceeded"
 * for audio > ~100KB because of spread operator stack overflow.
 * Hebrew voice notes are 30-300KB — right in the danger zone.
 *
 * Solution: process in 8192-byte chunks.
 */

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}
