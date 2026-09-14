/** Named-pipe transport stub — not verified on Windows. */
export function createNamedPipeTransport(_path: string): never {
  throw new Error("named-pipe: not verified on Windows")
}
