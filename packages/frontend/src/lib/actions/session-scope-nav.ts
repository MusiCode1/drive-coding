import { isInSessionRoute, isOutsideSessionRoute } from "$lib/session/session-routes"

export function onSessionRouteChange(
  fromPath: string,
  toPath: string | undefined,
  session: { notifySessionNavigatedAway(): void },
): void {
  if (!isInSessionRoute(fromPath)) return
  if (toPath === undefined) return
  if (!isOutsideSessionRoute(toPath)) return
  session.notifySessionNavigatedAway()
}
