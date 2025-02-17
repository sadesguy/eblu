import { ActionPanel, Action, List, getPreferenceValues } from "@raycast/api";
import { useState, useEffect } from "react";
import { execSync } from "child_process";

interface BluetoothDevice {
  name: string;
  address: string;
  connected: boolean;
  lastConnected?: Date;
  type?: string;
  batteryLevel?: string;
}

interface Preferences {
  maxDevices: number;
}

interface RawBluetoothDeviceData {
  [deviceName: string]: {
    device_address: string;
    device_minorType?: string;
    device_batteryLevelMain?: string;
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

  return (
    <List
      searchText={searchText}
      onSearchTextChange={setSearchText}
      filtering={false}
      searchBarPlaceholder="Search by name or type (e.g., 'headset', 'k3 key', or device type)"
    >
      {filteredDevices.map((device) => (
        <List.Item
          key={device.address}
          title={device.name}
          subtitle={device.type || "Unknown Device"}
          accessories={[
            {
              text: [
                device.connected ? "Connected" : "Disconnected",
                device.batteryLevel ? `Battery: ${device.batteryLevel}` : null,
              ]
                .filter(Boolean)
                .join(" • "),
            },
          ]}
          actions={
            <ActionPanel>
              <Action
                title={device.connected ? "Disconnect" : "Connect"}
                onAction={() => toggleConnection(device.address, device.connected)}
              />
              <Action title="Refresh Devices" onAction={refreshDevices} shortcut={{ modifiers: ["cmd"], key: "r" }} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
