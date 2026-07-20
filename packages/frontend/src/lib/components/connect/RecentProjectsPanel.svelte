<script lang="ts">
/**
 * RecentProjectsPanel — ווידג'ט "תיקיות אחרונות" בטופס החיבור.
 *
 * מציג את התיקיות שנפתחו לאחרונה מ-GET /api/projects.
 * לחיצה על שורה → קריאה ל-onSelect(project) → החיבור מנוהל ב-+page.svelte.
 *
 * slice: connect-recent-projects
 * דפוס: חיקוי ActiveProcessesPanel (אחידות ויזואלית).
 */
import type { RecentProject } from "$lib/adapters/recent-projects"
import { getRecentProjects, getI18n, getSettings } from "$lib/context"
import { formatRelativeTime } from "$lib/util/formatting"
import { basename } from "$lib/util/path"
import { onMount } from "svelte"

interface Props {
  onSelect: (project: RecentProject) => void
}

const { onSelect }: Props = $props()

const recent = getRecentProjects()
const i18n = getI18n()
const t = i18n.t
const settings = getSettings()

onMount(() => {
  void recent.refresh()
})
</script>

<section class="recent-panel">
  <div class="panel-header">
    <span class="panel-title">{t("connect.recent.title")}</span>
    <div class="header-actions">
      {#if !settings.recentCollapsed}
        <button
          type="button"
          class="refresh-btn"
          disabled={recent.loading}
          onclick={() => void recent.refresh()}
          title={t("connect.recent.refresh")}
          aria-label={t("connect.recent.refresh")}
        >
          ↺
        </button>
      {/if}
      <button
        type="button"
        class="collapse-btn"
        onclick={() => settings.setRecentCollapsed(!settings.recentCollapsed)}
        title={settings.recentCollapsed ? t("connect.recent.expand") : t("connect.recent.collapse")}
        aria-label={settings.recentCollapsed ? t("connect.recent.expand") : t("connect.recent.collapse")}
        aria-expanded={!settings.recentCollapsed}
      >
        {settings.recentCollapsed ? "▶" : "▼"}
      </button>
    </div>
  </div>

  {#if !settings.recentCollapsed}
    {#if recent.projects.length === 0}
      <div class="empty-state">
        {recent.loading ? "…" : t("connect.recent.empty")}
      </div>
    {:else}
      <ul class="project-list chat-scroll">
        {#each recent.projects as project (project.cwd)}
          <li class="project-row">
            <button
              type="button"
              class="project-btn"
              onclick={() => onSelect(project)}
            >
              <div class="project-top">
                <span class="cli-badge">{project.kind}</span>
                <span class="folder-name" title={project.cwd}><bdi>{basename(project.cwd)}</bdi></span>
                {#if project.lastSeen}
                  <span class="meta-sep">·</span>
                  <span class="last-seen">
                    {formatRelativeTime(new Date(project.lastSeen).getTime(), i18n.locale)}
                  </span>
                {/if}
              </div>
              <div class="project-meta">
                <span class="cwd-full" title={project.cwd}><bdi>{project.cwd}</bdi></span>
              </div>
            </button>
            <button
              type="button"
              class="delete-btn"
              onclick={() => void recent.remove(project.cwd)}
              title={t("connect.recent.remove")}
              aria-label={t("connect.recent.remove")}
            >✕</button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .recent-panel {
    margin-bottom: 1.5rem;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--border);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  .collapse-btn {
    padding: 0.2rem 0.5rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--fg-dim);
    font-size: 0.7rem;
    cursor: pointer;
    line-height: 1;
    transition: color 0.15s, border-color 0.15s;
  }

  .collapse-btn:hover {
    color: var(--fg);
    border-color: var(--accent);
  }

  .panel-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--fg-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .refresh-btn {
    padding: 0.2rem 0.5rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--fg-dim);
    font-size: 1rem;
    cursor: pointer;
    line-height: 1;
    transition: color 0.15s, border-color 0.15s;
    margin-top: 0;
  }

  .refresh-btn:hover:not(:disabled) {
    color: var(--fg);
    border-color: var(--accent);
  }

  .refresh-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .empty-state {
    padding: 0.8rem 0.9rem;
    font-size: 0.85rem;
    color: var(--fg-dim);
  }

  .project-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 16rem; /* גובה קבוע ~4-5 שורות */
    overflow-y: auto;
  }

  .project-row {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--border);
  }

  .project-row:last-child {
    border-bottom: none;
  }

  /* כפתור מחיקה — sibling של project-btn (לא ילד; nested button אסור) */
  .delete-btn {
    flex-shrink: 0;
    padding: 0 0.6rem;
    background: transparent;
    border: none;
    border-inline-start: 1px solid var(--border);
    border-radius: 0;
    color: var(--fg-dim);
    font-size: 0.8rem;
    cursor: pointer;
    line-height: 1;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s, background 0.15s;
    display: flex;
    align-items: center;
  }

  .project-row:hover .delete-btn,
  .project-row:focus-within .delete-btn {
    opacity: 1;
  }

  /* hover אדום — סימון ויזואלי שהפעולה הרסנית (עקבי עם כפתור ה-Kill ב-ActiveProcessesPanel) */
  .delete-btn:hover {
    color: rgb(255, 79, 79);
    background: rgba(255, 79, 79, 0.1);
  }

  .project-btn {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.35rem;
    padding: 0.55rem 0.9rem;
    background: transparent;
    border: none;
    border-radius: 0;
    cursor: pointer;
    text-align: start;
    transition: background 0.1s;
  }

  .project-btn:hover {
    background: var(--bg-hover, rgba(127, 127, 127, 0.08));
  }

  .project-top {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
    font-size: 0.82rem;
  }

  .project-meta {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.72rem;
    color: var(--fg-dim);
    min-width: 0;
  }

  .meta-sep {
    color: var(--fg-dim);
    opacity: 0.5;
  }

  /* badge סוג-CLI — זהה ל-ActiveProcessesPanel */
  .cli-badge {
    background: var(--border);
    color: var(--fg);
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    font-size: 0.72rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  /* שם התיקייה (basename) — בולט בשורה העליונה */
  .folder-name {
    color: var(--fg);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 0 1 auto;
    min-width: 0;
  }

  .last-seen {
    direction: ltr;
    flex-shrink: 0;
    color: var(--fg-dim);
    font-size: 0.72rem;
  }

  /* הנתיב המלא — RTL ellipsis מקצץ מהתחילה כך שזנב הנתיב תמיד נראה */
  .cwd-full {
    display: block;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
    font-size: 0.72rem;
    color: var(--fg-dim);
  }

  .folder-name > :global(bdi),
  .cwd-full > :global(bdi) {
    direction: ltr;
  }
</style>
