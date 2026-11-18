/**
 * live-transcript-scroll-config.ts — scroll-follow calibration for 12rem box.
 *
 * Full-screen chat defaults (sentinelMargin 48, distanceLines 3) are wrong here:
 * in ~192px they cover most of the viewport. Values below are tuned for this surface.
 *
 * ⏸ DoD 9–10 (eye): not re-verified on device in this session.
 *
 * ─── slice live-transcript-box ───
 */

/** px from edge that counts as "at bottom" in the 12rem transcript box */
export const LIVE_TRANSCRIPT_SENTINEL_MARGIN = 8

/** line-heights of lag before a batched jump to bottom */
export const LIVE_TRANSCRIPT_FOLLOW_DISTANCE_LINES = 1
