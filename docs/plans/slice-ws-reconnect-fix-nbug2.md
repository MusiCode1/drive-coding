# slice-ws-reconnect-fix-nbug2 — תיקון NBug2 (cold-close מצית onClose ישן → agent יתום)

> **סוג**: fix ממוקד על worktree קיים (`slice-ws-reconnect-infra`), לא slice חדש.
> **base**: branch `slice-ws-reconnect-infra` tip `db7c212` (לא dev — ממשיכים בשרשרת).
> **depends_on**: `[]` (עצמאי; `model-status-control-replay` רץ במקביל על base אחר).
> **complexity**: 3 → verifier `calev` (mode: light), אך **re-verify ממוקד** על DoD#6/#16
> בנתיב reconnect()-על-WS-חי + warm-fail→cold בלבד (שאר ה-DoD כבר ירוקים בדוח db7c212).

## §1 — הבעיה (מאומתת ע"י calev + מרדכי בקוד)

`#coldReconnect` (agent-session.svelte.ts:233) קורא `this.#client?.close()` (:237) כדי
לסגור את ה-WS הישן לפני `loadSession`. אבל `WsAcpTransport.close()` (ws-transport.ts:80-87)
קורא `ws.close()` **בלי code** → הדפדפן שולח **1005**. ה-WS הישן עדיין החזיק onClose
listener שנרשם ב-`attach`(:347-352) או `loadSession`(:465-470), שבודק `code!==1000&&1001`.
**1005 עובר את התנאי** → `#handleUnexpectedClose`(:160) → `#scheduleReconnect`(:169) →
**לולאת `#runReconnectLoop` שנייה** → cold שני → `createAgent` שני → agent יתום שה-
`deleteAgent(prevAgentId)` של ה-cold הראשון לא מכסה. ה-יתום **שורד `detach()`** (עד reaper, ~5 דק').

**הנתיבים שמדליפים** (ה-WS הישן עדיין חי כש-cold נכנס):
1. `reconnect()` ציבורי על WS חי (לחיצת UI "reconnect" בלי שה-WS נפל).
2. **warm-fail→cold כשהכשל הוא MED-8 ולא נפילה אמיתית** — נתיב מתוכנן, לא פינה.

**הנתיב שלא מדליף** (ולכן NBug1 כן תוקן): auto-cold-after-crash — ה-WS המקורי כבר מת
לפני `#client.close()` → אין onClose נוסף → אין לולאה שנייה.

**למה ה-`#reconnecting` guard (:170) לא חוסם**: בנתיב reconnect() הציבורי הדגל אופס
ל-`false` (:509) לפני `#doReconnect`; ה-onClose הישן יורה **בתוך** ה-`#coldReconnect`
כשהדגל כבר נקי. בנתיב warm-fail→cold הדגל אמנם true בתוך הלולאה, אך ה-onClose הישן
יורה ומריץ `#scheduleReconnect` שבודק את ה-guard — צריך לאמת בקוד שזה אכן חוסם
(ראה §5 הערה).

## §2 — הפתרון: flag `#tearingDown` (אופציה ב' של calev, מתיישב עם דפוס `#detached`)

הדפוס הקיים `#detached` (:110) כבר עושה בדיוק את זה: ה-onClose בודק `if (this.#detached) return`
(:293, :348, :466) כדי להתעלם מ-1005 מזויף אחרי detach מכוון. נוסיף flag מקביל
`#tearingDown` שמסמן "אני בתוך סגירת WS מכוונת ב-cold" — וה-onClose יכבד אותו.

### Commit יחיד — `fix(ws-reconnect): suppress stale onClose during cold teardown (NBug2)`

**testing: tdd** (כתוב טסט שמשחזר את הלולאה השנייה תחילה — אדום → ירוק).

#### 2.א — שדה חדש (ליד `#detached`, :110) + test-helper

```ts
/**
 * True בזמן סגירת WS מכוונת בתוך #coldReconnect. מונע מה-onClose הישן
 * (שמקבל 1005 מ-#client.close()) להצית לולאת reconnect שנייה (NBug2).
 * שונה מ-#detached: detach=סיום סופי; tearingDown=מעבר זמני בתוך cold.
 */
#tearingDown = false
```

ובאזור ה-test-helpers הקיים (ליד `_setStatusForTest`, :122-123) הוסף **שני** helpers
שמאפשרים לכתוב את הטסט של DoD#1 ברמת ה-flag (בלי WebSocket אמיתי / mock כבד):

```ts
/** @internal */ _setTearingDownForTest(v: boolean): void { this.#tearingDown = v }
/**
 * @internal **predicate טהור** — מחזיר האם onClose עם ה-code הנתון *היה* מצית
 * reconnect, לפי אותה שרשרת gate כמו ה-handlers האמיתיים (#detached → #tearingDown
 * → 1000/1001). **אינו מריץ** את #handleUnexpectedClose/#scheduleReconnect — כדי
 * שהטסט לא יצית #runReconnectLoop עם setTimeout תלוי / async מודלף. הטסט בודק רק
 * את הערך המוחזר.
 */
_wouldReconnectOnCloseForTest(code: number): boolean {
  if (this.#detached) return false
  if (this.#tearingDown) return false
  return code !== 1000 && code !== 1001
}
```

> ⚠️ **חשוב**:
> 1. ה-helper חייב לשכפל **בדיוק** את שרשרת התנאים של ה-onClose האמיתיים (2.ג) —
>    אותו סדר: `#detached` → `#tearingDown` → code. זו הדרך לאמת שה-gate נכון בלי WebSocket.
> 2. ה-helper הוא **predicate טהור** — אסור שיקרא `#handleUnexpectedClose` (שמפעיל
>    `#scheduleReconnect`→`#runReconnectLoop`→`setTimeout` תלוי + `listAgents`/`createAgent`
>    mocked→undefined). זה היה מדליף async/טיימר בטסט. הטסט בודק רק boolean — אין צורך
>    ב-`vi.useFakeTimers`.
> 3. ⚠️ **מלכודת DRY**: ב-2.ג ה-onClose האמיתיים מבצעים את הבדיקה *בתוך* ה-handler.
>    ה-helper מכפיל את הלוגיקה. ודא ששתי הנוסחאות **נשארות מסונכרנות** — אם תשנה את
>    סדר התנאים ב-2.ג, עדכן גם כאן. (אין refactor למקור-אמת אחד כדי לא לסבך 2 שורות flag.)

#### 2.ב — שמירה על ה-flag ב-`#coldReconnect` (:233-252)

עוטפים את ה-`#client?.close()` ב-flag, ומשחררים אותו רק בסוף `#coldReconnect`.
**הדפדפן מ-dispatch את ה-`close` event אסינכרונית** (כ-task — `ws.close()` לעולם לא
קורא ל-handler סינכרונית; רק ה-fan-out ל-listeners *בתוך* ה-handler, ws-transport.ts:51-56,
סינכרוני ברגע שה-event כבר נורה). לכן set/unset סינכרוני צמוד סביב `close()` **לא יכסה**
את החלון — ה-event עלול לירות אחרי 1-2 awaits. הפתרון: שמור `#tearingDown=true` לפני close,
ושחרר אותו ב-`finally` **רק אחרי ש-`loadSession` חוזר** (ה-WS החדש כבר פעיל). כך הדגל true
לכל אורך `#coldReconnect`, וה-onClose הישן שיורה מתי שהוא בתוך החלון רואה `true` ומדלג.

```ts
#coldReconnect = async (): Promise<void> => {
  const prevAgentId = this.agentId
  this.#tearingDown = true          // NBug2: השתק onClose ישן (1005) של ה-WS שאנו סוגרים
  try {
    try { this.#client?.close() } catch { /* כבר סגור */ }
    this.#client = null
    if (this.status === "connecting" || this.status === "connected") {
      this.#setStatus("disconnected")
    }
    await this.loadSession({
      sessionId: this.#sessionId!,
      cwd: this.cwd!,
      cliKind: this.#cliKind!,
    })
  } finally {
    this.#tearingDown = false       // שחרר אחרי שה-WS החדש פעיל
  }
  if (prevAgentId && prevAgentId !== this.agentId) {
    void deleteAgent(prevAgentId).catch(() => {})
  }
}
```

> ⚠️ **שים לב**: ה-`loadSession` החדש רושם onClose **חדש** על ה-transport **החדש**
> (:465-470). ה-`#tearingDown=true` חל גם עליו, אבל ה-transport החדש לא נסגר במהלך
> ה-teardown (רק נפתח), אז ה-onClose החדש לא יורה בזמן הזה. כשנשחרר ל-false ב-finally,
> ה-onClose החדש שוב פעיל לנפילות עתידיות. ✅ נכון.

#### 2.ג — ה-onClose מכבד את ה-flag (3 אתרים: :293, :347-352, :465-470)

בכל שלושת ה-onClose handlers, הוסף את הבדיקה ליד `#detached`:

```ts
transport.onClose((code, reason) => {
  if (this.#detached) return
  if (this.#tearingDown) return        // NBug2: סגירה מכוונת ב-cold — אל תצית reconnect
  if (code !== 1000 && code !== 1001) this.#handleUnexpectedClose(code, reason)
})
```

ה-onClose ב-`#warmReconnect`(:292) — הוסף את אותה שורה **כ-defensive בלבד** (אחידות).
שים לב: בנתיב הנוכחי warm רץ **לפני** cold ב-`#doReconnect`(:211-223), כך שה-flag לעולם
לא true כשה-handler הזה חי — הבדיקה אינרטית. מוסיפים אותה רק לעקביות (כל 4 ה-onClose
זהים), לא כי יש תרחיש שמצית אותה היום.

## §3 — מה לא לגעת

- **אל תשנה את `WsAcpTransport.close()`** (אופציה ג' של calev) — היא משנה התנהגות גלובלית
  ופוגעת ב-`detach`/`switchSession`. נדחתה.
- **אל תוסיף `offClose`** (אופציה א') — דורש refactor רחב + ה-VM לא שומר ref ל-transport
  הישן. נדחתה לטובת הפתרון הממוקד.
- **WARM** (`#warmReconnect`) לא סוגר WS חי — ה-flag לא משפיע עליו. אל תשנה את הלוגיקה שלו.
- **auto-cold-after-crash** — ה-WS כבר מת; ה-flag פשוט מיותר שם (לא מזיק).

## §4 — DoD

1. **טסט אדום→ירוק (tdd) ברמת ה-flag** ב-`agent-session.reconnect.test.svelte.ts`
   (הנתיב הישים — אין WebSocket global ב-node, `#client` private, אז **לא** משחזרים את
   הלולאה דרך WS אמיתי. בודקים את ה-gate ישירות דרך ה-predicate `_wouldReconnectOnCloseForTest`,
   שלא מצית reconnect → אין טיימרים/async בטסט):
   - **טסט-gate (הליבה)**: `session._setTearingDownForTest(true)`; ואז
     `expect(session._wouldReconnectOnCloseForTest(1005)).toBe(false)` — 1005 בזמן teardown
     לא היה מצית reconnect. **לפני** הוספת בדיקת ה-`#tearingDown` ב-predicate (אדום) הוא
     יחזיר true; **אחרי** (ירוק) false.
   - **טסט-control חיובי**: `_setTearingDownForTest(false)` →
     `_wouldReconnectOnCloseForTest(1005)` מחזיר **true** (1005 רגיל כן היה מצית reconnect —
     מוודא שלא שברנו את ההתנהגות התקינה). predicate טהור → אין `#runReconnectLoop`, אין טיימר.
   - **טסט-detach גובר**: `session.detach()` קודם → `_wouldReconnectOnCloseForTest(1005)`
     מחזיר false (ה-`#detached` עדיין חוסם — מוודא סדר תנאים נכון).
   - **טסט-1000/1001**: `_wouldReconnectOnCloseForTest(1000)` ו-`(1001)` מחזירים false תמיד
     (סגירה תקינה לא מציתה reconnect, ללא קשר ל-flag).
2. `#tearingDown` מוגדר false כברירת מחדל ו-true רק בתוך `#coldReconnect`.
3. כל 3 (4 עם warm) ה-onClose handlers בודקים `#tearingDown`.
4. `pnpm typecheck` exit 0.
5. `pnpm --filter @drive-coding/frontend-v2 build` — נקי. **(שם החבילה: `-v2`!)**
6. כל טסטי ה-reconnect הקיימים עדיין עוברים (אין רגרסיה ב-WARM/auto-cold/backoff/detach).
7. **calev re-verify ממוקד** מאשר: `reconnect()` על WS חי → n נשאר 1 (אין יתום),
   detach אחרי reconnect → n→0, warm-fail→cold (MED-8) → n נשאר 1.

## §5 — הערות לאליעזר

- **קרא `EXECUTOR_DISPATCH.md`** לפני שמתחיל.
- שם חבילת FE = **`@drive-coding/frontend-v2`** (לא `frontend`) — כל פקודות pnpm.
- ה-fix הוא ב-worktree הקיים `.worktrees/slice-ws-reconnect-infra` על branch
  `slice-ws-reconnect-infra` (tip db7c212). Commit נוסף על השרשרת.
- **הטסט (DoD#1) הוא ברמת ה-flag, לא ברמת WS** — כי env=node אין בו `WebSocket`,
  `#client` private, ו-`createAcpClient` לא mocked. **אל תנסה** להזריק `#client` מזויף או
  לשחזר את הלולאה דרך WS אמיתי — זו מלכודת (אביגיל תפסה אותה). השתמש ב-`_wouldReconnectOnCloseForTest`
  (predicate טהור) ו-`_setTearingDownForTest` (§2.א). ה-predicate חייב לשכפל בדיוק את שרשרת
  התנאים של ה-onClose, ו**אסור** שיריץ `#handleUnexpectedClose` (טיימר/async מודלף).
  הוכחת האמת ש-NBug2 נסגר באה מ-**calev בשטח** (BE חי), לא מהטסט הזה.
- **אם אתה מגלה שה-`#reconnecting` guard כבר חוסם את נתיב ה-warm-fail→cold** (כי הדגל
  true בתוך הלולאה): מצוין, אבל ה-flag עדיין נדרש לנתיב `reconnect()` הציבורי (שם הדגל
  אופס ל-false). אל תוותר על ה-flag.
- אם משהו ארכיטקטוני לא מסתדר — **עצור ושאל את מרדכי**. אל תמציא פתרון אחר.
