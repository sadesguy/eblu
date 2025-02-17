import { ActionPanel, Action, List, getPreferenceValues, showToast, Toast, confirmAlert, Icon } from "@raycast/api";
import { useState, useEffect } from "react";
import { execSync } from "child_process";

interface BluetoothDevice {
  name: string;
  address: string;
  connected: boolean;
  lastConnected?: Date;
  type?: string;
  batteryLevel?: string;
  rssi?: string;
  vendorId?: string;
  productId?: string;
  firmwareVersion?: string;
}

interface Preferences {
  maxDevices: number;
}

interface RawBluetoothDeviceData {
  [deviceName: string]: {
    device_address: string;
    device_minorType?: string;
    device_batteryLevelMain?: string;
    device_rssi?: string;
    device_vendorID?: string;
    device_productID?: string;
    device_firmwareVersion?: string;
  };
}

function fuzzySearch(device: BluetoothDevice, searchText: string): boolean {
  const searchLower = searchText.toLowerCase();
  const nameLower = device.name.toLowerCase();
  const typeLower = (device.type || "").toLowerCase();

  const searchTerms = searchLower.split(" ");

  return searchTerms.every((term) => {
    const matchesName = fuzzyMatch(nameLower, term);
    const matchesType = fuzzyMatch(typeLower, term);
    return matchesName || matchesType;
  });
}

function fuzzyMatch(text: string, pattern: string): boolean {
  let j = 0;
  for (let i = 0; i < text.length && j < pattern.length; i++) {
    if (text[i] === pattern[j]) {
      j++;
    }
  }
  return j === pattern.length;
}

export default function Command() {
  const { maxDevices } = getPreferenceValues<Preferences>();
  const [allDevices, setAllDevices] = useState<BluetoothDevice[]>([]);
  const [searchText, setSearchText] = useState("");
  const [blueutilPath, setBlueutilPath] = useState<string>("");

  const [isScanning, setIsScanning] = useState(false);
  const [discoveredDevices, setDiscoveredDevices] = useState<BluetoothDevice[]>([]);

  useEffect(() => {
    try {
      const path = execSync("command -v blueutil", { env: { PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" } })
        .toString()
        .trim();

      if (!path) {
        throw new Error("blueutil not found");
      }

      setBlueutilPath(path);
      refreshDevices();
    } catch (error) {
      console.error("Error: blueutil not found. Install with: brew install blueutil");
      return;
    }
  }, []);

  const refreshDevices = () => {
    try {
      const output = execSync("/usr/sbin/system_profiler SPBluetoothDataType -json").toString();
      const data = JSON.parse(output);

      const connectedDevices = data?.SPBluetoothDataType[0]?.device_connected || [];
      const disconnectedDevices = data?.SPBluetoothDataType[0]?.device_not_connected || [];

      const allDevices: BluetoothDevice[] = [
        ...connectedDevices.map((device: RawBluetoothDeviceData) => {
          const [name] = Object.keys(device);
          const deviceData = device[name];
          return {
            name,
            address: deviceData.device_address,
            connected: true,
            type: deviceData.device_minorType,
            batteryLevel: deviceData.device_batteryLevelMain,
            rssi: deviceData.device_rssi,
            vendorId: deviceData.device_vendorID,
            productId: deviceData.device_productID,
            firmwareVersion: deviceData.device_firmwareVersion,
            lastConnected: new Date(),
          };
        }),
        ...disconnectedDevices.map((device: RawBluetoothDeviceData) => {
          const [name] = Object.keys(device);
          const deviceData = device[name];
          return {
            name,
            address: deviceData.device_address,
            connected: false,
            type: deviceData.device_minorType,
            batteryLevel: deviceData.device_batteryLevelMain,
            lastConnected: undefined,
            rssi: deviceData.device_rssi,
            vendorId: deviceData.device_vendorID,
            productId: deviceData.device_productID,
            firmwareVersion: deviceData.device_firmwareVersion,
          };
        }),
      ];

      const sortedDevices = allDevices.sort((a, b) => {
        if (a.connected !== b.connected) {
          return a.connected ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      setAllDevices(sortedDevices);
    } catch (error) {
      console.error("Error fetching bluetooth devices:", error);
    }
  };

  const filteredDevices = searchText
    ? allDevices.filter((device) => fuzzySearch(device, searchText))
    : allDevices.slice(0, maxDevices);

  const toggleConnection = (address: string, isConnected: boolean) => {
    try {
      if (!blueutilPath) {
        throw new Error("blueutil path not set");
      }

      const action = isConnected ? "--disconnect" : "--connect";
      execSync(`${blueutilPath} ${action} ${address}`);

      setTimeout(refreshDevices, 1000);
    } catch (error) {
      console.error("Error toggling connection:", error);
    }
  };

  const forgetDevice = async (address: string, name: string) => {
    if (
      await confirmAlert({
        title: "Forget Device",
        message: `Are you sure you want to forget "${name}"?`,
        primaryAction: { title: "Forget", style: Action.Style.Destructive },
      })
    ) {
      try {
        execSync(`blueutil --unpair ${address}`);
        showToast(Toast.Style.Success, "Device forgotten");
        refreshDevices();
      } catch (error) {
        showToast(Toast.Style.Failure, "Failed to forget device");
      }
    }
  };

  const startDiscovery = async () => {
    try {
      if (!blueutilPath) throw new Error("blueutil not found");

      setIsScanning(true);
      showToast(Toast.Style.Animated, "Scanning for devices...");

      // Get existing device addresses to filter out already known devices
      const existingAddresses = allDevices.map((d) => d.address);

      // Start discovery and parse output
      const output = execSync(`${blueutilPath} --inquiry 10 --format json`).toString();
      const discovered = JSON.parse(output)
        .filter((device: any) => !existingAddresses.includes(device.address))
        .map((device: any) => ({
          name: device.name || "Unknown Device",
          address: device.address,
          connected: false,
          type: "New Device",
          rssi: device.rssi?.toString(),
        }));

      setDiscoveredDevices(discovered);
      setIsScanning(false);
      showToast(Toast.Style.Success, `Found ${discovered.length} new devices`);
    } catch (error) {
      setIsScanning(false);
      showToast(Toast.Style.Failure, "Failed to scan for devices");
      console.error("Discovery error:", error);
    }
  };

  const pairDevice = async (address: string, name: string) => {
    try {
      showToast(Toast.Style.Animated, `Pairing with ${name}...`);
      execSync(`${blueutilPath} --pair ${address}`);
      await refreshDevices();
      setDiscoveredDevices((prev) => prev.filter((d) => d.address !== address));
      showToast(Toast.Style.Success, `Paired with ${name}`);
    } catch (error) {
      showToast(Toast.Style.Failure, `Failed to pair with ${name}`);
    }
  };

  return (
    <List
      isLoading={isScanning}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      filtering={false}
      searchBarPlaceholder="Search devices or press ⌃N to scan for new devices"
    >
      {discoveredDevices.length > 0 && (
        <List.Section title="Discovered Devices">
          {discoveredDevices.map((device) => (
            <List.Item
              key={device.address}
              title={device.name}
              subtitle="Available to pair"
              icon={Icon.Bluetooth}
              accessories={[{ text: device.rssi ? `Signal: ${device.rssi}dBm` : undefined }]}
              actions={
                <ActionPanel>
                  <Action
                    title="Pair Device"
                    onAction={() => pairDevice(device.address, device.name)}
                    icon={Icon.Link}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}

      <List.Section title="Paired Devices">
        {filteredDevices.map((device) => (
          <List.Item
            key={device.address}
            title={device.name}
            subtitle={device.type || "Unknown Device"}
            icon={device.connected ? Icon.CircleFilled : Icon.Circle}
            accessories={[
              {
                text: [
                  device.connected ? "Connected" : "Disconnected",
                  device.batteryLevel ? `Battery: ${device.batteryLevel}` : null,
                  device.rssi ? `Signal: ${device.rssi}dBm` : null,
                  device.firmwareVersion ? `FW: ${device.firmwareVersion}` : null,
                ]
                  .filter(Boolean)
                  .join(" • "),
              },
            ]}
            actions={
              <ActionPanel>
                <ActionPanel.Section title="General">
                  <Action
                    title="Refresh Devices"
                    onAction={refreshDevices}
                    shortcut={{ modifiers: ["ctrl"], key: "r" }}
                    icon={Icon.RotateClockwise}
                  />
                  <Action
                    title="Scan for Devices"
                    onAction={startDiscovery}
                    shortcut={{ modifiers: ["ctrl"], key: "n" }}
                    icon={Icon.MagnifyingGlass}
                  />
                </ActionPanel.Section>
                <ActionPanel.Section title="Device Controls">
                  <Action
                    title={device.connected ? "Disconnect" : "Connect"}
                    onAction={() => toggleConnection(device.address, device.connected)}
                    shortcut={{ modifiers: ["ctrl"], key: "return" }}
                    icon={device.connected ? Icon.MinusCircle : Icon.PlusCircle}
                  />
                  <Action
                    title="Forget Device"
                    onAction={() => forgetDevice(device.address, device.name)}
                    shortcut={{ modifiers: ["ctrl"], key: "backspace" }}
                    style={Action.Style.Destructive}
                    icon={Icon.Trash}
                  />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}
