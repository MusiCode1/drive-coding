# Slice fix-phone-reconnect-pwa — תיקון auto-reconnect ב-null sessionId + manifest מאחורי Access — ‏בריף

> **‏תאריך**: 2026-06-16
> **‏סוג**: ‏bug-fix (2 תיקונים מוכלים — A מהותי, B קוסמטי-PWA)
> **‏סטטוס**: ‏ממתין לאימות אביגיל
> **Complexity**: 4/10 (verifier: **calev light** + בדיקת משתמש בטלפון)
> **‏מבצע**: ‏מרדכי בעצמו (‏המשתמש אישר — ‏אחרי READY של אביגיל)
> **Base**: ‏branch `dev` (tip `b2c2349`) — ‏הסביבה הפרוסה ב-staging (`voice-acp-dev` :4001)

---

## §0 — ‏רקע ועדויות (‏אובחן חי על staging)

המשתמש בדק את staging (`https://drive-coding-dev.example.com`, claude על cwd `persona-lab`).
**‏במחשב עובד, ‏בטלפון לא.** ‏ב-journal של `voice-acp-dev` נצפו (04:14–04:15 UTC) **4 ניסיונות
`session/load` נפרדים, ‏כל אחד על agentId חדש** (`7839e986`, `509b1870`, `078e0cf2`, `fdcc79bf`),
‏כולם עם:

```json
{ "method": "session/load", "params": { "sessionId": null, "cwd": "/home/user/projects/persona-lab", "mcpServers": [] } }
```

‏ותגובת שגיאה מ-claude: `"Invalid input: expected string, received null"`.

‏אומת ש-`listSessions` **‏כן** ‏מחזיר `sessionId` תקין (uuid) לכל הסשנים — ‏אז זו **‏לא** ‏בעיית data
‏ברשימה; ‏ה-`null` ‏נשלח מנתיב reconnect שמשתמש ב-`this.#sessionId` ‏כשהוא `null`.

---

## §1 — ‏מטרה

A. ‏auto-reconnect לא ישלח לעולם `session/load` ‏עם `sessionId: null`. ‏אם אין סשן לשחזר —
   ‏ה-reconnect הוא no-op (‏מצב `disconnected`), ‏בדיוק כמו `reconnect()` ‏הציבורי.
B. ‏ה-PWA manifest ייטען נכון בטלפון מאחורי Cloudflare Access.

---

## §2 — Scope

| ‏פעולה | ‏כן/לא |
|------|------|
| A: guard ל-`#doReconnect` ‏מול `#sessionId/cwd/#cliKind === null` | ✅ |
| A: הסרת ה-`!` ‏המסוכן ב-`#coldReconnect` (defensive) | ✅ |
| A: טסט יחידה — ‏סגירה לא-צפויה ב-`#sessionId===null` ‏לא מפעילה cold loadSession | ✅ |
| B: `crossorigin="use-credentials"` ‏ל-`<link rel="manifest">` ‏ב-app.html | ✅ |
| ‏שינוי לוגיקת warm/cold עצמה (‏מעבר ל-guard) | ❌ |
| ‏הוספת service worker / שינוי תוכן ה-manifest | ❌ |
| ‏שינוי policy ב-Cloudflare Access | ❌ (‏חלופה אפשרית ל-B; ‏לא בקוד — ‏מחוץ ל-scope) |

---

## §3 — ‏שורש הבעיה (‏מאומת מול הקוד)

### A. `#doReconnect` ‏חסר את ה-guard של `reconnect()`

`packages/frontend/src/lib/view-models/agent-session.svelte.ts`:

- `reconnect()` ‏הציבורי **‏מגן** (‏שורה 649):
  ```js
  reconnect = async (): Promise<void> => {
    if (this.#sessionId === null || this.cwd === null || this.#cliKind === null) return
    ...
  ```
- ‏אבל נתיב ה-auto: `transport.onClose` → `#handleUnexpectedClose` (267) → `#scheduleReconnect` (276)
  → `#runReconnectLoop` (284) → **`#doReconnect` (324)** — **‏ללא guard**. ‏הוא ממשיך ל-
  `#findReusableAgent` → (‏warm נכשל/אין) → **`#coldReconnect` (352)**, ‏ששולח בשורה **365**:
  ```js
  await this.loadSession({ sessionId: this.#sessionId!, cwd: this.cwd!, cliKind: this.#cliKind! })
  ```
  ‏ה-`!` ‏הוא assertion של TypeScript בלבד — ‏אין בדיקת runtime. ‏כש-`#sessionId===null` → ‏נשלח `null`.

**‏למה רק בטלפון**: `#handleUnexpectedClose` ‏רץ רק על קוד סגירה ≠ 1000/1001 (‏שורה 480/422/607).
‏במובייל ה-WS נסגר ב-1006 (‏רקע/מעבר רשת) **‏הרבה יותר**. ‏אם הסגירה קורת כש-`#sessionId`
‏עדיין `null` (‏למשל WS שנפל באמצע הקמת חיבור — ‏`#sessionId` ‏נקבע רק בהצלחה: `attach`:489,
`loadSession`:626) → ‏לולאת reconnect שולחת `null` ‏שוב ושוב (‏עד `#MAX_RECONNECT_ATTEMPTS`),
‏כל ניסיון יוצר agent חדש. ‏במחשב ה-WS יציב → ‏כמעט לא קורה.

> **‏פתק ל-Avigail**: ‏לאמת ש-`#doReconnect` (324) ‏אכן ‏ללא guard; ‏ש-`reconnect()` (649) ‏עם guard;
> ‏ש-`#coldReconnect`:365 ‏משתמש ב-`this.#sessionId!`; ‏ושלולאת `#runReconnectLoop` ‏קוראת `#doReconnect`.

### B. manifest מאחורי Cloudflare Access

`packages/frontend/src/app.html` ‏שורה 9: `<link rel="manifest" href="/manifest.webmanifest" />`
‏— ‏ללא `crossorigin`. ‏הדפדפן מושך manifest **‏אנונימית** (‏ללא ה-Access cookie) → Cloudflare
‏מחזיר redirect (301/302) ‏ל-`musicode1.cloudflareaccess.com/.../login` ‏במקום הקובץ. ‏ה-BE
‏עצמו מגיש `manifest.webmanifest` → **200** `application/manifest+json` (‏אומת מקומית על :4001).

> **‏פתק ל-Avigail**: ‏לאמת ש-app.html:9 ‏אכן ‏ללא `crossorigin`; ‏שהקובץ קיים ב-
> `packages/frontend/static/manifest.webmanifest`.

---

## §4 — ‏שלבים בסדר

### Commit 1 — A: guard ל-`#doReconnect` + הסרת `!`

1. ‏בתחילת `#doReconnect` (‏לפני `if (this.#transport)`):
   ```js
   // אין סשן/cwd/cliKind → אין מה לשחזר (מראה את guard של reconnect():649).
   // מונע session/load: null בלולאת auto-reconnect (קורה בטלפון: WS 1006 לפני שנקבע sessionId).
   if (this.#sessionId === null || this.cwd === null || this.#cliKind === null) {
     this.#reconnecting = false
     this.#setStatus("disconnected")
     return
   }
   ```
2. ‏ב-`#coldReconnect` (365): ‏אחרי שה-guard קיים upstream, ‏ה-`!` ‏בטוח; ‏בכל זאת — ‏המר ל-
   ‏משתנים מקומיים מאומתים (defensive, ‏בלי שינוי התנהגות):
   ```js
   const sid = this.#sessionId, cwd = this.cwd, cliKind = this.#cliKind
   if (sid === null || cwd === null || cliKind === null) return  // לא אמור לקרות (guard ב-#doReconnect)
   await this.loadSession({ sessionId: sid, cwd, cliKind })
   ```

**Verification**: `pnpm --filter @drive-coding/frontend-v2 typecheck` ‏נקי.

### Commit 2 — A: טסט יחידה

> **‏עדכון אחרי אימות אביגיל (finding 🟡 — ‏חובה)**: ‏אין נתיב ציבורי להגיע ל-`#doReconnect`
> ‏עם `#sessionId===null` (`reconnect()` ‏חוזר מוקדם בדיוק על קלט זה). ‏לכן **‏חובה** ‏להוסיף
> ‏test-only hook `_doReconnectForTest()` ‏שקורא ישירות ל-`#doReconnect` (‏כמו הדפוס הקיים
> `_wouldReconnectOnCloseForTest`/`_mockWarmReconnectForTest`).

‏ב-`agent-session.svelte.ts`: ‏הוסף `_doReconnectForTest = () => this.#doReconnect()` (test-only, ‏ליד ה-hooks הקיימים).

‏ב-`agent-session.reconnect.test.svelte.ts`: ‏טסט חדש —
‏session טרי (`#sessionId===null`), ‏spy/mock על `loadSession`, ‏קריאה ל-`_doReconnectForTest()`,
‏ואז `expect(loadSession).not.toHaveBeenCalled()` + ‏`expect(session.status).toBe("disconnected")`.
‏אסור לשבור טסטים קיימים.

**Verification**: `pnpm test` — ‏הטסט החדש עובר; ‏0 רגרסיות (‏מעבר ל-3 ה-pre-existing הידועים:
lint-no-hebrew SyntaxError + 2× bridge spawn timeout).

### Commit 3 — B: manifest crossorigin

‏ב-`app.html:9`:
```html
<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials" />
```

**Verification**: build נקי; ‏ה-tag מופיע ב-`build/index.html` ‏אחרי build.

### ‏פריסה (‏אחרי calev GO)

‏commit ל-dev → `git push origin dev` → ‏על cli-agents: `git -C dev pull --ff-only` →
`systemctl --user restart voice-acp-dev.service` → ‏בדיקת משתמש בטלפון.

---

## §5 — ‏אסטרטגיית בדיקות

- **‏סטטי**: typecheck + build נקיים.
- **‏יחידה**: הטסט החדש (Commit 2) — ‏ה-guard מונע cold loadSession ב-null. ‏פלוס אי-רגרסיה
  ‏בכל טסטי `agent-session.reconnect.test`.
- **‏runtime (calev light)**: ‏על staging אחרי deploy — ‏אמת ש-`session/load: null` ‏לא מופיע יותר
  ‏ב-journal בעת reconnect, ‏ושאין לולאת agents חדשים.
- **‏בדיקת משתמש**: ‏בטלפון — ‏החיבור/reconnect עובד; ‏ה-manifest נטען (DevTools → Application →
  Manifest ‏ללא שגיאה / "‏הוסף למסך הבית" ‏עובד).

---

## §6 — ‏סיכונים

| ‏סיכון | ‏מיטיגציה |
|------|---------|
| ‏ה-guard ב-`#doReconnect` ‏חוסם reconnect לגיטימי | ‏לא — ‏הוא זהה ל-guard של `reconnect()` ‏הציבורי (649) ‏שכבר נחשב נכון; ‏אם `#sessionId===null` ‏אין סשן לשחזר בהגדרה |
| ‏`crossorigin="use-credentials"` ‏שובר טעינת manifest כשאין Access | ‏לא — ‏זה הדפוס הסטנדרטי ל-PWA מאחורי auth; same-origin עם credentials עובד גם ללא Access |
| ‏הטסט תלוי במבנה פנימי (#private) | ‏השתמש ב-test-only hooks קיימים; ‏הוסף hook מינימלי אם צריך (‏כמו הקיימים) |

---

## §7 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל |
|---|------|----------|
| 1 | ‏לתקן B גם ב-Cloudflare Access (bypass policy ל-manifest/icons)? | ‏לא עכשיו — ‏תיקון ה-`crossorigin` ‏מספיק; ‏Access נשאר על שאר הנכסים |
| 2 | ‏לתקן גם את prod (`main`/`voice-acp-main`)? | ‏לא בסלייס הזה — ‏רק dev/staging; ‏main בנפרד אחרי אימות |

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י המבצע)

- ...
