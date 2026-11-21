import { Gtk } from "ags/gtk4";
import { createBinding } from "ags";
import Bluetooth from "gi://AstalBluetooth";
import Network from "gi://AstalNetwork";
import { WiFiBox } from "./wifi-box/main.tsx";
import { BluetoothBox } from "./bluetooth-box/main.tsx";
import NotificationBox from "./notification-center/main.tsx";

export const Toggles = () => {
  const bluetooth = Bluetooth.get_default();
  const network = Network.get_default();
  const networkPrimary = createBinding(network, "primary");

  return (
    <box orientation={Gtk.Orientation.VERTICAL} hexpand={true}>
      {/* WiFi Box */}
      <box
        orientation={Gtk.Orientation.VERTICAL}
        hexpand={true}
        visible={networkPrimary((p) => p !== Network.Primary.WIRED)}
      >
        {network?.wifi ? <WiFiBox /> : <></>}
      </box>
      {/* Bluetooth Box */}
      {bluetooth?.adapter ? <BluetoothBox /> : <></>}
      {/* Notification Box */}
      <NotificationBox />
    </box>
  );
};
