/**
 * ממשק מטמון אסינכרוני גנרי.
 * T הוא סוג הערך השמור; המימוש מחליט איך לשמור אותו.
 */
export interface Cache<T> {
  /** מחזיר את הערך השמור, או null אם אינו במטמון. */
  get(key: string): Promise<T | null>
  /** שומר ערך תחת המפתח הנתון. */
  set(key: string, value: T): Promise<void>
  /** מחזיר אמת אם המפתח קיים מבלי לעשות דה-סריאליזציה לערך. */
  has(key: string): Promise<boolean>
}
