import { execAsync } from "ags/process";
import Network from "gi://AstalNetwork";
import {
  setAvailableNetworks,
  setSavedNetworks,
  setActiveNetwork,
} from "./state.ts";
import type { NetworkInfo } from "./types.ts";

let savedNetworksInFlight = false;

export const scanNetworks = () => {
  const network = Network.get_default();
  if (!network?.wifi) return;

  try {
    network.wifi.scan();
  } catch (error) {
    console.warn("WiFi scan skipped:", error);
  }

  // Get available networks from access points
  const networks = network.wifi.accessPoints
    .map((ap) => ({
      ssid: ap.ssid,
      strength: ap.strength,
      secured: ap.flags !== 0,
      active: network.wifi.activeAccessPoint?.ssid === ap.ssid,
      accessPoint: ap,
      iconName: ap.iconName,
    }))
    .filter((n) => n.ssid);

  // Sort by signal strength
  networks.sort((a, b) => b.strength - a.strength);

  // Remove duplicates (same SSID)
  const uniqueNetworks: NetworkInfo[] = [];
  const seen = new Set<string>();
  for (const item of networks) {
    if (!seen.has(item.ssid)) {
      seen.add(item.ssid);
      uniqueNetworks.push(item);
    }
  }

  setAvailableNetworks(uniqueNetworks);

  // Update active network
  const activeAp = network.wifi.activeAccessPoint;
  if (activeAp) {
    setActiveNetwork({
      ssid: activeAp.ssid,
      strength: activeAp.strength,
      secured: activeAp.flags !== 0,
      isActive: true,
      isSaved: true,
      iconName: activeAp.iconName,
    });
  } else {
    setActiveNetwork(null);
  }
};

export const getSavedNetworks = () => {
  if (savedNetworksInFlight) return;
  savedNetworksInFlight = true;

  execAsync(["nmcli", "-t", "-f", "NAME,TYPE", "connection", "show"])
    .then((output) => {
      if (typeof output === "string") {
        const savedWifiNetworks = output
          .split("\n")
          .filter((line) => line.includes("802-11-wireless"))
          .map((line) => line.split(":")[0].trim())
          .filter(Boolean);
        setSavedNetworks(savedWifiNetworks);
      }
    })
    .catch((error) => console.error("Error fetching saved networks:", error))
    .finally(() => {
      savedNetworksInFlight = false;
    });
};
