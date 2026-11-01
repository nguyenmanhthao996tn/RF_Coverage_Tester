void setup() {
  Serial6.begin(115200, RAK_AT_MODE);
  Serial.begin(115200);
  delay(2000);

  char dev_name[] = "TTLab.CoverageTester-001";
  if (!api.ble.settings.broadcastName.set(dev_name, sizeof(dev_name))) {
    Serial.println("Failed to set BLE name");
  }

  // No setPIN(), no setPermission() -> open, no pairing
  api.ble.uart.start(0);

  Serial.print("Done init with BLE name as: ");
  Serial.println(dev_name);
  Serial.print("BLE MAC: ");
  Serial.println(api.ble.mac.get());
}

void loop() {}