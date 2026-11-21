import { createComputed } from "ags";
import Network from "gi://AstalNetwork";
import type { NetworkInfo } from "./types.ts";
import { connectToNetwork, forgetNetwork } from "./network-operations.ts";
import { savedNetworks, activeNetwork } from "./state.ts";

export class AccessPointManager {
  private network: Network.Network;
  readonly displayInfo;
  readonly canConnect;
  readonly needsPassword;
  readonly connectionClasses;
  readonly statusIcon;

  constructor(network: Network.Network) {
    this.network = network;

    this.displayInfo = createComputed(
      [savedNetworks, activeNetwork],
      (saved, active): NetworkInfo => ({
        ssid: this.network.ssid,
        strength: this.network.strength,
        secured: this.network.secured,
        isActive: active?.ssid === this.network.ssid,
        isSaved: saved.includes(this.network.ssid),
        iconName: this.network.iconName,
      }),
    );

    this.canConnect = this.displayInfo((info) => !info.isActive);
    this.needsPassword = this.displayInfo(
      (info) => info.secured && !info.isSaved,
    );
    this.connectionClasses = this.displayInfo((info) =>
      info.isActive
        ? ["network-item", "network-item-active"]
        : ["network-item"],
    );
    this.statusIcon = this.displayInfo((info) => {
      if (info.isActive) return "object-select-symbolic";
      if (info.secured) return "network-wireless-encrypted-symbolic";
      return null;
    });
  }

  // Actions
  async connect(password?: string) {
    if (!this.canConnect.get()) return false;
    return connectToNetwork(this.network.ssid, password);
  }

  async forget() {
    return forgetNetwork(this.network.ssid);
  }

  // Check if password is needed before attempting connection
  requiresPasswordDialog() {
    const info = this.displayInfo.get();
    return info.secured && !info.isSaved;
  }
}

export const createAccessPointManager = (network: Network.Network) => {
  return new AccessPointManager(network);
};
