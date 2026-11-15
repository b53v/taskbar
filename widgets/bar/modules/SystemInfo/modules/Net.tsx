import { createBinding, createComputed } from "ags";
import Network from "gi://AstalNetwork";

export default function Net() {
  const network = Network.get_default();

  // Track every input the icon/tooltip depend on. Previously both only
  // re-evaluated on "connectivity", so Wi-Fi strength icons, SSID changes and
  // wired<->wifi switches with unchanged connectivity were never reflected.
  const primary = createBinding(network, "primary");
  const connectivity = createBinding(network, "connectivity");
  const wifiIcon = createBinding(network, "wifi", "iconName");
  const wifiSsid = createBinding(network, "wifi", "ssid");
  const wifiInternet = createBinding(network, "wifi", "internet");

  const iconName = createComputed([primary, wifiIcon], (prim, icon) => {
    if (prim == Network.Primary.WIRED) return "network-wired-symbolic";
    return icon || "network-error-symbolic";
  });

  const tooltip = createComputed(
    [connectivity, primary, wifiSsid, wifiInternet],
    (conn, prim, ssid, internet) => {
      // no connection
      if (conn == Network.Connectivity.UNKNOWN) return "Unknown connection";
      if (conn == Network.Connectivity.NONE) return "No connection";

      // wired
      if (prim == Network.Primary.WIRED) return "Wired";

      // wifi (may be null when there is no wifi device)
      switch (internet) {
        case Network.Internet.CONNECTED:
          return ssid ?? "";
        case Network.Internet.CONNECTING:
          return "Connecting";
        case Network.Internet.DISCONNECTED:
          return "Disconnected";
        default:
          return "";
      }
    },
  );

  return (
    <image
      cssClasses={["net", "module"]}
      iconName={iconName}
      tooltipText={tooltip}
    />
  );
}
