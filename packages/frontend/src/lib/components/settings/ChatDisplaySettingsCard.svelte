<script lang="ts">
  import { getI18n, getSettings } from "$lib/context"
  import SettingsCard from "./SettingsCard.svelte"
  import SettingToggle from "./SettingToggle.svelte"

  const settings = getSettings()
  const t = getI18n().t
</script>

<SettingsCard title={t("settings.chatDisplay")}>
  <div class="flex flex-col">
    <SettingToggle
      label={t("settings.toggle.showThoughts")}
      checked={settings.showThoughts}
      disabled={settings.compactActivity}
      onCheckedChange={(v) => settings.setShowThoughts(v)}
    />
    <SettingToggle
      label={t("settings.toggle.showTools")}
      checked={settings.showTools}
      disabled={settings.compactActivity}
      onCheckedChange={(v) => settings.setShowTools(v)}
    />
    <SettingToggle
      label={t("settings.toggle.compactActivity")}
      checked={settings.compactActivity}
      onCheckedChange={(v) => settings.setCompactActivity(v)}
    />
    <SettingToggle
      label={t("settings.toggle.sessionMemo")}
      checked={settings.showSessionMemo}
      onCheckedChange={(v) => settings.setShowSessionMemo(v)}
    />
    <SettingToggle
      label={t("settings.toggle.autoLoadRemoteImages")}
      checked={settings.autoLoadRemoteImages}
      onCheckedChange={(v) => settings.setAutoLoadRemoteImages(v)}
    />
    <SettingToggle
      label={t("settings.toggle.enterToSend")}
      checked={settings.enterToSend}
      onCheckedChange={(v) => settings.setEnterToSend(v)}
    />
  </div>
</SettingsCard>
