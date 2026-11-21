import Notifd from "gi://AstalNotifd";
import type { DisplayNotification, StoredNotification } from "./types.ts";

export function liveToDisplay(
  notification: Notifd.Notification,
): DisplayNotification {
  const convertedActions = (notification.actions || []).map((action) => ({
    label: action.label || action.name || action.text || String(action),
    action: action.id || action.key || action.action || String(action),
  }));

  return {
    id: notification.id,
    appName: notification.appName || "Unknown",
    summary: notification.summary || "",
    body: notification.body,
    appIcon: notification.appIcon,
    image: notification.image,
    desktopEntry: notification.desktopEntry,
    time: notification.time || Math.floor(Date.now() / 1000),
    urgency: notification.urgency || Notifd.Urgency.NORMAL,
    actions: convertedActions,
  };
}

export function liveToStored(
  notification: Notifd.Notification,
): StoredNotification {
  const convertedActions = (notification.actions || []).map((action) => ({
    label: action.label || action.name || action.text || String(action),
    action: action.id || action.key || action.action || String(action),
  }));

  return {
    id: notification.id,
    appName: notification.appName || "Unknown",
    summary: notification.summary || "",
    body: notification.body,
    appIcon: notification.appIcon,
    image: notification.image,
    desktopEntry: notification.desktopEntry,
    time: notification.time ? notification.time * 1000 : Date.now(),
    urgency: notification.urgency || Notifd.Urgency.NORMAL,
    actions: convertedActions,
    seen: false,
  };
}
