import { createBinding, createComputed } from "ags";
import { timeout } from "ags/time";
import Bluetooth from "gi://AstalBluetooth";
import type { BluetoothIconType } from "./types.ts";
import { setIsConnecting, hasBluetoothAgent } from "./state.ts";
import { ensureBluetoothAgent, stopBluetoothAgent } from "./agent.ts";

export class BluetoothDeviceManager {
  private device: Bluetooth.Device;

  readonly isConnected;
  readonly isPaired;
  readonly isTrusted;
  readonly isConnecting;
  readonly batteryPercentage;
  readonly displayInfo;
  readonly canConnect;
  readonly connectionIcon;
  readonly trustIcon;
  readonly pairIcon;
  readonly connectionClasses;
  readonly connectionTooltip;
  readonly trustTooltip;
  readonly pairTooltip;

  constructor(device: Bluetooth.Device) {
    this.device = device;

    this.isConnected = createBinding(this.device, "connected");
    this.isPaired = createBinding(this.device, "paired");
    this.isTrusted = createBinding(this.device, "trusted");
    this.isConnecting = createBinding(this.device, "connecting");
    this.batteryPercentage = createBinding(this.device, "battery_percentage");

    this.displayInfo = createComputed(
      [this.isConnected, this.batteryPercentage],
      (connected, battery) => ({
        name: this.device.name || "Unknown Device",
        batteryText:
          connected && battery > 0 ? ` ${Math.round(battery * 100)}%` : "",
        isConnected: connected,
      }),
    );

    this.canConnect = createComputed(
      [this.isPaired, this.isConnecting],
      (paired, connecting) => paired && !connecting,
    );

    this.connectionIcon = createComputed(
      [this.isConnected, this.isConnecting],
      (connected, connecting): BluetoothIconType => {
        if (connected) return "bluetooth-active-symbolic";
        if (connecting) return "bluetooth-acquiring-symbolic";
        return "bluetooth-disconnected-symbolic";
      },
    );

    this.trustIcon = this.isTrusted((trusted) =>
      trusted ? "security-high-symbolic" : "security-low-symbolic",
    );

    this.pairIcon = this.isPaired((paired) =>
      paired ? "network-transmit-receive-symbolic" : "network-offline-symbolic",
    );

    this.connectionClasses = this.isConnected((connected) =>
      connected
        ? ["network-item-active", "bt-item"]
        : ["network-item", "bt-item"],
    );

    this.connectionTooltip = this.isConnected((connected) =>
      connected ? "Disconnect" : "Connect",
    );

    this.trustTooltip = this.isTrusted((trusted) =>
      trusted ? "Untrust" : "Trust",
    );

    this.pairTooltip = this.isPaired((paired) => (paired ? "Unpair" : "Pair"));
  }

  async connect(): Promise<boolean> {
    if (!this.canConnect.get()) return false;

    return new Promise((resolve) => {
      setIsConnecting(true);
      this.device.connect_device(() => {
        setIsConnecting(false);
        const success = this.device.connected;
        resolve(success);
      });
    });
  }

  async disconnect(): Promise<boolean> {
    return new Promise((resolve) => {
      this.device.disconnect_device(() => {
        resolve(!this.device.connected);
      });
    });
  }

  async pair(): Promise<boolean> {
    return new Promise(async (resolve) => {
      // Start agent if not running
      let agentWasStarted = false;
      if (!hasBluetoothAgent.get()) {
        try {
          const agentStarted = await ensureBluetoothAgent();
          if (!agentStarted) {
            console.error("Failed to start Bluetooth agent");
            resolve(false);
            return;
          }
          agentWasStarted = true;
        } catch (error) {
          console.error("Error starting Bluetooth agent:", error);
          resolve(false);
          return;
        }
      }

      const pairedBinding = this.isPaired;
      let resolved = false;
      let pairingTimer: ReturnType<typeof timeout> | null = null;

      const unsubscribe = pairedBinding.subscribe(() => {
        const paired = pairedBinding.get();
        if (paired && !resolved) {
          resolved = true;
          pairingTimer?.cancel();
          pairingTimer = null;
          unsubscribe();

          if (agentWasStarted) {
            timeout(1000, async () => {
              try {
                await stopBluetoothAgent();
              } catch (error) {
                console.error("Error stopping Bluetooth agent:", error);
              }
            });
          }
          resolve(true);
        }
      });

      pairingTimer = timeout(30000, async () => {
        pairingTimer = null;
        if (!resolved) {
          resolved = true;
          unsubscribe();
          if (agentWasStarted) {
            try {
              await stopBluetoothAgent();
            } catch (error) {
              console.error(
                "Error stopping Bluetooth agent after timeout:",
                error,
              );
            }
          }
          resolve(false);
        }
      });

      try {
        this.device.pair();
      } catch (error) {
        if (!resolved) {
          resolved = true;
          pairingTimer?.cancel();
          pairingTimer = null;
          console.error("Error pairing device:", error);
          unsubscribe();
          if (agentWasStarted) {
            try {
              await stopBluetoothAgent();
            } catch (stopError) {
              console.error(
                "Error stopping Bluetooth agent after pairing error:",
                stopError,
              );
            }
          }
          resolve(false);
        }
      }
    });
  }

  unpair(): boolean {
    const bluetooth = Bluetooth.get_default();
    if (bluetooth?.adapter) {
      try {
        bluetooth.adapter.remove_device(this.device);
        return true;
      } catch (error) {
        console.error("Error unpairing device:", error);
        return false;
      }
    }
    return false;
  }

  toggleTrust(): boolean {
    try {
      const newTrustState = !this.device.trusted;
      this.device.set_trusted(newTrustState);
      return true;
    } catch (error) {
      console.error("Error toggling device trust:", error);
      return false;
    }
  }
}

export const createDeviceManager = (device: Bluetooth.Device) => {
  return new BluetoothDeviceManager(device);
};
