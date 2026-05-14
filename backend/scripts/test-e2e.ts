/**
 * בדיקת E2E — מתחבר ל-WebSocket של השרת, שולח init + text (מדלג על STT),
 * ומדפיס את כל ההודעות שמתקבלות עד `done`.
 */

const URL = process.env.WS_URL ?? "ws://localhost:3000/ws";
const CWD = process.argv[2];
const TEXT = process.argv[3];

if (!CWD || !TEXT) {
  console.error('שימוש: bun scripts/test-e2e.ts <cwd> "<טקסט>"');
  process.exit(1);
}

console.log(`מתחבר ל-${URL}…`);
const ws = new WebSocket(URL);
let audioReceived = false;

const start = Date.now();

ws.addEventListener("open", () => {
  console.log(`[+${Date.now() - start}ms] מחובר. שולח init…`);
  ws.send(JSON.stringify({ type: "init", cwd: CWD }));
});

ws.addEventListener("message", (ev) => {
  const t = Date.now() - start;
  const msg = JSON.parse(ev.data.toString());

  switch (msg.type) {
    case "ready":
      console.log(`[+${t}ms] ready session=${msg.sessionId}`);
      console.log(`[+${t}ms] שולח text: ${TEXT}`);
      ws.send(JSON.stringify({ type: "text", text: TEXT }));
      break;
    case "thinking":
      console.log(`[+${t}ms] thinking (התחיל לעבד)`);
      break;
    case "text_chunk":
      if (msg.kind === "message") {
        process.stdout.write(msg.text);
      } else {
        process.stderr.write(`\x1b[2m${msg.text}\x1b[0m`);
      }
      break;
    case "audio_ready":
      audioReceived = true;
      console.log(`\n[+${t}ms] audio_ready (${msg.data.length} chars base64)`);
      // שמירה לקובץ זמני לבדיקה
      const buf = Buffer.from(msg.data, "base64");
      Bun.write("/tmp/voice-acp-e2e.mp3", buf);
      console.log(`           נשמר ב-/tmp/voice-acp-e2e.mp3 (${buf.length} bytes)`);
      break;
    case "done":
      console.log(`[+${t}ms] done (audio=${audioReceived ? "yes" : "no"})`);
      ws.close();
      break;
    case "transcript":
      console.log(`[+${t}ms] transcript: ${msg.text}`);
      break;
    case "error":
      console.error(`[+${t}ms] שגיאה: ${msg.message}`);
      ws.close();
      process.exit(1);
    default:
      console.log(`[+${t}ms] לא ידוע:`, msg);
  }
});

ws.addEventListener("close", () => {
  console.log(`[+${Date.now() - start}ms] חיבור נסגר`);
  process.exit(audioReceived ? 0 : 1);
});

ws.addEventListener("error", (e) => {
  console.error("שגיאת WebSocket:", e);
  process.exit(1);
});

// timeout כללי
setTimeout(() => {
  console.error("\nTimeout (60s)");
  process.exit(2);
}, 60_000);
