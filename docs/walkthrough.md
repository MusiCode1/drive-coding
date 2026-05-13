# Walkthrough — voice-acp

יומן התקדמות הפרויקט. רשומה חדשה בראש הקובץ.

---

## 2026-05-13 22:37

### השלמת שלב התכנון — מפרט מוכן לבנייה

הסשן הזה לא כלל כתיבת קוד; כולו תכנון ועיגון החלטות במסמכים. הפרויקט מוכן עכשיו לסשן בנייה של ה-POC.

#### מה בוצע?

**1. אישור הארכיטקטורה הכוללת**

- `Browser → WebSocket → Bun backend → opencode acp (child process)`
- Frontend: HTML בודד עם vanilla JS, בלי build step.
- Backend: Bun native WebSocket, ללא framework.
- ACP: `@agentclientprotocol/sdk` v0.16.1, `ClientSideConnection` מעל stdin/stdout של `opencode acp`.

**2. בחירת ספקי STT/TTS**

- **STT — Gemini** (במקום Whisper). הסיבה: לפי המשתמש, Gemini מתמלל עברית "עם הרבה יותר הגיון מ-Whisper".
- **TTS — ElevenLabs** דרך REST (fetch ישיר, בלי SDK — overhead מיותר ל-POC).
- אימות שני המפתחות בוצע בסשן: ElevenLabs פעיל (חשבון `creator`, ~277k תווים); Gemini פעיל.

**3. עדכון מודל ה-STT ל-alias של הגרסה האחרונה**

- `gemini-2.0-flash` → `gemini-flash-lite-latest`.
- ה-alias מתעדכן אוטומטית, לא נועל גרסה.
- Flash Lite מספיק ל-STT (מהיר וזול יותר מ-Flash הרגיל).

**4. מעבר לניהול מפתחות דרך OneCLI**

- אין יותר קובץ `backend/.env` למפתחות.
- הקוד מאתחל SDKs עם המחרוזת `"placeholder"`; OneCLI proxy מחליף את ה-headers בדרך לhosts הרלוונטיים.
- ה-env var היחיד שנשאר הוא `ELEVENLABS_VOICE_ID` (חלק מה-URL, לא header).
- `spec.md §6, §10` ו-`AGENTS.md` עודכנו בהתאם.

#### החלטות ארכיטקטורה

- **STT דרך Gemini ולא Whisper** — בחירת איכות לעברית על פני סטנדרט תעשייתי. ההפרדה ב-`stt.ts` שומרת שניתן יהיה להחליף בעתיד בקלות.
- **OneCLI proxy במקום `.env`** — מונע שמירת secrets בקוד או בקבצים מקומיים. הקוד שולח placeholder, ה-proxy מזריק את המפתח האמיתי לפי host. יתרון: אותו קוד עובד אצל כל מי שיש לו OneCLI עם ה-secrets הנכונים.
- **`gemini-flash-lite-latest` alias** — מתעדכן אוטומטית לדור הבא; אין צורך לתחזק גרסה.
- **REST ישיר ל-ElevenLabs, בלי SDK** — קריאת `POST` אחת עם טקסט → MP3. SDK יוסיף תלות בלי תועלת ל-POC.
- **דחיות מודעות ב-POC**: streaming TTS (מחכים לתשובה מלאה), permission dialogs (ACP במצב yolo — אישור אוטומטי).

#### מצב הקבצים בסוף השלב

- `README.md` — תיאור קצר + פקודות הפעלה.
- `AGENTS.md` — הוראות סוכן: מבנה, חוקי עבודה, definition of done; מעודכן ל-OneCLI.
- `docs/spec.md` — מפרט מלא: ארכיטקטורה, פרוטוקול WebSocket, stubs ל-`acp-bridge`/`stt`/`tts`/`server`, URL params, state machine של הכפתור, סדר בנייה מוצע.
- `docs/walkthrough.md` — הקובץ הזה.

#### צעדים הבאים

הסשן הבא: פתיחת הפרויקט והתחלת בנייה לפי סדר ה-13 ב-spec (התקנה → backend skeleton → STT/TTS → ACP bridge → frontend).
