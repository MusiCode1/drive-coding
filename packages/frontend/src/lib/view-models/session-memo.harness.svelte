<script lang="ts">
  import { SessionMemoVM } from "./session-memo.svelte"

  let { reactive = false }: { reactive?: boolean } = $props()

  class MemoSource {
    agentId = $state<string | null>(null)
    sessionId = $state<string | null>(null)
    agentNotes = $state<string | undefined>(undefined)
  }

  export const source = new MemoSource()
  export const memo = new SessionMemoVM(reactive ? source : undefined)
</script>
