/**
 * Local `<details>` open flag that re-applies when `read()` changes.
 * Not `$derived` — a single bubble stays manually toggleable.
 */
export function settingBackedOpen(read: () => boolean): {
  get value(): boolean
  set value(v: boolean): void
} {
  let open = $state(read())
  $effect(() => {
    open = read()
  })
  return {
    get value() {
      return open
    },
    set value(v: boolean) {
      open = v
    },
  }
}
