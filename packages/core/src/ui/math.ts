/**
 * Linear interpolation: ערך נע לעבר יעד בשבר factor (0..1). טהור.
 * @param current - הערך הנוכחי
 * @param target - הערך היעד
 * @param factor - שבר המעבר, בין 0 (נשאר ב-current) ל-1 (עובר ל-target)
 */
export function lerp(current: number, target: number, factor: number): number {
  return current + (target - current) * factor
}
