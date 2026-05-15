/**
 * בדיקת E2E מלאה: שולח אודיו (כמו שה-frontend יעשה) → השרת מבצע STT → ACP → TTS.
 * משתמש בקובץ אודיו קיים שמדמה הקלטה של משתמש.
 */

const URL = process.env.WS_URL ?? "ws://localhost:3000/ws";
const CWD = process.argv[2];
const AUDIO_PATH = process.argv[3];
const MIME = process.argv[4] ?? "audio/mpeg";

if (!CWD || !AUDIO_PATH) {
  console.error(
    "שימוש: bun scripts/test-e2e-audio.ts <cwd> <audio-file> [mime]",
  );
  process.exit(1);
}

const audioBuf = await Bun.file(AUDIO_PATH).arrayBuffer();
const audioB64 = Buffer.from(audioBuf).toString("base64");
console.log(`קובץ אודיו: ${AUDIO_PATH} (${audioBuf.byteLength} bytes, ${MIME})`);

const ws = new WebSocket(URL);
let audioReceived = false;
const start = Date.now();

ws.addEventListener("open", () => {
  console.log(`[+${Date.now() - start}ms] מחובר. שולח init…`);
  const voice = process.env.VOICE_ID ?? "IKne3meq5aSn9XLyUdCD";
  ws.send(JSON.stringify({ type: "init", cwd: CWD, voice }));
});

ws.addEventListener("message", (ev) => {
  const t = Date.now() - start;
  const msg = JSON.parse(ev.data.toString());

  switch (msg.type) {
    case "ready":
      console.log(`[+${t}ms] ready. שולח אודיו…`);
      ws.send(
        JSON.stringify({ type: "audio", data: audioB64, mimeType: MIME }),
      );
      break;
    case "audio_chunk":
      audioReceived = true;
      console.log(`[+${t}ms] audio_chunk (${(msg.data as string).length} chars b64)`);
      break;
    case "transcript":
      console.log(`[+${t}ms] תמלול: "${msg.text}"`);
      break;
    case "thinking":
      console.log(`[+${t}ms] thinking…`);
      break;
    case "text_chunk":
      if (msg.kind === "message") process.stdout.write(msg.text);
      else process.stderr.write(`\x1b[2m${msg.text}\x1b[0m`);
      break;
    case "audio_ready":
      audioReceived = true;
      const buf = Buffer.from(msg.data, "base64");
      Bun.write("/tmp/voice-acp-e2e-audio.mp3", buf);
      console.log(`\n[+${t}ms] audio_ready (${buf.length} bytes) → /tmp/voice-acp-e2e-audio.mp3`);
      break;
    case "done":
      console.log(`[+${t}ms] done`);
      ws.close();
      break;
    case "error":
      console.error(`[+${t}ms] שגיאה: ${msg.message}`);
      ws.close();
      process.exit(1);
  }
});

ws.addEventListener("close", () => process.exit(audioReceived ? 0 : 1));
setTimeout(() => { console.error("\nTimeout"); process.exit(2); }, 60_000);
