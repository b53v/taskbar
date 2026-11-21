import GLib from "gi://GLib?version=2.0";
import type { TimeoutManager } from "./types.ts";

export const createTimeoutManager = (
  dismissCallback: () => void,
  timeoutDelay: number,
): TimeoutManager => {
  let isHovered = false;
  let cleanedUp = false;
  let timeoutId: number | null = null;

  const clearTimeout = () => {
    if (timeoutId !== null) {
      GLib.source_remove(timeoutId);
      timeoutId = null;
    }
  };

  const setupTimeout = () => {
    if (cleanedUp) return;
    clearTimeout();

    if (!isHovered) {
      timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutDelay, () => {
        timeoutId = null;
        if (!cleanedUp) {
          dismissCallback();
        }
        return GLib.SOURCE_REMOVE;
      });
    }
  };

  return {
    setupTimeout,
    clearTimeout,
    handleHover: () => {
      if (cleanedUp) return;
      isHovered = true;
      clearTimeout();
    },
    handleHoverLost: () => {
      if (cleanedUp) return;
      isHovered = false;
      setupTimeout();
    },
    cleanup: () => {
      cleanedUp = true;
      clearTimeout();
    },
  };
};
