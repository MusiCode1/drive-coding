# Investigation: f5-be-persistence

> ‏Source finding: ‏`docs/slice-10-exploratory-test-report.md` ‏#F-5 (MAJOR).
> ‏Investigation date: 2026-05-18.
> ‏Mode: code-only (no runtime reproduction).

## Bug recap

‏אחרי BE restart ‏(crash או ידני) ‏`GET /api/agents` ‏מחזיר ‏`{"agents":[]}`. ‏Dashboard מציג "אין סוכנים פעילים". ‏ה-FE שעדיין מחזיק `agentId` ישן ‏(bookmark, ‏‏טאב פתוח, ‏PWA shortcut) ‏מקבל 404 ‏ומציג שגיאה גנרית ‏(F-6 הוסר חלקית). ‏‏ה-bridges הישנים גם נעלמים בפועל ‏(ראה Root cause), ‏‏אז זה לא רק בעיית registry — ‏כל ה-state של ה-agents אבוד.

## Root cause

‏שני "ערימות in-memory" שאובדות ב-restart, ‏ותו ‏מפתח שהארכיטקטורה הניחה ולא קיים בקוד.

### ‏‏1. ‏Registry ‏בזיכרון בלבד

‏`packages/backend/src/agents/registry.ts:10-56` — ‏`createInMemoryAgentRegistry` ‏מחזיק ‏`store = new Map<string, Agent>()` ‏בסקופ של factory. ‏אין load מ-disk, ‏אין persist. ‏ה-comment בשורה 7 ‏מודה: ‏"נאבד ב-restart (D8 — acceptable ל-MVP)".

‏`packages/backend/src/server.ts:52` ‏מחבר ‏אינסטנס יחיד בעלייה: ‏`const registry = createInMemoryAgentRegistry()`. ‏אין boot hook שטוען מצב.

### ‏‏2. ‏Orchestrator מחזיק bridge ports ‏בזיכרון בלבד

‏`packages/backend/src/app/agent-orchestrator.ts:85-89`:

```ts
const stderrGetters = new Map<string, () => string[]>()
const bridgePorts = new Map<string, number>()
```

‏שתי ‏ה-maps נבנות מחדש כל boot — ‏אפילו אם הregistry היה persisted, ‏ws-agent ‏לא היה ‏יודע ‏לאן ‏לנתב.

### ‏‏3. ‏ה-bridges עצמם מתים יחד עם BE ‏(architecture ≠ implementation)

‏‏זה הממצא ‏הכי ‏מפתיע. ‏המסמך ‏`docs/vnext-architecture.md:710-716` ‏מצהיר ‏שה-bridges שורדים נפילת backend ‏באמצעות ‏`--persist`:

> ‏Backend נופל: ‏bridges ממשיכים לרוץ ‏(`--persist`) ‏ומצברים events מ-CLI. ‏אבל ה-in-memory Map של ה-agent registry אבד.

‏ו-D33 ‏(שורה 192) ‏מצהיר ‏שה-BE spawn-ים את ה-CLI דרך ‏`npx @rebornix/stdio-to-ws "opencode acp" --port 0 --persist --grace-period -1`.

‏אבל ‏`packages/backend/src/acp/bridge-manager.ts:52-56` ‏‏מבצע ‏spawn ישיר ‏עם piped stdio:

```ts
child = spawn(cli.bin, [...cli.args], {
  cwd: input.cwd,
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
})
```

‏וב-`cli-config.ts:22-25` ‏‏ה-bin הוא ‏ישירות ‏`opencode acp`, ‏ללא stdio-to-ws ‏בכלל. ‏כש-BE מת:

‏-‏ ‏ה-pipes ‏נסגרים → ‏ה-CLI children ‏מקבלים stdin EOF → ‏יוצאים.
‏-‏ ‏גם אם איכשהו ‏היו ‏שורדים, ‏ה-orchestrator לא יודע איזה port הם שמעו, ‏ו-`bridge-manager.ts:103` ‏מסמן את ‏`port: 0` ‏(‏"in-process: no port") — ‏אין דרך לחבר אליהם שוב.

‏המשמעות: ‏ההנחה שעליה ‏‏ה-architecture ‏‏ביססה ‏‏את ‏"acceptable to lose registry" ‏(‏‏הbridges שורדים) ‏‏לא ‏מתקיימת בפועל. ‏‏BE restart = ‏איבוד מוחלט של agents + bridges + sessions ‏(‏ב-BE; ‏opencode עצמו עדיין שומר conversations ב-disk שלו).

### ‏‏4. ‏‏מה כן ‏מתמיד

‏`packages/backend/src/app/projects-registry.ts:24-78` — ‏`createProjectsRegistry(baseDir)` ‏עם ‏`<baseDir>/projects-registry.json` ‏(שורה 5: "Persisted to ... — survives backend restarts"). ‏מכיל ‏לכל cwd: ‏`{cwd, kind, lastSeen, lastSessionId?}`.

‏זה ה-building block היחיד הזמין: ‏אחרי restart יש לנו רשימת ‏cwds + ‏acpSessionId ‏האחרון של כל אחד. ‏אין לנו ‏מפת agentId → bridgePort.

## Affected files

- ‏`packages/backend/src/agents/registry.ts:10-56` — ‏in-memory Map, ‏ללא persist
- ‏`packages/backend/src/server.ts:52` — ‏מחבר את האינסטנס היחיד ב-boot
- ‏`packages/backend/src/app/agent-orchestrator.ts:85-89` — ‏`bridgePorts` + ‏`stderrGetters` ‏in-memory
- ‏`packages/backend/src/acp/bridge-manager.ts:24,52-56,99-107` — ‏direct child spawn, ‏ללא stdio-to-ws / ‏`--persist`
- ‏`packages/backend/src/acp/cli-config.ts:22-25` — ‏bin = ‏`opencode acp` ישיר
- ‏`packages/backend/src/app/projects-registry.ts:1-78` — ‏**כבר מותמד**, ‏מכיל cwd+lastSessionId — ‏יסוד אפשרי לrecovery
- ‏FE downstream ‏(‏לא root cause, ‏אבל ‏מציין את ה-UX):
  - ‏`packages/frontend/src/lib/stores/agent-session.svelte.ts:438` — ‏`GET /api/agents/<oldId>` ‏מחזיר 404, ‏הקוד לא ‏מטפל ‏בfallback
  - ‏`packages/frontend/src/routes/+page.svelte:32` — ‏`listAgents` ‏מחזיר ‏`[]`, ‏אין ‏UI ‏שמציע recovery מ-`/api/projects`

## Reproduction

‏לא שוחזר ‏(‏מחקר read-only). ‏העדויות ב-finding מאשרות התנהגות זמן-ריצה, ‏וקריאת הקוד מאשרת חד-משמעית: ‏אין שום ‏persist/load logic על Agent records, ‏וה-Map חי בסקופ של ‏process. ‏שחזור מלא יחייב ‏tmux restart של ‏be-v3 — ‏מחוץ ל-scope של מחקר.

## Proposed fix

‏שלוש אופציות, ‏מהקלה לכבדה. **‏ההמלצה: ‏Option A** ‏(תיקון UX בלבד) ‏בתור quick win, ‏ו-Option B ‏בroadmap אם הסיפור חוזר. ‏Option C ‏‏לא ‏לMVP.

### Option A — ‏"Documented limitation" + ‏‏שיפור FE recovery (‏smallest)

‏‏לא נוגעים בBE. ‏‏מנצלים את ‏`/api/projects` ‏שכבר ‏מותמד.

1. ‏**Dashboard (`+page.svelte`)**: ‏כש-`listAgents()` ‏מחזיר ‏`[]` ‏ו-`/api/projects` ‏מחזיר ‏רשימה ‏לא ‏ריקה — ‏הצג section ‏"פרויקטים אחרונים" ‏עם כפתור ‏`[‏המשך עבודה]` ‏לכל פרויקט. ‏הclick קורא ‏`createAgent({ cwd, cliKind, existingSessionId: project.lastSessionId })` ‏ומנווט ל-`/agent/<id>`. ‏זהה לסשן history flow ‏שכבר קיים ב-`session/[cwdHash]/[id]/+page.svelte:39-44`.

2. ‏**`/agent/[id]` 404 handling**: ‏ב-`agent-session.svelte.ts:438` ‏כש-`agentRes.status === 404` — ‏הצג ‏טוסט ‏"‏הסוכן ‏‏לא ‏‏זמין יותר" ‏ונווט אוטומטית ל-`/`. ‏מסיים ‏את ‏ה-UX hole של F-6.

‏‏יתרון: ‏‏‏0 שינויי BE, ‏‏‏0 schema migration, ‏‏מתואם ‏‏עם ‏הקיים. ‏‏מעניק "מסלול ‏‏המשך עבודה" ‏שעובד עם ‏opencode loadSession ‏‏המובנה.

‏חיסרון: ‏לא ‏מציל ‏in-flight prompts. ‏אם המשתמש ‏היה ‏באמצע ‏משפט בזמן ה-crash — ‏‏‏המשפט אבוד. ‏‏opencode loadSession ‏מחזיר ‏רק events שעבר commit (saved messages).

### Option B — ‏File-backed agent registry (medium)

‏בקצרה: ‏לעטוף את ‏`createInMemoryAgentRegistry` ‏עם persist layer ‏זהה לתבנית של ‏`projects-registry.ts`.

‏Sketch:

```ts
// packages/backend/src/agents/persistent-registry.ts
export function createPersistentAgentRegistry(baseDir: string): AgentRegistry {
  const filePath = join(baseDir, "agents-registry.json")
  const inMemory = createInMemoryAgentRegistry()

  // Boot: load + transition all "live" agents to "crashed"
  async function init() {
    const data = await readFile(filePath, "utf8").catch(() => "{}")
    const { agents = [] } = JSON.parse(data) as { agents: Agent[] }
    for (const a of agents) {
      const status = (a.status === "ready" || a.status === "busy" || a.status === "starting")
        ? "crashed" as const
        : a.status
      await inMemory.create({ ...a })  // (needs internal seed API)
      if (status !== a.status) {
        await inMemory.update(a.id, { status, crashReason: "backend restarted" })
      }
    }
  }

  // After each mutation: dump full state (atomic write — tmp + rename, כמו ב-projects-registry)
  // ...
}
```

‏‏-‏ ‏בoot מסמן את ‏כל הסוכנים ‏שהיו ‏`ready`/`busy`/`starting` ‏‏כ-‏`crashed` ‏עם ‏`crashReason: "backend restarted"`. ‏הFE כבר ‏מטפל ב-`crashed` ‏‏(‏מציג ‏ב-dashboard ‏עם ‏badge).
‏‏-‏ ‏מוסיפים ‏ב-FE כפתור ‏`[‏הקם מחדש]` ‏לסוכן crashed → ‏POST ‏‏עם ‏ה-`existingSessionId` ‏ששמרנו ‏ב-Agent record (‏‏‏אם ‏נשמר). ‏זה ‏מאפשר ‏גם ‏המשך ‏סשן וגם ‏סטטוס נקי ‏‏‏(לא ‏"‏‏פתאום היו [] ‏ואז ‏‏יש סוכן ‏חדש").

‏‏מצורך גם: ‏שינוי קטן ב-`bridgePorts`/`stderrGetters` — ‏כשresurrecting, ‏הם ‏עדיין ריקים. ‏אבל זה ‏OK ‏כי הbridges מתו ‏(ראה Root cause #3) — ‏הספאון השני יבנה מחדש.

‏יתרון: ‏‏‏עדיין ‏עוזר ‏גם ‏ב-pkill / OOM / restart ‏ידני. ‏מאפשר ‏לצרכן ‏(FE) ‏‏לראות ‏היסטוריה ‏אמיתית ‏של ‏מה ‏שהיה ‏לפני ‏‏ה-crash, ‏לא ‏רק ‏‏רשימת ‏cwds.

‏חיסרון: ‏stale acpSessionId ‏ייתכן ‏שלא קיים יותר ב-opencode (‏אם הוא ‏עבר rotation, ‏‏cleanup ‏וכו'). ‏‏loadSession ‏‏ייכשל ‏וצריך fallback ל-`newSession` ‏(‏‏הקוד ‏ב-`agent-session.svelte.ts:457-464` ‏כבר ‏עושה ‏את ‏זה). ‏file ‏corruption באמצע ‏write ‏דורש ‏atomic-write pattern (‏write to tmp + rename), ‏שhe-projects-registry ‏לא ‏עושה ‏כרגע ‏‏(‏!).

### Option C — ‏True bridge survival ‏(largest, ‏לא ‏לMVP)

‏מימוש ‏מה ‏ש-D33 ‏‏הניח: ‏עוטפים את ‏ה-CLI ‏ב-`@rebornix/stdio-to-ws --persist --grace-period -1`, ‏מותמדים ‏`bridgePort` ‏וגם ‏`acpSessionId`, ‏ועל boot scanning של ports קיימים + ‏reconnect ‏לbridges חיים. ‏מצריך תלות ‏npm חדשה, ‏ניהול ports ‏(allocation, ‏cleanup ‏orphans), ‏ועוד.

‏מתאים רק אם BE crashes ‏נפוצים ו-zero loss ‏הוא דרישה. ‏אחרי F-1 ‏זה ‏לא ‏נראה ‏שזה ‏המצב.

## Risks

‏-‏ **Option A**: ‏לא מסיר ‏את ‏הroot cause — ‏רק עוטף אותו. ‏אם opencode עצמו ‏‏לא שמר ‏את ‏הסשן, ‏ה-`existingSessionId` ‏שנעביר ‏‏יכשיל ‏את ‏ה-loadSession ‏ויקרה fallback ל-newSession ‏(‏שמייצר ‏סשן ‏חדש לגמרי). ‏המשתמש ‏יחשוב ‏שהוא ‏ממשיך ‏עבודה ‏אבל ‏יראה ‏‏שיחה ריקה. ‏‏צריך ‏‏visual ‏indicator ‏ש-"loaded vs. new".
‏-‏ **Option B**: ‏file corruption mid-write (‏אם BE crash ‏באמצע ‏writeFile — ‏הקובץ ‏פסיק להיות JSON ‏תקין → ‏load כושל → ‏fall-through ל-Map ריקה = ‏בדיוק המצב ‏הקיים, ‏זה לפחות ‏no-regress). ‏אבל ‏עדיף ‏atomic-write. ‏stale entries (cwd ‏שנמחק) ‏‏צריכים ‏cleanup ‏או ‏טיפול ב-‏create. ‏schema migration ‏אם נשנה את ‏Agent type ‏בעתיד.
‏-‏ **Option C**: ‏orphan bridges (ports ‏שתפוסים בלי שאיש יודע), ‏version skew בין BE ל-wrapper, ‏בעיות ‏permission ‏בproduction LXC.

## Open questions for Avi

1. **‏האם ‏לבחון ‏מחדש את ‏D8 ל-v1?** ‏D8 ‏נכתב לMVP. ‏‏אחרי ‏F-1 הכאב פחת. ‏האם זה ‏accepted limitation או ‏שנשקיע בpersistence? **‏החלטה ‏ארכיטקטונית — ‏לא ‏אחליט ‏לבד.**
2. **‏‏‏מה ‏קרה ל-stdio-to-ws wrapper?** ‏D33 ‏מתאר ‏ש-BE עוטף ‏את ‏ה-CLI ‏ב-`@rebornix/stdio-to-ws ... --persist`. ‏הקוד ‏הנוכחי ‏(bridge-manager.ts) ‏‏לא ‏עושה ‏את ‏זה — ‏‏spawn ‏ישיר ל-opencode acp ‏עם ‏stdio pipes. ‏האם זה ‏‏‏היה ‏פישוט מכוון ב-slice ‏מסוים, ‏או ‏regression ‏שלא ‏‏שמנו ‏עליו ‏לב? ‏ההחלטה ‏הזו ‏משפיעה ‏על ‏איזה option ‏בכלל ‏ישים — ‏אם ‏‏צריך ‏להחזיר את ה-wrapper, ‏זה ‏work חדש ‏בפני עצמו.
3. **‏‏UX behaviour ‏על agentId ‏ישן ב-URL:** ‏‏אם משתמש ‏עם bookmark / PWA shortcut ‏‏ל-`/agent/<oldId>` ‏מקבל ‏404 ‏אחרי BE restart — ‏האם FE צריך auto-redirect ל-dashboard ‏‏עם ‏טוסט "‏סשן ‏‏הסתיים", ‏או ‏error מפורש ‏עם ‏כפתור "‏‏חזרה"?
4. **Recovery semantics:** ‏‏כש-agent ‏מוקם ‏מחדש ‏עם ‏`existingSessionId` ‏ו-opencode ‏‏לא ‏מוצא ‏‏‏אותו ‏(rotation/cleanup) — ‏האם UX ‏אמור ‏ליצור newSession ‏שקט, ‏‏או ‏להציג ‏"‏הסשן ‏הישן ‏אבוד, ‏‏מתחילים ‏חדש"?
5. **‏‏‏Backend deploy reality:** ‏בprod (Proxmox LXC, ‏‏‏סינגל-משתמש) — ‏כמה ‏‏פעמים BE באמת ‏עולה ‏מחדש? ‏אם ‏‏‏אף פעם ‏(systemd Restart=on-failure + ‏post-F-1 stable) — ‏Option A ‏מספיק. ‏אם ‏שבועי ‏(deploys) — ‏Option B ‏שווה.

## Estimated effort

| Option | LoC חדש | קבצים חדשים | Tests | זמן |
|--------|---------|--------------|-------|-----|
| A (FE recovery) | ~50 | 0 | 1 e2e | 2-3 שעות |
| B (file registry) | ~150 + ~30 FE | 1 BE (`persistent-registry.ts`) | 2 unit + 1 integration | יום עבודה |
| C (stdio-to-ws + reconnect) | ~400+ | 2-3 + npm dep | 4-5 | 2-3 ימים |

**‏המלצה לאבי:** ‏‏לאשר ‏Option A ‏עכשיו ‏(matches the "importance dropped after F-1" ‏הערה ב-finding), ‏‏ולסמן ‏Option B ‏‏ב-`future-features.md` ‏כסעיף ‏יעוד ‏אם ‏מצטברים ‏אירועי persistence loss ‏בproduction.
