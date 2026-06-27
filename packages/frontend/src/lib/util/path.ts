/** שם הרכיב האחרון בנתיב (basename), חוצה-פלטפורמה: מפצל על / וגם \.
 *  מסיר לוכסנים סוגרים. נתיב ללא מפריד → מוחזר כמו שהוא. ריק → "". */
export function basename(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).at(-1) ?? path
}
