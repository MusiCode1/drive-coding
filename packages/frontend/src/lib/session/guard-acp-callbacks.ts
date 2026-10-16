import type { AcpClientCallbacks } from "@drive-coding/provider/client"

/** Gates the complete tee, including its observer, for the lifetime of one client. */
export function guardAcpCallbacks(
  callbacks: AcpClientCallbacks,
  current: () => boolean,
): AcpClientCallbacks {
  return {
    onUpdate: (notification) => {
      if (current()) callbacks.onUpdate(notification)
    },
    onExtNotification: (method, params) => {
      if (current()) callbacks.onExtNotification?.(method, params)
    },
    onRequestPermission: (params) =>
      current() && callbacks.onRequestPermission
        ? callbacks.onRequestPermission(params)
        : Promise.resolve({ outcome: { outcome: "cancelled" } }),
    onCreateElicitation: (params) =>
      current() && callbacks.onCreateElicitation
        ? callbacks.onCreateElicitation(params)
        : Promise.resolve({ action: "cancel" }),
  }
}
