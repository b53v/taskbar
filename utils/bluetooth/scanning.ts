import Bluetooth from "gi://AstalBluetooth";

const AUTO_STOP_SCAN_MS = 30_000;
let discoveryTimeout: ReturnType<typeof setTimeout> | null = null;

const clearDiscoveryTimeout = () => {
  if (discoveryTimeout) {
    clearTimeout(discoveryTimeout);
    discoveryTimeout = null;
  }
};

export const scanDevices = (): boolean => {
  const bluetooth = Bluetooth.get_default();
  if (bluetooth?.adapter) {
    try {
      if (!bluetooth.adapter.discovering) {
        bluetooth.adapter.start_discovery();
      }
      clearDiscoveryTimeout();
      discoveryTimeout = setTimeout(() => {
        discoveryTimeout = null;
        stopScan();
      }, AUTO_STOP_SCAN_MS);
      return true;
    } catch (error) {
      console.error("Failed to start discovery:", error);
      return false;
    }
  }
  console.warn("No Bluetooth adapter available");
  return false;
};

export const stopScan = (): boolean => {
  clearDiscoveryTimeout();
  const bluetooth = Bluetooth.get_default();
  if (bluetooth?.adapter?.discovering) {
    try {
      bluetooth.adapter.stop_discovery();
      return true;
    } catch (error) {
      console.error("Failed to stop discovery:", error);
      return false;
    }
  }
  return false;
};

export const isScanning = (): boolean => {
  const bluetooth = Bluetooth.get_default();
  return bluetooth?.adapter?.discovering || false;
};
