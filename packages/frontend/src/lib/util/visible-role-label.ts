/** Display-only role label — empty/undefined treated as absent (slice agent-role-label C3). */
export function visibleRoleLabel(roleLabel: string | undefined): string | undefined {
  return roleLabel && roleLabel !== "" ? roleLabel : undefined
}
