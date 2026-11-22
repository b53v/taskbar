// widgets/bar/modules/Time.tsx
import { Gtk } from "ags/gtk4";
import { createExternal, createState } from "ags";
import { togglePopup } from "utils/popups";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const pad2 = (n: number) => n.toString().padStart(2, "0");

function formatClock(): string {
  const now = new Date();
  return `${WEEKDAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${pad2(now.getDate())}  ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

// Wake up right after each minute boundary (the old 10s poll could show the
// previous minute for up to 10s). createExternal only notifies when the
// string changes, so the label redraws once per minute. The 5s cap keeps the
// clock correct after suspend/resume, since GLib timers use the monotonic
// clock which pauses while suspended.
const clockLabel = createExternal(formatClock(), (set) => {
  let source: ReturnType<typeof setTimeout> | null = null;
  const tick = () => {
    set(formatClock());
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    source = setTimeout(tick, Math.min(5_000, msToNextMinute + 20));
  };
  tick();
  return () => {
    if (source) clearTimeout(source);
  };
});

export default function Time() {
  const [revealPower, setRevealPower] = createState(false);

  const timeLabel = clockLabel;

  return (
    <box
      cssClasses={["bar-clock-box"]}
      valign={Gtk.Align.CENTER}
      $={(self) => {
        const motionController = new Gtk.EventControllerMotion();

        motionController.connect("enter", () => {
          setRevealPower(true);
        });

        motionController.connect("leave", () => {
          setRevealPower(false);
        });

        self.add_controller(motionController);
      }}
    >
      <button
        cssClasses={["clock-button"]}
        valign={Gtk.Align.CENTER}
        tooltipText="Click to toggle System Menu"
        onClicked={() => void togglePopup("system-menu").catch(console.error)}
      >
        <label cssClasses={["clock"]} valign={Gtk.Align.CENTER} label={timeLabel} />
      </button>
      <revealer
        transitionType={Gtk.RevealerTransitionType.SLIDE_RIGHT}
        transitionDuration={180}
        revealChild={revealPower}
      >
        <button
          cssClasses={["power-button"]}
          valign={Gtk.Align.CENTER}
          tooltipText="Power & Session Menu"
          onClicked={() => void togglePopup("logout-menu").catch(console.error)}
        >
          <image valign={Gtk.Align.CENTER} iconName="system-shutdown-symbolic" />
        </button>
      </revealer>
    </box>
  );
}
