#!/usr/bin/env bash
# dod-check.sh — שער-רגרסיה לסלייס. יוצא 1 על כל הרעה מול baseline.
#   שימוש:  scripts/dod-check.sh base    # לפני שמתחילים
#           scripts/dod-check.sh check   # אחרי
set -u
MODE="${1:-check}"
DIR="${DOD_DIR:-/tmp/dod}"; B="$DIR/base"; A="$DIR/after"
EXPECT_FILES="${DOD_EXPECT_FILES:-}"   # ספירת קבצי-טסט צפויה (מגן מאיסוף חלקי)

collect() {
  local out="$1"; mkdir -p "$out"
  bun run test > "$out/test.txt" 2>&1; echo $? > "$out/test.rc"
  bun run lint --max-diagnostics=1000 > "$out/lint.txt" 2>&1; echo $? > "$out/lint.rc"
  bun run --filter @drive-coding/frontend typecheck > "$out/fe.txt" 2>&1; echo $? > "$out/fe.rc"
  bun run typecheck > "$out/tsc.txt" 2>&1; echo $? > "$out/tsc.rc"
}

# עוגן בשורת Test Files — אחרת tail תופס את סוגריי שורת ה-Tests
files_total() { grep -oE 'Test Files.*\([0-9]+\)' "$1" | tail -1 | grep -oE '[0-9]+\)' | tr -d ')'; }
files_failed() { grep -oE 'Test Files +[0-9]+ failed' "$1" | tail -1 | grep -oE '[0-9]+'; }
tests_failed() { grep -oE 'Tests +[0-9]+ failed' "$1" | tail -1 | grep -oE '[0-9]+'; }
fe_errors()  { grep -oiE '[0-9]+ ERRORS' "$1" | tail -1 | grep -oE '[0-9]+'; }
tsc_errors() { grep -cE 'error TS' "$1" || true; }
# camelCase חובה — [a-z/] חותך noNonNullAssertion ל-no
lint_ids() { grep -oE "^[a-z][^ ]*\.(ts|svelte|js|mjs|json|jsonc):[0-9]+:[0-9]+ [a-zA-Z/]+" "$1" | sort; }

if [ "$MODE" = "base" ]; then
  collect "$B"
  n=$(files_total "$B/test.txt")
  [ -n "$n" ] || { echo "❌ baseline: אין שורת סיכום — הריצה קרסה"; exit 1; }
  bf0=$(files_failed "$B/test.txt"); echo "baseline: $n קבצים · ${bf0:-0} כושלים"
  echo "⚠️  אם הספירה נמוכה מהצפוי — איסוף חלקי (עומס מקביל). הרץ שוב."
  exit 0
fi

collect "$A"; fail=0
say() { echo "❌ $*"; fail=1; }
for k in test lint fe tsc; do [ -s "$B/$k.txt" ] || { echo "❌ אין baseline ($k) — הרץ 'base'"; exit 1; }; done

bn=$(files_total "$B/test.txt"); an=$(files_total "$A/test.txt")
[ -n "$an" ] || say "אין שורת סיכום בטסטים — הריצה קרסה (rc=$(cat $A/test.rc))"
[ -n "$an" ] && [ "$an" = "$bn" ] || say "ספירת קבצים: $bn → ${an:-?} (איסוף חלקי? הרץ שוב)"
[ -n "$EXPECT_FILES" ] && [ "${an:-0}" != "$EXPECT_FILES" ] && say "ספירה ${an:-?} ≠ הצפוי $EXPECT_FILES"
bf=$(files_failed "$B/test.txt"); af=$(files_failed "$A/test.txt")
[ "${af:-0}" -le "${bf:-0}" ] || say "קבצים כושלים: ${bf:-0} → ${af:-0}"
bt=$(tests_failed "$B/test.txt"); at=$(tests_failed "$A/test.txt")
[ "${at:-0}" -le "${bt:-0}" ] || say "טסטים כושלים: ${bt:-0} → ${at:-0}"

lint_ids "$B/lint.txt" > "$B/ids.txt"; lint_ids "$A/lint.txt" > "$A/ids.txt"
newids=$(comm -13 "$B/ids.txt" "$A/ids.txt" || true)
if [ -n "$newids" ]; then
  echo "ℹ️  דיאגנוסטיקות lint שלא היו בבסיס:"; echo "$newids"
  echo "   → הזזות-שורה בקבצים שנערכו הן רעש צפוי. כלל *חדש* = רגרסיה. הכרע ידנית."
fi
bfe=$(fe_errors "$B/fe.txt"); afe=$(fe_errors "$A/fe.txt")
[ -n "$afe" ] || say "frontend typecheck לא הפיק שורת סיכום"
[ -n "$afe" ] && [ "${afe:-0}" -le "${bfe:-0}" ] || say "frontend typecheck: ${bfe:-?} → ${afe:-?}"
bts=$(tsc_errors "$B/tsc.txt"); ats=$(tsc_errors "$A/tsc.txt")
[ "${ats:-0}" -le "${bts:-0}" ] || say "root typecheck: $bts → $ats"

bun run lint:i18n > "$A/i18n.txt" 2>&1 || say "lint:i18n נכשל (מוחלט — חייב לעבור)"

[ $fail -eq 0 ] && echo "✅ אין רגרסיה" || echo "— נמצאו רגרסיות —"
exit $fail
