<script lang="ts">
/**
 * CwdPathComboRow — שורת-תוצאה אחת בדרופדאון חיפוש-הנתיב.
 *
 * חולצה מ-CwdPathCombo כמס-חילוץ (הקובץ מעל תקציב-השכבה, ר' AGENTS.md).
 * 🛑 כל ה-CSS של השורה עבר לכאן יחד עם ה-markup — scoped styles של Svelte
 * אינם חוצים גבול-קומפוננטה, ולכן השארתם מאחור הייתה מפילה את העיצוב בשקט.
 */
import type { RecentProject } from "$lib/adapters/recent-projects"
import { getI18n } from "$lib/context"
import { formatRelativeTime } from "$lib/util/formatting"
import { basename } from "$lib/util/path"

interface Props {
  project: RecentProject
  onPick: (project: RecentProject) => void
}

const { project, onPick }: Props = $props()
const i18n = getI18n()
const t = i18n.t
</script>

<button type="button" class="combo-item" onclick={() => onPick(project)}>
  <div class="combo-item-top">
    <span class="combo-basename" title={project.cwd}><bdi>{basename(project.cwd)}</bdi></span>
    {#if project.lastSeen}
      <span class="combo-sep">·</span>
      <span class="combo-time">
        {formatRelativeTime(new Date(project.lastSeen).getTime(), i18n.locale)}
      </span>
    {/if}
    {#if project.sessionCount}
      <span class="combo-sep">·</span>
      <span class="combo-sessions">
        {project.sessionCount}
        {t("connect.cwd.combo.sessionCount")}
      </span>
    {/if}
  </div>
  <div class="combo-path" title={project.cwd} dir="ltr"><bdi>{project.cwd}</bdi></div>
</button>

<style>
  .combo-item {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.55rem 0.5rem;
    background: transparent;
    border: none;
    border-radius: 0.5rem;
    cursor: pointer;
    text-align: start;
  }

  .combo-item:hover {
    background: var(--bg-hover, rgba(127, 127, 127, 0.08));
  }

  .combo-item-top {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem;
    font-size: 0.82rem;
  }

  .combo-basename {
    color: var(--fg);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 0 1 auto;
    min-width: 0;
  }

  .combo-basename > :global(bdi),
  .combo-path > :global(bdi) {
    direction: ltr;
  }

  .combo-sep {
    color: var(--fg-dim);
    opacity: 0.5;
  }

  .combo-time {
    direction: ltr;
    flex-shrink: 0;
    color: var(--fg-dim);
    font-size: 0.72rem;
  }

  .combo-sessions {
    flex-shrink: 0;
    color: var(--fg-dim);
    font-size: 0.72rem;
  }

  .combo-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.72rem;
    color: var(--fg-dim);
    min-width: 0;
  }
</style>
