import app from "ags/gtk4/app";
import { Gtk } from "ags/gtk4";
import { createBinding, createState, onCleanup, With } from "ags";
import Bluetooth from "gi://AstalBluetooth";
import { BluetoothDevices } from "./modules/BluetoothDevices.tsx";
import {
  bluetoothIcon,
  bluetoothTooltip,
  isExpanded,
  setIsExpanded,
  stopScan,
} from "utils/bluetooth";

export const BluetoothBox = () => {
  const bluetooth = Bluetooth.get_default();
  const [mounted, setMounted] = createState(isExpanded.get());
  let unmountTimer: ReturnType<typeof setTimeout> | null = null;

  const syncMounted = (expanded: boolean) => {
    if (unmountTimer) {
      clearTimeout(unmountTimer);
      unmountTimer = null;
    }

    if (expanded) {
      setMounted(true);
    } else {
      stopScan();
      unmountTimer = setTimeout(() => {
        unmountTimer = null;
        if (!isExpanded.get()) setMounted(false);
      }, 200);
    }
  };

  return (
    <box cssClasses={["toggle"]} orientation={Gtk.Orientation.VERTICAL}>
      {/* Bluetooth Toggle Header */}
      <box>
        <button
          onClicked={() => {
            bluetooth.toggle();
          }}
          cssClasses={createBinding(
            bluetooth,
            "is_powered",
          )((powered) => (powered ? ["button"] : ["button-disabled"]))}
        >
          <image iconName={bluetoothIcon} />
        </button>
        <button
          hexpand={true}
          onClicked={() => {
            if (bluetooth.is_powered) {
              setIsExpanded((prev) => !prev);
            }
          }}
        >
          <box hexpand={true}>
            <label
              xalign={0}
              hexpand={true}
              label={bluetoothTooltip || "Bluetooth"}
            />
            <image
              iconName="pan-end-symbolic"
              halign={Gtk.Align.END}
              cssClasses={isExpanded((expanded) =>
                expanded
                  ? ["arrow-indicator", "arrow-down"]
                  : ["arrow-indicator"],
              )}
            />
          </box>
        </button>
      </box>

      {/* Devices List Revealer */}
      <revealer
        transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN}
        transitionDuration={180}
        revealChild={isExpanded}
        $={() => {
          const unsubscribeExpanded = isExpanded.subscribe(() => {
            syncMounted(isExpanded.get());
          });

          const poweredListener = bluetooth.connect("notify::is-powered", () => {
            if (!bluetooth.is_powered && isExpanded.get()) {
              setIsExpanded(false);
            }
          });

          const windowListener = app.connect("window-toggled", (_, window) => {
            if (
              window.name === "system-menu" &&
              !window.visible &&
              isExpanded.get()
            ) {
              setIsExpanded(false);
            }
          });

          onCleanup(() => {
            if (unmountTimer) {
              clearTimeout(unmountTimer);
              unmountTimer = null;
            }
            stopScan();
            bluetooth.disconnect(poweredListener);
            app.disconnect(windowListener);
            unsubscribeExpanded();
          });
        }}
      >
        {/* Lazily mounted Bluetooth Devices */}
        <box orientation={Gtk.Orientation.VERTICAL}>
          <With value={mounted}>
            {(isMounted) => (isMounted ? <BluetoothDevices /> : null)}
          </With>
        </box>
      </revealer>
    </box>
  );
};

export default BluetoothBox;
