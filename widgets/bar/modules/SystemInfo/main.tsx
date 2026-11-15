import app from "ags/gtk4/app";
import Battery from "gi://AstalBattery";
import Net from "./modules/Net.tsx";
import Blue from "./modules/Bluetooth.tsx";
import Batt from "./modules/Battery.tsx";

export default function SystemInfo() {
  const battery = Battery.get_default();
  return (
    <button
      cssClasses={["system-menu-toggler"]}
      onClicked={() => app.toggle_window("system-menu")}
    >
      <box spacing={12}>
        <Net />
        <Blue />
        {battery.is_battery ? <Batt /> : null}
      </box>
    </button>
  );
}
