// widgets/bar/modules/Time.tsx
import { Gtk } from "ags/gtk4";
import { createExternal, createState } from "ags";
import { togglePopup } from "utils/popups";

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const pad2 = (n: number) => n.toString().padStart(2, "0");

function formatClock(): string {
  const now = new Date();
  return `${pad2(now.getMonth() + 1)}月${pad2(now.getDate())}日 ${WEEKDAYS[now.getDay()]} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
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
        tooltipText="点击展开侧边栏日历 / 控制中心"
        onClicked={() => void togglePopup("system-menu").catch(console.error)}
      >
        <label cssClasses={["clock"]} label={timeLabel} />
      </button>
      <revealer
        transitionType={Gtk.RevealerTransitionType.SLIDE_RIGHT}
        transitionDuration={300}
        revealChild={revealPower}
      >
        <button
          cssClasses={["power-button"]}
          tooltipText="电源与会话菜单"
          onClicked={() => void togglePopup("logout-menu").catch(console.error)}
        >
          <image iconName="system-shutdown-symbolic" />
        </button>
      </revealer>
    </box>
  );
}
