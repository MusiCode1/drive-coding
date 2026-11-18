import type { NotifyKind, NotifyText } from "$lib/engines/notify.svelte"
import type { MessageKey } from "@drive-coding/core/i18n"

export function notifyTexts(t: (k: MessageKey) => string, kind: NotifyKind): NotifyText {
	switch (kind) {
		case "permission-request":
			return { title: t("notify.permission.title"), body: t("notify.permission.body") }
		case "elicitation":
			return { title: t("notify.elicitation.title"), body: t("notify.elicitation.body") }
		case "turn-end":
			return { title: t("notify.turnEnd.title"), body: t("notify.turnEnd.body") }
	}
}
