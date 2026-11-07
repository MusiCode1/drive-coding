<script lang="ts">
  import { getI18n } from "$lib/context"
  import {
    defaultPermissionOptionId,
    mapPermissionOptions,
    type PermissionParams,
  } from "$lib/types/permission"
  import type { Snippet } from "svelte"

  let {
    headerTitle,
    params,
    submitting = false,
    onResolve,
    onCancel,
    body,
  }: {
    headerTitle: string
    params: PermissionParams
    submitting?: boolean
    onResolve: (optionId: string) => void
    onCancel: () => void
    body: Snippet
  } = $props()

  const t = getI18n().t
  const options = $derived(mapPermissionOptions(params))
  const defaultOptionId = $derived(defaultPermissionOptionId(options))

  const LABEL_KEY = {
    allow_once: "permission.allowOnce",
    allow_always: "permission.allowAlways",
    reject_once: "permission.reject",
    reject_always: "permission.reject",
  } as const

  function isReject(kind: string): boolean {
    return kind.startsWith("reject")
  }

  function handleSelect(optionId: string): void {
    if (submitting) return
    onResolve(optionId)
  }

  function handleCancel(): void {
    if (submitting) return
    onCancel()
  }
</script>

<div class="permission-block" role="alertdialog" aria-live="assertive">
  <div class="header">
    <span class="title">{headerTitle}</span>
    <button
      class="close-btn"
      onclick={handleCancel}
      disabled={submitting}
      aria-label={t("permission.reject")}
    >
      ✕
    </button>
  </div>

  {@render body()}

  <div class="status">{t("permission.pending")}</div>

  <div class="actions">
    {#each options as opt (opt.optionId)}
      <button
        class="btn"
        class:allow={!isReject(opt.kind)}
        class:reject={isReject(opt.kind)}
        class:is-default={opt.optionId === defaultOptionId}
        disabled={submitting}
        onclick={() => handleSelect(opt.optionId)}
      >
        {t(LABEL_KEY[opt.kind])}
      </button>
    {/each}
  </div>
</div>

<style>
  .permission-block {
    border-radius: 0.75rem;
    border: 1px solid var(--accent);
    background: var(--bg-card);
    padding: 0.6rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-width: 0;
    flex: 1;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .title {
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--accent-hi, var(--accent));
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--fg-dim);
    cursor: pointer;
    font-size: 0.8rem;
    line-height: 1;
    padding: 0.15rem 0.3rem;
    border-radius: 4px;
  }
  .close-btn:hover:not(:disabled) {
    background: var(--bg);
  }
  .close-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .status {
    font-size: 0.72rem;
    opacity: 0.65;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.2rem;
  }

  .btn {
    border-radius: 0.5rem;
    padding: 0.35rem 0.75rem;
    font-size: 0.8rem;
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .btn.allow {
    border-color: var(--accent);
    color: var(--accent-hi, var(--accent));
  }
  .btn.allow.is-default {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }

  .btn.reject {
    border-color: var(--recording);
    color: var(--recording);
  }
</style>
