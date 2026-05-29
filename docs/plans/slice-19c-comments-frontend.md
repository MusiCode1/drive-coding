# Slice 19c — Hebrew Comments: frontend — תוכנית

> **תאריך**: 2026-06-03
> **סטטוס**: טיוטה
> **Complexity**: 2/10 (verifier: light)
> **תלות**: אין (עצמאי לחלוטין מ-19a ו-19b)
> **Base**: dev tip `1409184`

---

## §0 — Pre-flight

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-19c-comments-frontend -b slice-19c-comments-frontend dev
cd .worktrees/slice-19c-comments-frontend
pnpm install
pnpm hooks:install
```

### איך להריץ

- **Tests**: `pnpm --filter @drive-coding/frontend-v2 test`
- **Typecheck**: `pnpm typecheck`
- **Lint i18n**: `pnpm lint:i18n`

> אין צורך ב-BE או FE — slice זה הוא שינוי טקסט בלבד (הערות קוד).

### Browser

לא נדרש.

### OneCLI agent

לא נדרש.

### Reading list

**must-read** (לפני שמתחילים):
- `scripts/lint-no-hebrew-in-code.sh` — מאשר שהערות מותרות בעברית (רק string literals נחסמים)
- `scripts/lint-no-hebrew-in-code.py` — לוגיקת הבדיקה המדויקת
- `packages/frontend/AGENTS.md` — "five golden rules" של ה-frontend

**reference** (בזמן עבודה):
- `docs/plans/EXECUTOR_DISPATCH.md` — קונבנציות כלליות

---

## §1 — מטרה

לאחר השלמת הסליס, כל הערות הקוד בחבילת `packages/frontend/src/` יהיו בעברית — כולל קבצי Svelte (.svelte), TypeScript (.ts), קבצי טסטים (.test.ts / .test.svelte.ts), וכל store ו-engine. תיעוד state machines, session lifecycle, voice orchestration, ו-audio pipeline — הכל בעברית.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| תרגום הערות `packages/frontend/src/` | ✅ | בסליס הזה |
| כולל קבצי `.svelte` (comments ב-`<script>`) | ✅ | בסליס הזה |
| כולל קבצי `.test.ts` / `.test.svelte.ts` | ✅ | בסליס הזה |
| תרגום הערות `packages/core/src/` | ❌ | slice 19a |
| תרגום הערות `packages/backend/src/` | ❌ | slice 19b |
| תרגום JSDoc `@param`/`@returns` descriptions | ✅ | בסליס הזה |
| שמירת `biome-ignore` justifications באנגלית | ✅ | לא לגעת בהם |
| שמירת `<!-- svelte-ignore ... -->` directives ללא שינוי | ✅ | **לא לגעת** — directive פונקציונלי של Svelte |
| שמירת `@ts-ignore`/`@ts-expect-error` באנגלית | ✅ | לא לגעת |
| שינוי קוד פונקציונלי | ❌ | לא לגעת |
| תרגום string literals | ❌ | לא לגעת |
| תרגום template strings ב-Svelte (`{...}`) | ❌ | לא לגעת |
| תרגום i18n key references (`t('...')`) | ❌ | לא לגעת |

> **כלל ברזל 1**: אם שורה מתחילה עם `// biome-ignore` או מכילה `@ts-` directive — לא לגעת בכלום בשורה.
> **כלל ברזל 2**: `<!-- svelte-ignore ... -->` הוא directive פונקציונלי של Svelte compiler — **לא לגעת**. תרגום שלו ישבור את ה-typecheck. דוגמה שצריך לשמור: `<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->` ב-`ToolBubble.svelte:37`.

---

## §3 — Architecture diagram

```
packages/frontend/src/
  app.d.ts                                ← ייתכן הערות
  lib/
    actions/
      connect-agent.ts                    ← הערות על action flow
    adapters/
      agents-api.ts                       ← הערות API
      sessions.ts                         ← הערות
      voice/
        base64.ts                         ← הערות
        narrate.ts                        ← הערות
        sdks.ts                           ← ~26 שורות
        transcribe.ts                     ← הערות
        translate.ts                      ← הערות
        tts.ts                            ← הערות
        voices.ts                         ← הערות
    components/
      chat/
        BubbleRenderer.svelte             ← הערות ב-<script>
        ChatBubbles.svelte                ← הערות
        ChatHeader.svelte                 ← הערות
        ChatInput.svelte                  ← הערות
        MicButton.svelte                  ← הערות
        VoicePicker.svelte                ← הערות
        bubbles/
          MessageBubble.svelte            ← הערות
          ThoughtBubble.svelte            ← הערות
          ToolBubble.svelte               ← הערות
          UserBubble.svelte               ← הערות
          bubble-rendering.test.ts        ← test file
          bubble-rendering.ts             ← הערות
      connect/
        SessionPicker.svelte              ← הערות
    context.ts                            ← הערות
    engines/
      audio-stream.ts                     ← ~37 שורות הערה
      player.svelte.ts                    ← ~37 שורות הערה
      recorder.ts                         ← הערות
      ws-to-streams.ts                    ← ~25 שורות
      ws-transport.ts                     ← הערות
    types/
      bubble.exhaustive.ts                ← הערות
      bubble.ts                           ← הערות
    util/
      be-url.test.ts                      ← test file
      be-url.ts                           ← הערות
      markdown.test.ts                    ← test file
      markdown.ts                         ← הערות
    view-models/
      agent-session.svelte.ts             ← 120 שורות הערה (הגדול ביותר!)
      derived/
        voice-mode.svelte.ts              ← הערות
      i18n.svelte.ts                      ← הערות
      mic.svelte.ts                       ← הערות
      settings.svelte.ts                  ← הערות
      settings.test.svelte.ts             ← test file
      speaker.svelte.ts                   ← הערות
  routes/
    +layout.svelte                        ← ~8 שורות
    +layout.ts                            ← הערות
    +page.svelte                          ← הערות
    chat/
      +page.svelte                        ← הערות
    settings/
      +page.svelte                        ← הערות
```

---

## §4 — Commits בסדר

### Commit 0 — תרגום הערות packages/frontend/src/ לעברית (approach: none)

**קבצים שמשתנים** (רשימה מלאה — תרגם כולם בcommit אחד):

**lib/adapters:**
- `packages/frontend/src/lib/adapters/agents-api.ts`
- `packages/frontend/src/lib/adapters/sessions.ts`
- `packages/frontend/src/lib/adapters/voice/base64.ts`
- `packages/frontend/src/lib/adapters/voice/narrate.ts`
- `packages/frontend/src/lib/adapters/voice/sdks.ts`
- `packages/frontend/src/lib/adapters/voice/transcribe.ts`
- `packages/frontend/src/lib/adapters/voice/translate.ts`
- `packages/frontend/src/lib/adapters/voice/tts.ts`
- `packages/frontend/src/lib/adapters/voice/voices.ts`

**lib/actions:**
- `packages/frontend/src/lib/actions/connect-agent.ts`

**lib/components:**
- `packages/frontend/src/lib/components/chat/BubbleRenderer.svelte`
- `packages/frontend/src/lib/components/chat/ChatBubbles.svelte`
- `packages/frontend/src/lib/components/chat/ChatHeader.svelte`
- `packages/frontend/src/lib/components/chat/ChatInput.svelte`
- `packages/frontend/src/lib/components/chat/MicButton.svelte`
- `packages/frontend/src/lib/components/chat/VoicePicker.svelte`
- `packages/frontend/src/lib/components/chat/bubbles/MessageBubble.svelte`
- `packages/frontend/src/lib/components/chat/bubbles/ThoughtBubble.svelte`
- `packages/frontend/src/lib/components/chat/bubbles/ToolBubble.svelte`
- `packages/frontend/src/lib/components/chat/bubbles/UserBubble.svelte`
- `packages/frontend/src/lib/components/chat/bubbles/bubble-rendering.test.ts`
- `packages/frontend/src/lib/components/chat/bubbles/bubble-rendering.ts`
- `packages/frontend/src/lib/components/connect/SessionPicker.svelte`

**lib/engines + context:**
- `packages/frontend/src/lib/context.ts`
- `packages/frontend/src/lib/engines/audio-stream.ts`
- `packages/frontend/src/lib/engines/player.svelte.ts`
- `packages/frontend/src/lib/engines/recorder.ts`
- `packages/frontend/src/lib/engines/ws-to-streams.ts`
- `packages/frontend/src/lib/engines/ws-transport.ts`

**lib/types + util:**
- `packages/frontend/src/lib/types/bubble.exhaustive.ts`
- `packages/frontend/src/lib/types/bubble.ts`
- `packages/frontend/src/lib/util/be-url.test.ts`
- `packages/frontend/src/lib/util/be-url.ts`
- `packages/frontend/src/lib/util/markdown.test.ts`
- `packages/frontend/src/lib/util/markdown.ts`

**lib/view-models:**
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts`
- `packages/frontend/src/lib/view-models/derived/voice-mode.svelte.ts`
- `packages/frontend/src/lib/view-models/i18n.svelte.ts`
- `packages/frontend/src/lib/view-models/mic.svelte.ts`
- `packages/frontend/src/lib/view-models/settings.svelte.ts`
- `packages/frontend/src/lib/view-models/settings.test.svelte.ts`
- `packages/frontend/src/lib/view-models/speaker.svelte.ts`

**routes:**
- `packages/frontend/src/routes/+layout.svelte`
- `packages/frontend/src/routes/+layout.ts`
- `packages/frontend/src/routes/+page.svelte`
- `packages/frontend/src/routes/chat/+page.svelte`
- `packages/frontend/src/routes/settings/+page.svelte`

**app.d.ts:**
- `packages/frontend/src/app.d.ts`

**כללי תרגום לקובץ**:

1. **`// הערה`** → תרגם הטקסט לעברית
2. **`/** JSDoc block */`** → תרגם את כל הטקסט (כולל תיאורי @param ו-@returns), אבל השאר את שמות ה-tags עצמם (@param, @returns וכו') ואת שמות הפרמטרים
3. **`/* inline block */`** → תרגם לעברית
4. **`<!-- HTML comment -->`** ב-Svelte templates → תרגם לעברית
5. **`// ── Section Banner ─────`** → תרגם את הכיתוב
6. **הערות שכבר בעברית** → השאר כמו שהן
7. **`// biome-ignore lint/...: <reason>`** → **לא לגעת בכלל** — כל השורה נשארת (הערה: אין `biome-ignore` ב-`frontend/src/` בפועל — DoD #4 יחזיר ריק כצפוי)
8. **`<!-- svelte-ignore ... -->`** → **לא לגעת בכלל** — directive פונקציונלי. שמור כמו שהוא (ראה כלל ברזל 2 ב-§2)
9. **`// @ts-ignore`**, **`// @ts-expect-error`** → לא לגעת
10. **קוד** (לא הערות) → לא לגעת לחלוטין — כולל `{#each}`, `{#if}`, `{@render}`, i18n `t(key)`, binding expressions

**הערה מיוחדת לקבצי Svelte (.svelte)**:
- הערות ב-`<script>` block → כן תרגם
- הערות ב-`<style>` block (CSS) → כן תרגם
- הערות ב-template (`<!-- comment -->`) → כן תרגם
- קוד ה-template עצמו (`{#each}`, `{:else}`, `{@render}`) → לא לגעת

**Verification**:

```bash
pnpm typecheck
pnpm lint:i18n
pnpm --filter @drive-coding/frontend-v2 test
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | typecheck עובר | `pnpm typecheck` |
| 2 | lint:i18n עובר | `pnpm lint:i18n` |
| 3 | frontend tests עוברים | `pnpm --filter @drive-coding/frontend-v2 test` |
| 4 | אין שינוי ב-biome-ignore שורות | `git diff \| grep "biome-ignore"` — אמור להיות ריק (אין `biome-ignore` ב-`frontend/src/`) |
| 5 | כל הערה ארוכה באנגלית תורגמה | `grep -r "^[[:space:]]*//" packages/frontend/src/ \| grep -vE "biome-ignore\|@ts-\|eslint" \| python3 -c "import sys,re; [print(l,end='') for l in sys.stdin if not re.search(r'[\u0590-\u05ff]',l)]" \| grep -E "[a-zA-Z]{5,}"` — מעט/כלום |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| שינוי מקרי של קוד Svelte (לא רק הערות) | template syntax פחות ברור | DoD #1 typecheck + DoD #3 tests |
| תרגום שגוי של `biome-ignore` directive | כלל ברזל §2 | DoD #4 — `git diff \| grep biome-ignore` חייב להיות ריק |
| שבירת Svelte template syntax | עריכה שגויה ב-.svelte | `pnpm typecheck` — DoD #1 |
| הערות בתוך template `{#if}` — בלבול עם code | Svelte syntax | קרא ביניהם: `{#if cond}<!-- הערה -->` — רק את text ה-comment |
| view-models/agent-session.svelte.ts — 120 שורות הערה גדולות | גדול במיוחד | קרא לפני עריכה, שמור state machine labels נכונים |

---

## §7 — Escalation triggers

> עצור ושאל את Tama:

- TypeScript / Svelte typecheck נכשל לאחר התרגום
- lint:i18n מתלונן על Hebrew בקוד (הוכנסה עברית בstring literal בטעות)
- frontend tests נכשלים לאחר התרגום (אמור להיות בלתי אפשרי)
- קובץ `biome-ignore` שורה השתנתה

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------|
| Pure logic, אין IO | -2 |
| שינוי טקסט בלבד (הערות) | -2 |
| קבצי Svelte (.svelte) — syntax מורכב מעט יותר | +1 |

**Score**: 1/10 (מינימלי)

**Tier**: `verifier-slice-light` בלבד

**Verifier-phase אחרי commit/phase**: אין

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | כיצד לתרגם מונחים טכניים כמו "bridge", "proxy", "spawn", "rune"? | להשאיר את המונח הטכני באנגלית בתוך הטקסט העברי | ❌ |
| 2 | ASCII diagrams (→, ↕, ┌) — לתרגם labels? | כן — תרגם הטקסט, שמור ה-ASCII | ❌ |
| 3 | שם ה-filter package לpnpm test — `@drive-coding/frontend-v2`? | כן, כפי שנמצא ב-package.json | ❌ |

---

## סטיות מהתכנון (מתעדכן ע"י executor תוך כדי)

> ה-executor מתעד פה כל סטייה מה-brief ולמה.

- ...
