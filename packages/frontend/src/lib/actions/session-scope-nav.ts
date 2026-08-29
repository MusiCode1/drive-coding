import { isInSessionRoute } from "$lib/session/session-routes"

export function onSessionRouteChange(
  fromPath: string,
  toPath: string | undefined,
  session: { notifySessionNavigatedAway(): void },
): void {
  if (!isInSessionRoute(fromPath)) return
  if (toPath !== undefined && isInSessionRoute(toPath)) return
  session.notifySessionNavigatedAway()
}
