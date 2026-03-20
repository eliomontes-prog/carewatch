#!/bin/bash
# hardware/flash.sh — Flash RuView firmware to ESP32-S3 boards

set -e

FIRMWARE_VERSION="v0.2.0-esp32"
FIRMWARE_BASE="https://github.com/ruvnet/wifi-densepose/releases/download/${FIRMWARE_VERSION}"
PORT="${1:-/dev/ttyUSB0}"
TARGET_IP="${2:-192.168.1.20}"
SSID="${3:-}"
PASSWORD="${4:-}"

echo "🔧 CareWatch ESP32-S3 Firmware Flasher"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Port:      $PORT"
echo "Target IP: $TARGET_IP"
echo ""

# Check dependencies
if ! command -v python3 &>/dev/null; then
  echo "❌ python3 required. Install it first."
  exit 1
fi

if ! python3 -c "import esptool" 2>/dev/null; then
  echo "📦 Installing esptool..."
  pip3 install esptool
fi

# Download firmware if not present
if [ ! -f "firmware/bootloader.bin" ]; then
  echo "📥 Downloading firmware ${FIRMWARE_VERSION}..."
  mkdir -p firmware
  curl -L "${FIRMWARE_BASE}/bootloader.bin" -o firmware/bootloader.bin
  curl -L "${FIRMWARE_BASE}/partition-table.bin" -o firmware/partition-table.bin
  curl -L "${FIRMWARE_BASE}/esp32-csi-node.bin" -o firmware/esp32-csi-node.bin
  echo "✅ Firmware downloaded"
fi

# Flash
echo "⚡ Flashing firmware to $PORT..."
python3 -m esptool \
  --chip esp32s3 \
  --port "$PORT" \
  --baud 460800 \
  write-flash \
  --flash-mode dio \
  --flash-size 4MB \
  0x0 firmware/bootloader.bin \
  0x8000 firmware/partition-table.bin \
  0x10000 firmware/esp32-csi-node.bin

echo "✅ Firmware flashed!"

# Provision WiFi + target IP
if [ -n "$SSID" ]; then
  echo ""
  echo "📡 Provisioning WiFi credentials..."
  python3 -c "
import serial, time, sys
port, ssid, password, ip = '$PORT', '$SSID', '$PASSWORD', '$TARGET_IP'
s = serial.Serial(port, 115200, timeout=2)
time.sleep(2)
s.write(f'set ssid {ssid}\n'.encode())
time.sleep(0.5)
s.write(f'set password {password}\n'.encode())
time.sleep(0.5)
s.write(f'set target_ip {ip}\n'.encode())
time.sleep(0.5)
s.write(b'save\n')
time.sleep(1)
s.close()
print('✅ Provisioned')
"
else
  echo ""
  echo "ℹ️  To provision WiFi, run:"
  echo "   python firmware/esp32-csi-node/provision.py \\"
  echo "     --port $PORT \\"
  echo "     --ssid \"YourWiFi\" \\"
  echo "     --password \"yourpassword\" \\"
  echo "     --target-ip $TARGET_IP"
fi

# Register node with backend (optional, non-blocking)
BACKEND_PORT="${BACKEND_PORT:-4000}"
NODE_ID="${NODE_ID:-esp32-$(basename "$PORT")}"
NODE_LABEL="${NODE_LABEL:-ESP32 $(basename "$PORT")}"
MAC=$(python3 -m esptool --chip esp32s3 --port "$PORT" read_mac 2>/dev/null \
      | grep -oE '([0-9a-f]{2}:){5}[0-9a-f]{2}' | head -1)

if curl -sf -X POST "http://${TARGET_IP}:${BACKEND_PORT}/api/nodes/register" \
     -H "Content-Type: application/json" \
     -d "{\"id\":\"${NODE_ID}\",\"label\":\"${NODE_LABEL}\",\"mac_address\":\"${MAC:-unknown}\",\"room\":\"default\"}" \
     > /dev/null 2>&1; then
  echo "📡 Registered node '${NODE_LABEL}' with backend"
else
  echo "ℹ️  Backend not reachable — node will self-register when data flows"
fi

echo ""
echo "🎉 Done! The ESP32-S3 will start streaming CSI to $TARGET_IP:5005"
echo "   Make sure the CareWatch backend is running on that machine."
