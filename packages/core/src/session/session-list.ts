export type SessionListQuery = {
  cwd?: string
  cursor?: string
}

export type SessionListCapabilities = {
  list: boolean
  filterByCwd: boolean
  delete: boolean
}
