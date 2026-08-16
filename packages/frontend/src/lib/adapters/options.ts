/**
 * options.ts — adapter עבור GET /api/options (Slice 24).
 *
 * מחזיר homeDir מהשרת.
 * homeDir משמש כברירת מחדל לשדה cwd ב-connect page כשאין ערך שמור ב-localStorage.
 * (היסטורי: החזיר גם models+projects — נמחקו 2026-07-10, היו dead payload.
 *  המקביל בצד השרת: packages/backend/src/delivery/http-options.ts.)
 */

import { beUrl } from "$lib/util/be-url"

export type ServerOptions = {
  homeDir: string
}

/**
 * מביא את אפשרויות השרת. זורק אם הבקשה נכשלת.
 */
export async function fetchServerOptions(): Promise<ServerOptions> {
  const res = await fetch(beUrl("/api/options"))
  if (!res.ok) throw new Error(`/api/options ${res.status}`)
  return res.json() as Promise<ServerOptions>
}
