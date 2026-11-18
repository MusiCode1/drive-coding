/** Combo open/focus decisions — pure helpers, testable without bits-ui DOM. */

export function shouldOpenOnFocus(value: string): boolean {
  return value.trim() === ""
}

export interface CwdComboUiState {
  query: string
  open: boolean
}

/** Arrow click / explicit open — resets search so the full recent list shows (§3ב). */
export function openFromArrow(): CwdComboUiState {
  return { query: "", open: true }
}

/** Typing in the in-menu search box — updates query only, not the bound cwd value. */
export function applyMenuSearchQuery(
  state: CwdComboUiState,
  newQuery: string,
): CwdComboUiState {
  return { ...state, query: newQuery }
}

/** Pick a path from the list — fills value, closes menu, clears search. */
export function applyPathSelection(path: string): { value: string; state: CwdComboUiState } {
  return {
    value: path,
    state: { query: "", open: false },
  }
}
