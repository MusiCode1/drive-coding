/**
 * select.ts — בחירת מודל-קול טהורה (pure function).
 *
 * פונקציה טהורה: לא יודעת על fetch/proxy/SDK — רק ממפה (service, config) → ref.
 * כלל-זהב D5 (functional core): בחירת-המודל היא פונקציה טהורה ב-core;
 * ה-IO (קריאת ה-SDK) נשאר ב-shell.
 *
 * V2 יוסיף provider-branch ב-adapters (לא כאן).
 */
import type { VoiceConfig, VoiceModelRef, VoiceService } from "./capabilities"

/** מחזיר את ה-{provider, model} שמוגדר ל-service ב-config. פונקציה טהורה. */
export function select(service: VoiceService, config: VoiceConfig): VoiceModelRef {
  return config[service]
}
