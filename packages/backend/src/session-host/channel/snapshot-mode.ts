export type SnapshotMode = "full" | "meta"

export function parseSnapshotMode(value: string | undefined): SnapshotMode | "invalid" {
  if (value === undefined || value === "") return "full"
  if (value === "full" || value === "meta") return value
  return "invalid"
}
