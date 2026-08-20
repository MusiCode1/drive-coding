/**
 * disconnect-banner.ts — איזה באנר ניתוק להציג (slice gone-banner).
 *
 * טהור: banner (presence) קודם ל-turnStalled. gone באמצע תור לא יוסתר
 * מאחורי "ייתכן שהוא עדיין עובד".
 */

export type PresenceBanner = "reconnecting" | "cloudflare" | "gone"
export type BannerView = PresenceBanner | "turnStalled" | null

export function pickBannerView(
  banner: PresenceBanner | null,
  turnStalled: boolean,
): BannerView {
  if (banner !== null) return banner // gone קודם ל-turnStalled — כאן זה נאכף
  return turnStalled ? "turnStalled" : null
}
