import { execAsync } from "ags/process";
import Network from "gi://AstalNetwork";
import {
  setIsConnecting,
  setErrorMessage,
  setShowPasswordDialog,
} from "./state.ts";
import { scanNetworks, getSavedNetworks } from "./scanning.ts";

export const connectToNetwork = async (
  ssid: string,
  password?: string,
): Promise<boolean> => {
  if (!ssid) return false;
  setIsConnecting(true);
  setErrorMessage("");

  const network = Network.get_default();
  const currentSsid = network.wifi?.ssid;

  // If already connected to another network, disconnect first
  if (currentSsid && currentSsid !== ssid) {
    try {
      await execAsync(["nmcli", "connection", "down", currentSsid]);
      await new Promise((resolve) => setTimeout(resolve, 400));
    } catch (error) {
      console.error("Disconnect error:", error);
    }
  }

  try {
    if (password) {
      await execAsync([
        "nmcli",
        "device",
        "wifi",
        "connect",
        ssid,
        "password",
        password,
      ]);
    } else {
      try {
        await execAsync(["nmcli", "connection", "up", ssid]);
      } catch {
        await execAsync(["nmcli", "device", "wifi", "connect", ssid]);
      }
    }

    setShowPasswordDialog(false);
    setIsConnecting(false);
    scanNetworks();
    getSavedNetworks();
    return true;
  } catch (error) {
    console.error("Connection error:", error);
    setIsConnecting(false);
    setErrorMessage("Check Password");

    // Clean up failed connection profile if created
    execAsync(["nmcli", "connection", "show", ssid])
      .then((output) => {
        if (output) forgetNetwork(ssid);
      })
      .catch(() => {});

    return false;
  }
};

export const disconnectNetwork = async (ssid: string): Promise<boolean> => {
  try {
    await execAsync(["nmcli", "connection", "down", ssid]);
    scanNetworks();
    return true;
  } catch (error) {
    console.error("Disconnect error:", error);
    return false;
  }
};

export const forgetNetwork = async (ssid: string): Promise<boolean> => {
  try {
    await execAsync(["nmcli", "connection", "delete", ssid]);
    getSavedNetworks();
    scanNetworks();
    return true;
  } catch (error) {
    console.error("Forget network error:", error);
    return false;
  }
};
