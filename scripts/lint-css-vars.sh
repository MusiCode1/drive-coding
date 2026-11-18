#!/usr/bin/env bash
# lint-css-vars — כל var(--X) שנצרך בלי fallback חייב הגדרה --X: כלשהי בעץ ה-FE.
#
# ⚠️ ה-‎--include חייבים לבוא **לפני** ה-‎`--` שמסיים את פרסינג-האופציות.
#    בסדר ההפוך grep מפרש אותם כשמות-קבצים ומדלג על הסינון בשקט
#    (‏אומת: 59 קבצים נסרקים במקום 58, כולל app.html).
set -uo pipefail
ROOT="${1:?frontend src root}"
cd "$ROOT" || exit 2

FILES=$(grep -rl --include='*.svelte' --include='*.css' --include='*.ts' -e '--' . \
  2>/dev/null | grep -v '__fixtures__' | grep -v '\.test\.ts$')

# נצרכים ללא fallback:  var(--X)  ולא  var(--X, ...)
USED=$(printf '%s\n' "$FILES" | xargs -r grep -ho -e 'var(--[A-Za-z0-9_-]*)' 2>/dev/null \
  | sed 's/^var(//; s/)$//' | sort -u)

# מוגדרים: --X:  בהצהרה. הסלקטור נחתך תחילה כדי שמודיפיירי-BEM
# (‏‎.foo--active:hover) לא ייספרו כהגדרות — ר' ממצא אביגיל 5.
DEF=$(printf '%s\n' "$FILES" | xargs -r grep -ho -e '^[[:space:]]*--[A-Za-z0-9_-]*[[:space:]]*:' \
  -e '[;{"][[:space:]]*--[A-Za-z0-9_-]*[[:space:]]*:' 2>/dev/null \
  | grep -o -e '--[A-Za-z0-9_-]*' | sort -u)

MISSING=$(comm -23 <(printf '%s\n' "$USED") <(printf '%s\n' "$DEF"))

if [ -n "$MISSING" ]; then
  echo "🔴 var() נצרך בלי הגדרה ובלי fallback:"
  printf '%s\n' "$MISSING" | sed 's/^/   /'
  echo
  echo "אתרי-הצריכה:"
  printf '%s\n' "$MISSING" | while read -r v; do
    [ -z "$v" ] && continue
    printf '%s\n' "$FILES" | xargs -r grep -n -e "var($v)" 2>/dev/null | sed 's/^/   /'
  done
  exit 1
fi
echo "✅ כל var() מוגדר או בעל fallback"
