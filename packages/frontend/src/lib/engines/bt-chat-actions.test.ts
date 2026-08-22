/**
 * bt-chat-actions.test.ts — ‏נועל את המיפוי שאומת חי בנהיגה.
 *
 * ‏הקוד נכתב ידנית מחוץ למסלול (‏`6c2a4390`) ‏ורץ בשטח **‏בלי טסט אחד**.
 * ‏אלה הטסטים הראשונים שלו.
 */
import { describe, expect, it } from "vitest"
import { btChatAction } from "./bt-chat-actions.js"
import type { BtCommand } from "./bt-remote.js"

function cmd(button: BtCommand["button"], gesture: BtCommand["gesture"]): BtCommand {
  return {
    button,
    gesture,
    channel: "key",
    at: 0,
    emittedAt: 5,
    holdMs: 5,
    pulses: 1,
    closedBy: "up",
  }
}

describe("bt-chat-actions", () => {
  it("tap next → mic-toggle", () => {
    expect(btChatAction(cmd("next", "tap"))).toEqual({ kind: "mic-toggle" })
  })

  it("tap prev → mic-cancel", () => {
    expect(btChatAction(cmd("prev", "tap"))).toEqual({ kind: "mic-cancel" })
  })

  it("tap center → playback-stop", () => {
    expect(btChatAction(cmd("center", "tap"))).toEqual({ kind: "playback-stop" })
  })

  it("a hold never yields an action — only a probe cue or none", () => {
    // 🔴 ‏ההבטחה שמצדיקה להשאיר את ההחזקות בקוד שרץ בנהיגה.
    for (const button of ["next", "prev", "center"] as const) {
      const action = btChatAction(cmd(button, "hold"))
      expect(["probe-cue", "none"]).toContain(action.kind)
      expect(action.kind).not.toBe("mic-toggle")
      expect(action.kind).not.toBe("mic-cancel")
      expect(action.kind).not.toBe("playback-stop")
    }
  })

  it("hold next → thinking · hold prev → speaking", () => {
    // ‏גליסנדו **‏עולה** = ‏קדימה · **‏יורד** = ‏אחורה. ‏הנוהג שומע ואינו רואה,
    // ‏ולכן היפוך כאן נותן לו אות הפוך. ‏בודק `cue` ‏בלבד (‏ר' ‏הבריף §5ד).
    const next = btChatAction(cmd("next", "hold"))
    const prev = btChatAction(cmd("prev", "hold"))
    expect(next.kind === "probe-cue" && next.cue).toBe("thinking")
    expect(prev.kind === "probe-cue" && prev.cue).toBe("speaking")
  })

  it("hold center is silent", () => {
    expect(btChatAction(cmd("center", "hold"))).toEqual({ kind: "none" })
  })

  it("a probe cue always repeats twice", () => {
    // ‏אישוש **‏מפורש** ‏של `repeat` — ‏ניסוח כמותי-כללי היה שורד את מוטציה J.
    expect(btChatAction(cmd("next", "hold"))).toEqual({
      kind: "probe-cue",
      cue: "thinking",
      repeat: 2,
    })
    expect(btChatAction(cmd("prev", "hold"))).toEqual({
      kind: "probe-cue",
      cue: "speaking",
      repeat: 2,
    })
  })
})
