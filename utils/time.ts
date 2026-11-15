import { createPoll } from "ags/time";
import GLib from "gi://GLib?version=2.0";

// State
export const currentTime = createPoll(Date.now(), 60000, () => Date.now());

// The bar only shows HH:MM; a 1s poll redrew it 60 times more often than needed.
export const currentTimeString = createPoll<string>("00:00:00", 10_000, () => {
  const now = new Date();
  const hh = now.getHours().toString().padStart(2, "0");
  const mm = now.getMinutes().toString().padStart(2, "0");
  const ss = now.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
});

export const currentDate = createPoll<string>("", 60_000, () => {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
});

// Formatting
export const formatTimestamp = (timestamp: number, format = "%H:%M") =>
  GLib.DateTime.new_from_unix_local(timestamp).format(format)!;
