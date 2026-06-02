<script lang="ts">
/**
 * /settings — מסך הגדרות (redesign-3).
 * Route דק: רק AppShell + SettingsScreen.
 *
 * ─── settings-redesign (redesign-3) ───
 */
import AppShell from "$lib/components/layout/AppShell.svelte"
import SettingsScreen from "$lib/components/settings/SettingsScreen.svelte"
</script>

<!-- AppShell ללא onDisconnect → disconnect icon מוסתר ב-AppHeader -->
<AppShell>
  <SettingsScreen />
</AppShell>
