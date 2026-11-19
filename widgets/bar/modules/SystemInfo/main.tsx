import Battery from "gi://AstalBattery";
import { togglePopup } from "utils/popups";
import Net from "./modules/Net.tsx";
import Blue from "./modules/Bluetooth.tsx";
import Batt from "./modules/Battery.tsx";

export default function SystemInfo() {
  const battery = Battery.get_default();
  return (
    <button
      cssClasses={["system-menu-toggler"]}
      onClicked={() => void togglePopup("system-menu").catch(console.error)}
    >
      <box spacing={12}>
        <Net />
        <Blue />
        {battery.is_battery ? <Batt /> : null}
      </box>
    </button>
  );
}
