<script lang="ts">
/**
 * LoadingModal — מודאל ספינר לטעינת-סשן (ui-session-polish fix5).
 *
 * prop-driven (reusable): open + label אופציונלי.
 * נסגר כש-open הופך ל-false (לא סגיר ידנית — אין X).
 * שלד bits-ui מ-FolderPickerDialog; onOpenChange=no-op (מודאל-blocking).
 */
import { Dialog as BitsDialog } from "bits-ui"
import Loader2Icon from "@lucide/svelte/icons/loader-2"
import { getI18n } from "$lib/context"

const t = getI18n().t

let { open, label }: { open: boolean; label?: string } = $props()
</script>

<BitsDialog.Root {open} onOpenChange={() => {}}>
  <BitsDialog.Portal>
    <BitsDialog.Overlay
      class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
    />
    <BitsDialog.Content
      class="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div
        class="flex flex-col items-center gap-4 rounded-2xl px-8 py-6"
        style="background:var(--bg-elev); border:1px solid var(--border)"
      >
        <Loader2Icon size={32} class="animate-spin" style="color:var(--accent)" />
        <span class="text-sm" style="color:var(--fg-dim)">
          {label ?? t("modal.loading.session")}
        </span>
      </div>
    </BitsDialog.Content>
  </BitsDialog.Portal>
</BitsDialog.Root>
