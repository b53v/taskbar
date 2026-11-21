import { Gtk } from "ags/gtk4";
import { createState, onCleanup, Accessor } from "ags";
import Pango from "gi://Pango";
import Wp from "gi://AstalWp";
import Brightness from "utils/brightness";
import Bluetooth from "gi://AstalBluetooth";

interface OnScreenProgressProps {
  visible: boolean | Accessor<boolean>;
  setVisible: (visible: boolean) => void;
}

export default function OnScreenProgress({
  visible,
  setVisible,
}: OnScreenProgressProps) {
  const [value, setValue] = createState(0);
  const [label, setLabel] = createState("");
  const [icon, setIcon] = createState("");
  const [hasProgress, setHasProgress] = createState(true);

  let currentTimeout: ReturnType<typeof setTimeout> | null = null;
  const TIMEOUT_DELAY = 2000;

  const show = (
    val: number,
    text: string,
    iconName: string,
    progress = true,
  ) => {
    setValue(val);
    setLabel(text);
    setIcon(iconName);
    setHasProgress(progress);
    setVisible(true);

    if (currentTimeout) clearTimeout(currentTimeout);
    currentTimeout = setTimeout(() => {
      currentTimeout = null;
      setVisible(false);
    }, TIMEOUT_DELAY);
  };

  // Audio
  [
    Wp.get_default()?.get_default_speaker(),
    Wp.get_default()?.get_default_microphone(),
  ]
    .filter(Boolean)
    .forEach((endpoint) => {
      const id = endpoint!.connect("notify::volume", () => {
        const percent = Math.round(endpoint!.volume * 100);
        show(
          endpoint!.volume,
          `${endpoint!.description || "Volume"} · ${percent}%`,
          endpoint!.volumeIcon,
        );
      });
      onCleanup(() => endpoint!.disconnect(id));
    });

  // Brightness
  try {
    const brightness = Brightness.get_default();
    const id = brightness.connect("notify::screen", () =>
      show(
        brightness.screen,
        "Screen Brightness",
        "display-brightness-symbolic",
      ),
    );
    onCleanup(() => brightness.disconnect(id));
  } catch {}

  // Bluetooth connection status OSD (safe when bluetoothd is inactive)
  let bluetooth: Bluetooth.Bluetooth | null = null;
  let btId: number | null = null;
  const deviceSignals = new Map<Bluetooth.Device, number>();
  try {
    bluetooth = Bluetooth.get_default();
    const syncDevices = () => {
      if (!bluetooth) return;
      const devices = new Set(bluetooth.devices);
      for (const [device, id] of deviceSignals) {
        if (!devices.has(device)) {
          device.disconnect(id);
          deviceSignals.delete(device);
        }
      }
      for (const device of devices) {
        if (deviceSignals.has(device)) continue;
        const id = device.connect("notify::connected", () => {
          const message = device.connected
            ? `Connected: ${device.name || device.address}`
            : `Disconnected: ${device.name || device.address}`;

          show(0, message, device.icon || "bluetooth-active-symbolic", false);
        });
        deviceSignals.set(device, id);
      }
    };
    btId = bluetooth.connect("notify::devices", syncDevices);
    syncDevices();
  } catch {}

  onCleanup(() => {
    if (currentTimeout) {
      clearTimeout(currentTimeout);
      currentTimeout = null;
    }
    for (const [device, id] of deviceSignals) {
      try {
        device.disconnect(id);
      } catch {}
    }
    deviceSignals.clear();
    if (bluetooth && btId !== null) {
      try {
        bluetooth.disconnect(btId);
      } catch {}
    }
  });

  return (
    <revealer
      revealChild={visible}
      transitionType={Gtk.RevealerTransitionType.CROSSFADE}
      transitionDuration={160}
    >
      <box cssClasses={["osd"]} valign={Gtk.Align.CENTER}>
        <image iconName={icon} valign={Gtk.Align.CENTER} />
        <box orientation={Gtk.Orientation.VERTICAL} valign={Gtk.Align.CENTER}>
          <label
            label={label}
            maxWidthChars={26}
            widthRequest={170}
            halign={Gtk.Align.CENTER}
            ellipsize={Pango.EllipsizeMode.END}
            wrap={false}
          />
          <Gtk.ProgressBar fraction={value} visible={hasProgress} hexpand />
        </box>
      </box>
    </revealer>
  );
}
