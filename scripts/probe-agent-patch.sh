#!/usr/bin/env bash
# probe-agent-patch — שער בר-כישלון ל-slice agent-patch-unify.
#
# למה סקריפט ולא רשימת-פקודות בבריף: הבריף אינו ניתן להרצה. הפרוב הזה רץ
# על הבסיס (אדום) ואחרי הסלייס (ירוק), ואותה הרצה בדיוק היא הראיה.
#
# חלק א — מטריצת-סכימה, **אפס תופעות-לוואי**: PATCH על agent שאינו קיים.
#   אימות-הסכימה רץ *לפני* חיפוש ה-agent, ולכן:
#     400 = הסכימה דחתה את השדה   ·   404 = הסכימה קיבלה אותו (ואז לא נמצא agent)
#   כלומר 400↔404 מודד את הסכימה בלי ליצור, לשנות או למחוק דבר.
#
# חלק ב — סיבוב cwd חי (דורש --live ו-CLI זמין): יוצר סוכן ב-dirA, מדווח על
#   סשן ששייך ל-dirB, וקורא בחזרה את הרישום ואת projectsRegistry.
#
# שימוש:
#   scripts/probe-agent-patch.sh <base-url> [--live <cliKind>]
# דוגמה:
#   scripts/probe-agent-patch.sh http://127.0.0.1:4111
#   scripts/probe-agent-patch.sh http://127.0.0.1:4111 --live claude

set -uo pipefail
BASE="${1:?usage: probe-agent-patch.sh <base-url> [--live <cliKind>]}"
MODE="${2:-}"
CLI="${3:-claude}"
FAIL=0

patch() { # $1=body ; מדפיס "<code> <body>"
  local out code
  out=$(curl -s -m 10 -o /tmp/_pap.json -w '%{http_code}' \
        -X PATCH "$BASE/api/agents/probe-nonexistent" \
        -H 'Content-Type: application/json' -d "$1")
  code=$out
  printf '%s %s' "$code" "$(cat /tmp/_pap.json)"
}

row() { # $1=label $2=body $3=expected-code
  local got code
  got=$(patch "$2"); code=${got%% *}
  if [ "$code" = "$3" ]; then printf '  ok   '; else printf '  FAIL '; FAIL=1; fi
  printf '%-14s %-46s expected=%s got=%s\n' "$1" "$2" "$3" "$got"
}

echo "### חלק א — מטריצת-סכימה של PATCH /api/agents/:id  (base=$BASE)"
echo "# 'expected' כאן הוא היעד **אחרי** הסלייס. על הבסיס ארבע השורות הראשונות נכשלות — זו הנקודה."
row "title"        '{"title":"t"}'                              404
row "persistent"   '{"persistent":true}'                        404
row "attach"       '{"acpSessionId":"s1","status":"ready"}'      404
row "attach+cwd"   '{"acpSessionId":"s1","cwd":"/tmp"}'          404
echo "# --- שורות-נגד: חייבות להישאר 400 גם אחרי הסלייס (הגנת-הגנריות) ---"
row "bridgePort"   '{"bridgePort":9999}'                         400
row "crashReason"  '{"crashReason":"x"}'                         400
row "id"           '{"id":"other"}'                              400
row "status-bad"   '{"acpSessionId":"s1","status":"crashed"}'    400
row "status-alone" '{"status":"ready"}'                          400
row "cwd-alone"    '{"cwd":"/tmp"}'                              400

if [ "$MODE" = "--live" ]; then
  echo
  echo "### חלק ב — סיבוב cwd חי (cliKind=$CLI)"
  A=/tmp/probe-dirA; B=/tmp/probe-dirB; mkdir -p "$A" "$B"
  AID=$(curl -s -m 120 -X POST "$BASE/api/agents" -H 'Content-Type: application/json' \
        -d "{\"cliKind\":\"$CLI\",\"cwd\":\"$A\"}" | sed -n 's/.*"agentId":"\([^"]*\)".*/\1/p')
  if [ -z "$AID" ]; then echo "  FAIL  יצירת סוכן נכשלה"; exit 1; fi
  echo "  agentId=$AID  spawn_cwd=$A"
  echo "  -- מדווח על סשן ששייך ל-$B --"
  curl -s -m 15 -o /tmp/_live.json -w '  attach -> HTTP %{http_code}\n' \
    -X PATCH "$BASE/api/agents/$AID" -H 'Content-Type: application/json' \
    -d "{\"acpSessionId\":\"sess-from-dirB\",\"status\":\"ready\",\"cwd\":\"$B\"}"
  echo "  agent אחרי: $(curl -s -m 10 "$BASE/api/agents/$AID")"
  echo "  projects[0]: $(curl -s -m 10 "$BASE/api/projects" | head -c 200)"
  echo "  # ירוק = agent.cwd הוא $B, ו-lastSessionId=sess-from-dirB רשום תחת $B (לא תחת $A)"
  curl -s -m 15 -o /dev/null -w '  cleanup delete -> HTTP %{http_code}\n' -X DELETE "$BASE/api/agents/$AID"
fi

echo
if [ "$FAIL" = 0 ]; then echo "ירוק — כל השורות כמצופה"; else echo "אדום — יש שורות שנכשלו (על הבסיס: מצופה)"; fi
exit $FAIL
