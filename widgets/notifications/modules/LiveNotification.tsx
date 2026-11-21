import { onCleanup, onMount } from "ags";
import Notifd from "gi://AstalNotifd";
import { BaseNotification } from "./Notification.tsx";
import { liveToDisplay, createTimeoutManager } from "utils/notifd";

const DEFAULT_TIMEOUT_MS = 5000;
const CRITICAL_TIMEOUT_MS = 8000;
const MIN_TIMEOUT_MS = 2000;
const MAX_TIMEOUT_MS = 15000;

export function NotificationWidget({
  notification,
}: {
  notification: Notifd.Notification;
}) {
  const notifd = Notifd.get_default();
  const expire = notification.expireTimeout;
  const timeoutDelay =
    expire > 0
      ? Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, expire))
      : notification.urgency === Notifd.Urgency.CRITICAL
        ? CRITICAL_TIMEOUT_MS
        : DEFAULT_TIMEOUT_MS;

  const dismissNotification = () => {
    timeoutManager.cleanup();
    try {
      notification.dismiss();
    } catch (error) {
      console.error("Error dismissing live notification:", error);
    }
  };

  const timeoutManager = createTimeoutManager(
    dismissNotification,
    timeoutDelay,
  );

  onMount(() => {
    timeoutManager.setupTimeout();
  });

  onCleanup(() => {
    timeoutManager.cleanup();
  });

  const handleAction = (_id: number, actionId: string) => {
    timeoutManager.cleanup();
    try {
      notification.invoke(actionId);
    } catch (error) {
      console.error("Error invoking live notification action:", error);
    }
  };

  const handleClick = (button: number) => {
    try {
      switch (button) {
        case 1: // PRIMARY/LEFT
          if (notification.actions && notification.actions.length > 0) {
            const actionId =
              notification.actions[0].id || notification.actions[0].action;
            if (actionId) {
              handleAction(notification.id, actionId);
            }
          }
          break;
        case 2: // MIDDLE
          timeoutManager.cleanup();
          notifd.notifications?.forEach((n) => n.dismiss());
          break;
        case 3: // SECONDARY/RIGHT
          dismissNotification();
          break;
      }
    } catch (error) {
      console.error("Error handling live notification click:", error);
    }
  };

  return (
    <BaseNotification
      notification={liveToDisplay(notification)}
      variant="live"
      showDismissButton={true}
      onDismiss={dismissNotification}
      onAction={handleAction}
      onClick={handleClick}
      onHover={() => timeoutManager.handleHover()}
      onHoverLost={() => timeoutManager.handleHoverLost()}
      cssClasses={["notification"]}
      maxWidth={340}
    />
  );
}
