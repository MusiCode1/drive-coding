/** CLI `agent open` POST body fields — extracted to keep cli/index.ts within size budget. */
export type OpenCliValues = {
  permission?: string
  parent?: string
  "close-on-turn-end"?: boolean
  "system-prompt"?: string
  "role-label"?: string
}

export function buildOpenPostBody(
  cliKind: string,
  cwd: string,
  env: Record<string, string>,
  values: OpenCliValues,
): Record<string, unknown> {
  return {
    cliKind,
    cwd,
    env,
    ...(values.permission ? { permissionPolicy: values.permission } : {}),
    ...(values.parent ? { parentAgentId: values.parent } : {}),
    ...(values["close-on-turn-end"] ? { closeOnTurnEnd: true } : {}),
    ...(values["system-prompt"] !== undefined ? { systemPrompt: values["system-prompt"] } : {}),
    ...(values["role-label"] !== undefined && values["role-label"] !== ""
      ? { roleLabel: values["role-label"] }
      : {}),
  }
}
