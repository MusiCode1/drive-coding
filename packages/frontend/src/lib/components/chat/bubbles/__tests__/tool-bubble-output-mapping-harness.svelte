<script lang="ts">
import { setChatScroll, setContentViewer, setI18n, setSettings } from "$lib/context"
import type { ToolBubble as ToolBubbleType } from "$lib/types/bubble"
import type { ChatScrollBridge } from "$lib/types/chat-scroll"
import type { ToolOutputFieldPaths } from "$lib/types/tool-output"
import type { ContentViewerVM, ViewerPayload } from "$lib/view-models/content-viewer.svelte"
import type { I18nVM } from "$lib/view-models/i18n.svelte"
import type { Settings } from "$lib/view-models/settings.svelte"
import ToolBubble from "../ToolBubble.svelte"

let {
  bubble,
  outputMapping,
}: {
  bubble: ToolBubbleType
  outputMapping?: ToolOutputFieldPaths
} = $props()

const fakeI18n = { t: (key: string) => key } as unknown as I18nVM
const fakeSettings = { showTools: true } as unknown as Settings
const fakeViewer = {
  payload: null,
  open: false,
  show: (_payload: ViewerPayload) => {},
  close: () => {},
} as unknown as ContentViewerVM
const fakeChatScroll = {
  scrollEl: null,
  handle: null,
  noteUserIntent: () => {},
} as unknown as ChatScrollBridge

setI18n(fakeI18n)
setSettings(fakeSettings)
setContentViewer(fakeViewer)
setChatScroll(fakeChatScroll)
</script>

<ToolBubble {bubble} {outputMapping} />
