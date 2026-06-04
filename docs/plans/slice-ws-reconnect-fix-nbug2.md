# slice-ws-reconnect-fix-nbug2 — תיקון NBug2 (WS חי נדרס ב-warm → agent יתום קבוע)

> **סוג**: fix ממוקד על worktree קיים (`slice-ws-reconnect-infra`), FE בלבד.
> **base**: branch `slice-ws-reconnect-infra` tip `58fed7a` (לא dev — ממשיכים בשרשרת).
> **depends_on**: `[]` (עצמאי).
> **complexity**: 4 → verifier `calev` (mode: light), **re-verify ממוקד** על DoD#6/#7
> בנתיב `reconnect()`-על-WS-חי + warm-fail→cold (MED-8).
>
> ⚠️ **שכתוב מלא של גישה.** הגרסה הקודמת (flag `#tearingDown` שמשתיק onClose ישן) קיבלה
> calev **NO-GO** (n=3 agents). הסיבה: ה-flag טיפל בתסמין הלא-נכון (1005 stale onClose),
> אבל השורש האמיתי שונה — ראה §1. ה-`#tearingDown` שכבר קיים ב-tip 58fed7a **נשאר** (לא
> מזיק, מכסה את ה-1005), וה-fix הזה מוסיף עליו את הטיפול בשורש האמיתי.

## §1 — הבעיה האמיתית (מאומתת ע"י מרדכי בקוד + לוג BE של calev)

הבאג: `reconnect()` על WS חי (או כל נתיב שמגיע ל-warm כשה-WS המקורי עוד פתוח) משאיר
**agent יתום קבוע** ב-BE — לא 5 דק', **לנצח** (ה-reaper לא נוגע בו).

**שרשרת הכשל (אומתה בקוד):**
1. `reconnect()` (`agent-session.svelte.ts:534`) **לא סוגר** את ה-`#client` החי לפני
   `#doReconnect` (`:539`). ה-WS המקורי נשאר פתוח.
2. `#doReconnect` (`:231`) מנסה **warm קודם**: `#findReusableAgent` מוצא את ה-agent הישן
   (עדיין חי!) → `#warmReconnect(oldId)` (`:284`).
3. `#warmReconnect` בלולאת ה-MED-8 עושה `this.#client = null` (`:289`) — **דורס את ה-handle
   ל-WS החי בלי לסגור אותו**. ה-WS הראשון אבוד (אין reference), אך עדיין פתוח ב-BE.
4. warm פותח WS **שני** ל-`/ws/agent/<oldId>`. ה-BE (`ws-agent.ts:69-72`) רואה ב-`activeFeWs`
   שכבר יש WS לאותו agent → דוחה ב-**1008 "second tab rejected"**. כל 3 ניסיונות ה-MED-8
   נדחים זהה (ה-WS הראשון לא נסגר בינתיים) → warm נכשל → נופל ל-cold.
5. `#coldReconnect` קורא `#client?.close()` (`:259`) — אבל `#client` כבר **`null`** (נדרס
   ב-`:289`)! אז ה-WS הראשון **לעולם לא נסגר**. `loadSession` → `createAgent` → agent **חדש**.
   עכשיו n≥2 (לפעמים 3 כי deleteAgent של prevAgentId לא תמיד מכסה).

**למה ה-reaper לא מנקה (אומת ב-`bridge-manager.ts`):**
- ה-WS היתום לא נסגר → `feWs.on("close")` (`ws-agent.ts:127`) **לא נורה** → `markDetached`
  לא נקרא → `hasActiveWs` נשאר `true` לנצח.
- ה-reaper (`bridge-manager.ts:210`): `if (e.hasActiveWs) continue // active WS — never reap`.
  → **יתום קבוע**, לא timeout.

**למה זה לא נגיש בייצור היום (חשוב להבנת ה-severity):**
- **רענון דף**: הדפדפן סוגר את ה-WS → `markDetached` נורה חי → ה-VM החדש רואה `idle` →
  `goto("/")` (`chat/+page.svelte:22`). נקי. **לא מדליף.**
- **נפילת חיבור אמיתית**: ה-WS מת → ה-BE יודע → warm/cold נקיים (calev אישר ב-db7c212).
- **רק** `reconnect()` על WS **חי** מדליף — וזה נקרא היום רק דרך API ציבורי שעוד לא מחובר
  לכפתור UI. אבל זה השער שכפתור ה-reconnect העתידי יפתח, ולכן סוגרים עכשיו.

## §2 — הפתרון: סגור-והמתן-לאישור לפני warm

השורש: ה-WS החי נדרס בלי להיסגר. הפתרון: **לסגור אותו ולהמתין שה-close באמת קרה**
(close event ב-FE), **לפני** שמתחילים warm. כך, ברוב המקרים, ה-BE כבר עיבד את `markDetached`
וה-`activeFeWs` ריק לפני שה-WS החדש מגיע — וה-1008 נמנע.

> ⚠️ **כנות על race שיורי (finding אביגיל #3)**: ה-close event ב-FE וה-`feWs.on("close")`
> ב-BE הם **שני צידי TCP נפרדים** — אין הבטחה קוֹזָלית שה-FE close קורה *אחרי* שה-BE עיבד
> `markDetached`. ההמתנה **מצמצמת מאוד** את חלון ה-race (במקום לפתוח WS חדש מיד), אבל לא
> מאפסת אותו מתמטית. **רשת הביטחון הקיימת**: לולאת ה-MED-8 (`#warmReconnect`, 3 retries ×
> 250ms) — אם בכל זאת נתקלים ב-1008 בניסיון הראשון, ה-WS הישן ודאי כבר נסגר ב-BE עד ה-retry
> השני. אז גם ב-worst-case ה-warm מצליח בלי יתום. **הוודאות הסופית = calev בשטח (n=1).**
> (slice עתידי `expose-has-active-ws` יאפשר גם לוודא מול ה-BE ישירות לפני warm — אם נחליט
> שצריך רשת שלישית.)

### Commit יחיד — `fix(ws-reconnect): close live WS and await close before warm (NBug2 root)`

**testing: tdd** (טסט שמאמת ש-`#doReconnect` סוגר את ה-`#client` הקיים לפני warm).

#### 2.א — helper חדש ב-`WsAcpTransport`: `awaitClose()` / Promise שנפתר ב-close

ה-`WsAcpTransport` (`engines/ws-transport.ts`) כבר חושף `onClose(cb)` (`:89-91`) ושומר
`#closeListeners`. נוסיף מתודה שממתינה לאירוע close (או מתרצה מיד אם כבר סגור):

```ts
/**
 * מסתיים כשה-WS נסגר (close event). אם כבר סגור — מתרצה מיד.
 * משמש את ה-VM כדי לסגור WS חי ולחכות שה-BE יעבד את ה-detach לפני פתיחת WS חדש
 * (מונע race של 1008 "second tab" + agent יתום). timeout fallback מונע hang אם
 * ה-close event לא מגיע (נדיר — דפדפן תמיד יורה close).
 */
async closeAndWait(timeoutMs = 1000): Promise<void> {
  if (this.#ws.readyState === WebSocket.CLOSED) return
  const closed = new Promise<void>((resolve) => {
    this.#closeListeners.push(() => resolve())
  })
  this.close()   // קורא ws.close() — close event יגיע אסינכרונית
  await Promise.race([
    closed,
    new Promise<void>((r) => setTimeout(r, timeoutMs)),
  ])
}
```

> (בדיקת ה-`CLOSED` הראשונה מספיקה — אין צורך לשכפל אותה בתוך ה-Promise; ה-listener
> יירשם ויירה ב-close. אם רוצים הגנה מ-race שבו ה-WS נסגר בין הבדיקה לרישום: ה-timeout
> fallback מכסה את זה ממילא.)
>
> הערה על `CLOSING`: אם ה-WS במצב `CLOSING` (כבר התחיל להיסגר אך ה-close event עוד לא
> נורה) — הבדיקה `=== CLOSED` לא תופסת, אבל זה תקין: ה-listener שנרשם **כן** יירה כשה-close
> יגיע (או ה-timeout). אין צורך לבדוק `CLOSING` בנפרד.

> ⚠️ **שים לב לתזמון**: `this.close()` (`:80-87`) קורא `ws.close()`. ה-close event נורה
> **אסינכרונית** (task), ואז ה-fan-out ל-`#closeListeners` (`:51-56`) רץ סינכרונית. רישום
> ה-listener **לפני** `this.close()` מבטיח שלא נפספס את האירוע. ה-timeout (1000ms) הוא
> רשת-ביטחון בלבד — לא אמור להיגמר אף פעם.

#### 2.ב — ה-VM שומר ref ל-transport (כדי שיוכל לקרוא `closeAndWait`)

הבעיה: היום ה-VM מחזיק רק `#client` (ה-ACP client), לא את ה-transport. `#client.close()`
מגיע ל-transport, אבל אין `closeAndWait` ב-client. שתי דרכים (בחר את הפשוטה):

**דרך A (מומלצת) — שדה `#transport`**: שמור ref ל-transport ב-**3** המקומות שיוצרים אחד
(`#warmReconnect:291`, `attach:372`, `loadSession:491`), ונקה ב-detach/cleanup.
אז `#doReconnect` יכול `await this.#transport?.closeAndWait()`.

```ts
// ליד #client (:101)
#transport: WsAcpTransport | null = null

// בכל יצירת transport — שמור גם:
const transport = new WsAcpTransport(`${proto}//${location.host}/ws/agent/${agentId}`)
this.#transport = transport
```

> ⚠️ ודא שכל מקום שעושה `this.#client = null` מנקה גם `this.#transport = null` **אחרי**
> הסגירה (לא לפני — צריך את ה-ref כדי לסגור). **4 מקומות** (אומת ב-grep):
> - `#coldReconnect:260`
> - `#warmReconnect:289` (אתחול בכל iteration של MED-8) **ו-`:340`** (catch block של warm)
> - `#cleanup:745`
>
> שים לב: **ל-`loadSession` אין `#client = null`** (בניגוד למה שאפשר לחשוב). שני ה-nulls
> ב-`#warmReconnect` הם `:289` (ראש הלולאה) ו-`:340` (catch). בדוק את כל ה-4.

#### 2.ג — `#doReconnect` סוגר-וממתין לפני warm

```ts
#doReconnect = async (): Promise<void> => {
  // NBug2 root: אם יש WS חי (reconnect() על חיבור פעיל), סגור אותו והמתן שה-BE
  // יעבד detach לפני warm — אחרת ה-WS החדש נדחה ב-1008 + agent יתום קבוע.
  if (this.#transport) {
    await this.#transport.closeAndWait()
    this.#client = null
    this.#transport = null
  }
  const reuseId = await this.#findReusableAgent()
  if (reuseId !== null) {
    const ok = await this.#warmReconnect(reuseId)
    if (ok) { if (this.status === "connected") this.reconnectAttempt = 0; return }
  }
  await this.#coldReconnect()
  if (this.status === "connected") this.reconnectAttempt = 0
}
```

> ⚠️ **למה זה לא שובר auto-reconnect (נפילת חיבור אמיתית)**: שם ה-WS כבר מת לפני
> `#doReconnect` (ה-onClose שהפעיל את `#scheduleReconnect` נורה כי ה-WS נסגר). `closeAndWait`
> על WS שכבר CLOSED מתרצה מיד (`:if readyState===CLOSED return`) — no-op. ✅
> **למה זה לא שובר warm רגיל**: ה-`#warmReconnect` ימשיך לעבוד כרגיל אחרי שה-WS הישן
> נסגר נקי — ה-BE כבר שחרר את ה-agent, אז ה-WS החדש מתקבל. ✅

#### 2.ד — `#warmReconnect` כבר לא צריך לדרוס WS חי

אחרי 2.ג, כש-`#warmReconnect` מגיע, ה-`#client`/`#transport` כבר `null` (נסגרו ב-`#doReconnect`).
השורה `this.#client = null` (`:289`) הופכת ל-no-op מבחינת דליפה — אבל **השאר אותה** (היא
מאפסת בכל iteration של MED-8, וזה עדיין נכון). אל תשנה את לוגיקת ה-MED-8.

## §3 — מה לא לגעת

- **אל תשנה `WsAcpTransport.close()`** — רק **מוסיף** `closeAndWait` לידו.
- **אל תשנה את לוגיקת MED-8** ב-`#warmReconnect` (ה-retry/1008/fallback). רק 2.ב מוסיף
  שמירת `#transport` ref.
- **ה-`#tearingDown` הקיים (tip 58fed7a) נשאר** — הוא מכסה את ה-1005 ב-cold (לא מזיק,
  לא חופף ל-fix הזה). אל תמחק אותו.
- **`#coldReconnect`** — ה-`#client?.close()` (`:259`) נשאר כ-defensive, אבל אחרי 2.ג
  הוא כבר ירוץ על `null` ברוב המקרים (ה-WS נסגר ב-`#doReconnect`). זה תקין.

## §4 — DoD

1. **טסט tdd**: ב-`agent-session.reconnect.test.svelte.ts` — אמת ש-`#doReconnect` (דרך
   `reconnect()`) **סוגר את ה-transport הקיים לפני warm**. גישה ישימה (אין WebSocket ב-node):
   - הזרק transport מזויף עם `closeAndWait` נשלט (spy) דרך `attach`/test-helper, או בדוק
     ברמת predicate שה-flow קורא `closeAndWait` כשיש `#transport`.
   - ⚠️ **אם הטסט דורש WebSocket אמיתי / mock כבד של createAcpClient — עצור ושאל מרדכי.**
     אל תמציא mock infra. (זו בדיוק המלכודת מ-NBug2 סבב קודם — אביגיל/calev תפסו.)
   - לכל הפחות: טסט יחידה ל-`closeAndWait` עצמו (transport mock עם `ws` stub: readyState
     CLOSED→מתרצה מיד; OPEN→מתרצה אחרי close event; timeout fallback).
2. `closeAndWait` קיים ב-`WsAcpTransport`, רושם listener לפני `close()`, יש timeout fallback.
3. `#transport` ref נשמר בכל 3 יצירות (attach/loadSession/warm) ומנוקה בכל 4 איפוסי `#client`.
4. `#doReconnect` קורא `closeAndWait` + מנקה `#client`/`#transport` כשיש `#transport`, לפני warm.
5. `pnpm typecheck` exit 0.
6. `pnpm --filter @drive-coding/frontend-v2 build` — נקי. **(שם החבילה: `-v2`!)**
7. כל טסטי ה-reconnect הקיימים עדיין עוברים (אין רגרסיה).
8. **calev re-verify ממוקד (בשטח, BE חי)** — זו הוכחת-האמת:
   - `reconnect()` על WS חי → **n נשאר 1** (אין יתום, אין 1008 בלוג).
   - detach אחרי reconnect → n→0.
   - warm-fail→cold (MED-8, אם ניתן לשחזר) → n נשאר 1.
   - נפילת חיבור אמיתית (kill child) → auto-cold עדיין נקי (רגרסיה).

## §5 — הערות לאליעזר

- **קרא `EXECUTOR_DISPATCH.md`** לפני שמתחיל.
- שם חבילת FE = **`@drive-coding/frontend-v2`** — כל פקודות pnpm.
- ה-fix ב-worktree הקיים `.worktrees/slice-ws-reconnect-infra` (tip `58fed7a`). Commit על השרשרת.
- **הליבה**: ה-WS החי נדרס ב-`#warmReconnect:289` (`#client=null`) בלי להיסגר → יתום קבוע.
  התיקון: סגור-והמתן ב-`#doReconnect` לפני warm. זה fix של **שורש**, לא טלאי.
- **race awareness**: הסיבה ל-`closeAndWait` (ולא רק `close()`) — ה-close אסינכרוני; אם
  נפתח WS חדש מיד, ה-BE עוד יראה `activeFeWs.has(id)===true` ויחזיר 1008. ההמתנה **מצמצמת
  מאוד** את החלון (לא מאפסת — ראה §2, race שיורי two-sided). **אל תחליף ל-`close()` בלי await** —
  זה מחזיר את ה-race לרוחב מלא. ה-MED-8 retry הוא רשת הביטחון לשארית; calev בשטח (n=1) = הוודאות.
- **הוכחת-האמת היא calev בשטח (n=1)**, לא טסט היחידה. אם calev עדיין רואה 1008/n>1 —
  עצור ושאל מרדכי (אולי צריך גם לוודא מול BE שה-agent פנוי — slice נפרד מתוכנן).
- אם משהו ארכיטקטוני לא מסתדר — **עצור ושאל את מרדכי**. אל תמציא פתרון אחר.
