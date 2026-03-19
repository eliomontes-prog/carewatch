#!/bin/bash
# hardware/setup-boards.sh — Flash & provision multiple ESP32-S3 boards for CareWatch
#
# Usage:
#   ./hardware/setup-boards.sh                          # interactive mode
#   ./hardware/setup-boards.sh --ssid MyWiFi --password secret --target-ip 192.168.0.168
#   ./hardware/setup-boards.sh --boards 3               # flash 3 boards sequentially

set -e

# ─── Defaults ────────────────────────────────────────────────────────────────
SSID=""
PASSWORD=""
TARGET_IP=""
BOARD_COUNT=""
BAUD=460800
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# ─── Parse arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --ssid)       SSID="$2"; shift 2 ;;
    --password)   PASSWORD="$2"; shift 2 ;;
    --target-ip)  TARGET_IP="$2"; shift 2 ;;
    --boards)     BOARD_COUNT="$2"; shift 2 ;;
    --baud)       BAUD="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --ssid NAME        WiFi network name"
      echo "  --password PASS    WiFi password"
      echo "  --target-ip IP     Backend server IP address"
      echo "  --boards N         Number of boards to flash"
      echo "  --baud RATE        Flash baud rate (default: 460800)"
      echo "  -h, --help         Show this help"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ─── Helpers ──────────────────────────────────────────────────────────────────
detect_ports() {
  # macOS: cu.usbmodem* or cu.usbserial*; Linux: ttyUSB* or ttyACM*
  local ports=()
  if [[ "$(uname)" == "Darwin" ]]; then
    for p in /dev/cu.usbmodem* /dev/cu.usbserial*; do
      [[ -e "$p" ]] && ports+=("$p")
    done
  else
    for p in /dev/ttyUSB* /dev/ttyACM*; do
      [[ -e "$p" ]] && ports+=("$p")
    done
  fi
  echo "${ports[@]}"
}

detect_local_ip() {
  if [[ "$(uname)" == "Darwin" ]]; then
    ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo ""
  else
    hostname -I 2>/dev/null | awk '{print $1}' || echo ""
  fi
}

prompt_if_empty() {
  local var_name="$1" prompt_text="$2" default="$3" is_secret="${4:-false}"
  eval "local current_val=\$$var_name"
  if [[ -z "$current_val" ]]; then
    if [[ -n "$default" ]]; then
      prompt_text="$prompt_text [$default]"
    fi
    if [[ "$is_secret" == "true" ]]; then
      read -s -r -p "$prompt_text: " input
      echo ""
    else
      read -r -p "$prompt_text: " input
    fi
    eval "$var_name=\"${input:-$default}\""
  fi
}

flash_board() {
  local port="$1"
  echo ""
  echo "  Flashing firmware to $port at ${BAUD} baud..."
  python3 -m esptool \
    --chip esp32s3 \
    --port "$port" \
    --baud "$BAUD" \
    write_flash \
    --flash_mode dio \
    --flash_size 4MB \
    0x0 "$PROJECT_DIR/firmware/bootloader.bin" \
    0x8000 "$PROJECT_DIR/firmware/partition-table.bin" \
    0x10000 "$PROJECT_DIR/firmware/esp32-csi-node.bin"
}

provision_board() {
  local port="$1"
  echo "  Provisioning WiFi + target IP on $port..."
  python3 -c "
import serial, time
s = serial.Serial('$port', 115200, timeout=2)
time.sleep(2)
s.write(b'set ssid $SSID\n')
time.sleep(0.5)
s.write(b'set password $PASSWORD\n')
time.sleep(0.5)
s.write(b'set target_ip $TARGET_IP\n')
time.sleep(0.5)
s.write(b'save\n')
time.sleep(1)
s.close()
print('  Provisioned successfully')
"
}

verify_board() {
  local port="$1"
  echo "  Verifying chip on $port..."
  python3 -m esptool --chip esp32s3 --port "$port" chip_id
}

# ─── Banner ───────────────────────────────────────────────────────────────────
echo "========================================"
echo "  CareWatch Multi-Board Setup"
echo "========================================"
echo ""

# ─── Check dependencies ──────────────────────────────────────────────────────
echo "[1/5] Checking dependencies..."

if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 is required. Install it first."
  exit 1
fi

missing=()
python3 -c "import esptool" 2>/dev/null || missing+=("esptool")
python3 -c "import serial" 2>/dev/null || missing+=("pyserial")

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "  Installing missing packages: ${missing[*]}..."
  pip3 install "${missing[@]}"
else
  echo "  All dependencies present."
fi

# ─── Download firmware ────────────────────────────────────────────────────────
echo ""
echo "[2/5] Checking firmware..."

FIRMWARE_VERSION="v0.2.0-esp32"
FIRMWARE_BASE="https://github.com/ruvnet/wifi-densepose/releases/download/${FIRMWARE_VERSION}"
FIRMWARE_DIR="$PROJECT_DIR/firmware"

if [[ ! -f "$FIRMWARE_DIR/bootloader.bin" ]] || \
   [[ ! -f "$FIRMWARE_DIR/partition-table.bin" ]] || \
   [[ ! -f "$FIRMWARE_DIR/esp32-csi-node.bin" ]]; then
  echo "  Downloading firmware ${FIRMWARE_VERSION}..."
  mkdir -p "$FIRMWARE_DIR"
  curl -sL "${FIRMWARE_BASE}/bootloader.bin" -o "$FIRMWARE_DIR/bootloader.bin"
  curl -sL "${FIRMWARE_BASE}/partition-table.bin" -o "$FIRMWARE_DIR/partition-table.bin"
  curl -sL "${FIRMWARE_BASE}/esp32-csi-node.bin" -o "$FIRMWARE_DIR/esp32-csi-node.bin"
  echo "  Firmware downloaded."
else
  echo "  Firmware already present."
fi

# ─── Gather configuration ────────────────────────────────────────────────────
echo ""
echo "[3/5] Configuration..."

auto_ip="$(detect_local_ip)"
prompt_if_empty SSID      "  WiFi SSID"
prompt_if_empty PASSWORD  "  WiFi Password" "" true
prompt_if_empty TARGET_IP "  Backend server IP" "$auto_ip"
prompt_if_empty BOARD_COUNT "  Number of boards to flash" "3"

echo ""
echo "  Config summary:"
echo "    SSID:       $SSID"
echo "    Target IP:  $TARGET_IP"
echo "    Boards:     $BOARD_COUNT"
echo ""

# ─── Flash each board ────────────────────────────────────────────────────────
echo "[4/5] Flashing & provisioning boards..."

for i in $(seq 1 "$BOARD_COUNT"); do
  echo ""
  echo "--- Board $i of $BOARD_COUNT ---"

  # Detect currently connected ports
  detected_ports=($(detect_ports))

  if [[ ${#detected_ports[@]} -eq 0 ]]; then
    echo "  No ESP32 board detected."
    read -r -p "  Connect board $i and press Enter to retry... "
    detected_ports=($(detect_ports))
    if [[ ${#detected_ports[@]} -eq 0 ]]; then
      echo "  ERROR: Still no board detected. Skipping board $i."
      continue
    fi
  fi

  if [[ ${#detected_ports[@]} -eq 1 ]]; then
    port="${detected_ports[0]}"
    echo "  Detected: $port"
  else
    echo "  Multiple ports detected:"
    for idx in "${!detected_ports[@]}"; do
      echo "    $((idx+1))) ${detected_ports[$idx]}"
    done
    read -r -p "  Select port [1]: " choice
    choice="${choice:-1}"
    port="${detected_ports[$((choice-1))]}"
  fi

  verify_board "$port"
  flash_board "$port"
  provision_board "$port"

  echo "  Board $i complete!"

  if [[ $i -lt $BOARD_COUNT ]]; then
    echo ""
    read -r -p "  Swap to next board and press Enter (or 'q' to stop): " response
    if [[ "$response" == "q" ]]; then
      echo "  Stopping early after $i board(s)."
      BOARD_COUNT=$i
      break
    fi
  fi
done

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "[5/5] Setup complete!"
echo "========================================"
echo "  Boards flashed:  $BOARD_COUNT"
echo "  Streaming to:    $TARGET_IP:5005"
echo "  WiFi network:    $SSID"
echo ""
echo "  Next steps:"
echo "    1. Start the backend:  cd backend && npm start"
echo "    2. Open the dashboard: http://localhost:3000"
echo "    3. Boards will auto-connect and stream CSI data"
echo "========================================"
