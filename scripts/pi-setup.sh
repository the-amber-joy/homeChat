#!/usr/bin/env bash
# Re-exec in bash if invoked with sh/dash.
if [ -z "${BASH_VERSION:-}" ]; then
  exec /usr/bin/env bash "$0" "$@"
fi

set -euo pipefail

APP_DIR="/opt/homeChat"
NODE_CHANNEL="lts"
NON_INTERACTIVE=0
DRY_RUN=0
RUNTIME_USER="${SUDO_USER:-${USER:-pi}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICE_NAME="homechat"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
ENV_DIR="/etc/homechat"
ENV_FILE="${ENV_DIR}/homechat.env"
TOTAL_STEPS=6
CURRENT_STEP=0

log() {
  printf "[homechat-setup] %s\n" "$*"
}

warn() {
  printf "[homechat-setup] WARNING: %s\n" "$*" >&2
}

die() {
  printf "[homechat-setup] ERROR: %s\n" "$*" >&2
  exit 1
}

on_error() {
  local line="$1"
  local cmd="$2"
  printf "\n[homechat-setup] ERROR: setup failed at line %s\n" "$line" >&2
  printf "[homechat-setup] Last command: %s\n" "$cmd" >&2
  printf "[homechat-setup] Troubleshooting:\n" >&2
  printf "  1) sudo systemctl status %s --no-pager -n 50\n" "$SERVICE_NAME" >&2
  printf "  2) sudo journalctl -u %s --no-pager -n 120\n" "$SERVICE_NAME" >&2
  printf "  3) sudo ss -ltnp | grep :3010\n" >&2
}

step() {
  local message="$1"
  CURRENT_STEP=$((CURRENT_STEP + 1))
  printf "\n[homechat-setup] Step %d/%d: %s\n" "$CURRENT_STEP" "$TOTAL_STEPS" "$message"
}

trap 'on_error "$LINENO" "$BASH_COMMAND"' ERR

run_cmd() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf "[dry-run] %s\n" "$*"
    return 0
  fi
  eval "$@"
}

usage() {
  cat <<EOF
Usage: ./scripts/pi-setup.sh [options]

Options:
  --yes                 Non-interactive mode (accept defaults)
  --dry-run             Print actions without making changes
  --app-dir PATH        Install app to PATH (default: /opt/homeChat)
  --user USERNAME       Runtime service user (default: current user)
  --node-channel TYPE   Node channel: lts or current (default: lts)
  -h, --help            Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes)
      NON_INTERACTIVE=1
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --app-dir)
      APP_DIR="$2"
      shift
      ;;
    --user)
      RUNTIME_USER="$2"
      shift
      ;;
    --node-channel)
      NODE_CHANNEL="$2"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
  shift
done

[[ "$NODE_CHANNEL" == "lts" || "$NODE_CHANNEL" == "current" ]] || die "--node-channel must be lts or current"

command -v sudo >/dev/null 2>&1 || die "sudo is required"
command -v systemctl >/dev/null 2>&1 || die "systemd is required"
command -v tar >/dev/null 2>&1 || die "tar is required"

if [[ "$(uname -s)" != "Linux" ]]; then
  die "This script is for Linux/Raspberry Pi hosts"
fi

ARCH="$(uname -m)"
case "$ARCH" in
  armv6l|armv7l|aarch64) ;;
  *)
    warn "Detected architecture: $ARCH"
    warn "This script is tuned for Raspberry Pi and may not select the expected Node binary"
    ;;
esac

if [[ "$NON_INTERACTIVE" -eq 0 ]]; then
  cat <<EOF
This will:
  1) Deploy Home Chat to $APP_DIR
  2) Install Node.js (official/unofficial based on architecture)
  3) Install production dependencies
  4) Create $ENV_FILE with your After Dark password
  5) Configure and start systemd service: $SERVICE_NAME

Runtime user: $RUNTIME_USER
Node channel: $NODE_CHANNEL
EOF
  read -r -p "Proceed? [y/N] " PROCEED
  [[ "$PROCEED" =~ ^[Yy]$ ]] || die "Cancelled"
fi

if ! id "$RUNTIME_USER" >/dev/null 2>&1; then
  die "User '$RUNTIME_USER' does not exist"
fi

if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
  die "curl or wget is required"
fi

fetch_text() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url"
  else
    wget -qO- "$url"
  fi
}

download_file() {
  local url="$1"
  local output="$2"
  if command -v curl >/dev/null 2>&1; then
    run_cmd "curl -fsSL '$url' -o '$output'"
  else
    run_cmd "wget -q '$url' -O '$output'"
  fi
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p 'process.versions.node.split(".")[0]')"
    if [[ "$major" -ge 20 ]]; then
      log "Node $(node -v) already installed at $(command -v node); skipping install"
      return
    fi
    warn "Existing Node is older than v20; installing a newer build"
  fi

  local index_url
  if [[ "$NODE_CHANNEL" == "lts" ]]; then
    index_url="https://nodejs.org/dist/index.tab"
  else
    index_url="https://nodejs.org/dist/index.tab"
  fi

  local version
  if [[ "$NODE_CHANNEL" == "lts" ]]; then
    version="$(fetch_text "$index_url" | awk -F '\t' 'NR>1 && $1 ~ /^v20\./ {print $1; exit}')"
  else
    version="$(fetch_text "$index_url" | awk -F '\t' 'NR==2 {print $1}')"
  fi
  [[ -n "$version" ]] || die "Could not resolve Node version"

  local file_arch
  local base_url
  case "$ARCH" in
    armv6l)
      file_arch="linux-armv6l"
      base_url="https://unofficial-builds.nodejs.org/download/release/${version}"
      ;;
    armv7l)
      file_arch="linux-armv7l"
      base_url="https://nodejs.org/dist/${version}"
      ;;
    aarch64)
      file_arch="linux-arm64"
      base_url="https://nodejs.org/dist/${version}"
      ;;
    *)
      file_arch="linux-x64"
      base_url="https://nodejs.org/dist/${version}"
      warn "Unknown arch '$ARCH', defaulting Node download to ${file_arch}"
      ;;
  esac

  local tar_name="node-${version}-${file_arch}.tar.xz"
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  local tar_path="${tmp_dir}/${tar_name}"

  log "Downloading ${tar_name}"
  download_file "${base_url}/${tar_name}" "$tar_path"

  run_cmd "sudo mkdir -p /usr/local"
  run_cmd "sudo tar -xJf '$tar_path' -C /usr/local"

  local extracted_dir="/usr/local/node-${version}-${file_arch}"
  run_cmd "sudo ln -sfn '$extracted_dir/bin/node' /usr/local/bin/node"
  run_cmd "sudo ln -sfn '$extracted_dir/bin/npm' /usr/local/bin/npm"
  run_cmd "sudo ln -sfn '$extracted_dir/bin/npx' /usr/local/bin/npx"

  rm -rf "$tmp_dir"

  log "Installed Node ${version}"
}

deploy_app() {
  log "Deploying app to $APP_DIR"
  run_cmd "sudo mkdir -p '$APP_DIR'"

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  local backup_dir="${tmp_dir}/backup"
  mkdir -p "$backup_dir"

  if [[ -f "$APP_DIR/ad-access-list.json" ]]; then
    run_cmd "sudo cp '$APP_DIR/ad-access-list.json' '$backup_dir/ad-access-list.json'"
  fi
  if [[ -f "$APP_DIR/device-registry.json" ]]; then
    run_cmd "sudo cp '$APP_DIR/device-registry.json' '$backup_dir/device-registry.json'"
  fi

  if command -v rsync >/dev/null 2>&1; then
    run_cmd "sudo rsync -a --delete --exclude '.git' --exclude 'node_modules' --exclude 'device-registry.json' --exclude 'ad-access-list.json' '$SOURCE_DIR/' '$APP_DIR/'"
  else
    warn "rsync not found; using cp fallback"
    run_cmd "sudo find '$APP_DIR' -mindepth 1 -maxdepth 1 ! -name 'ad-access-list.json' ! -name 'device-registry.json' -exec rm -rf {} +"
    run_cmd "sudo cp -a '$SOURCE_DIR/.' '$APP_DIR/'"
    run_cmd "sudo rm -rf '$APP_DIR/.git' '$APP_DIR/node_modules'"
  fi

  if [[ -f "$backup_dir/ad-access-list.json" ]]; then
    run_cmd "sudo cp '$backup_dir/ad-access-list.json' '$APP_DIR/ad-access-list.json'"
  fi
  if [[ -f "$backup_dir/device-registry.json" ]]; then
    run_cmd "sudo cp '$backup_dir/device-registry.json' '$APP_DIR/device-registry.json'"
  fi

  run_cmd "sudo chown -R '$RUNTIME_USER:$RUNTIME_USER' '$APP_DIR'"
  rm -rf "$tmp_dir"
}

prompt_password() {
  local pass1
  local pass2

  if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    if [[ -n "${AFTERDARK_ADMIN_PASSWORD:-}" ]]; then
      printf "%s" "$AFTERDARK_ADMIN_PASSWORD"
      return
    fi
    die "Set AFTERDARK_ADMIN_PASSWORD in environment when using --yes"
  fi

  while true; do
    read -r -s -p "Enter After Dark admin password: " pass1
    printf "\n"
    read -r -s -p "Confirm password: " pass2
    printf "\n"

    [[ -n "$pass1" ]] || { warn "Password cannot be empty"; continue; }
    [[ "$pass1" == "$pass2" ]] || { warn "Passwords do not match"; continue; }

    printf "%s" "$pass1"
    return
  done
}

write_env_file() {
  local password
  password="$(prompt_password)"

  run_cmd "sudo install -d -m 700 '$ENV_DIR'"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf "[dry-run] write secret to %s with mode 600\n" "$ENV_FILE"
  else
    printf "AFTERDARK_ADMIN_PASSWORD=%s\n" "$password" | sudo tee "$ENV_FILE" >/dev/null
    sudo chown root:root "$ENV_FILE"
    sudo chmod 600 "$ENV_FILE"
  fi
}

write_service() {
  local node_bin
  node_bin="$(command -v node || true)"
  [[ -n "$node_bin" ]] || die "Could not find node in PATH after installation"

  local service_content
  service_content="[Unit]
Description=homeChat
After=network.target

[Service]
ExecStart=${node_bin} ${APP_DIR}/server.js
WorkingDirectory=${APP_DIR}
Restart=on-failure
RestartSec=5
User=${RUNTIME_USER}
EnvironmentFile=${ENV_FILE}

[Install]
WantedBy=multi-user.target
"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf "[dry-run] write %s\n" "$SERVICE_PATH"
  else
    printf "%s" "$service_content" | sudo tee "$SERVICE_PATH" >/dev/null
  fi

  run_cmd "sudo systemctl daemon-reload"
  run_cmd "sudo systemctl enable '$SERVICE_NAME'"
  run_cmd "sudo systemctl restart '$SERVICE_NAME'"
}

install_dependencies() {
  log "Installing production dependencies"
  run_cmd "cd '$APP_DIR' && npm install --omit=dev"
}

ensure_service_running() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf "[dry-run] verify service '%s' is active\n" "$SERVICE_NAME"
    return
  fi

  if ! sudo systemctl is-active --quiet "$SERVICE_NAME"; then
    warn "Service '$SERVICE_NAME' is not active yet; attempting to start"
    sudo systemctl start "$SERVICE_NAME"
  fi

  sudo systemctl is-active --quiet "$SERVICE_NAME" || die "Service '$SERVICE_NAME' failed to start"
}

post_summary() {
  log "Setup complete"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    return
  fi

  local ips
  ips="$(hostname -I 2>/dev/null | xargs || true)"
  echo
  echo "Service:"
  sudo systemctl status "$SERVICE_NAME" --no-pager -n 10 || true
  echo
  echo "Quick checks:"
  echo "  sudo systemctl status $SERVICE_NAME"
  echo "  sudo journalctl -u $SERVICE_NAME -f"
  echo "  sudo ss -ltnp | grep :3010"
  if [[ -n "$ips" ]]; then
    echo
    echo "Home Chat is running and enabled on boot."
    echo "Open in any browser in your local network:"
    for ip in $ips; do
      echo "  http://${ip}:3010"
    done
  else
    echo
    echo "Home Chat is running and enabled on boot."
    echo "Open in your browser at: http://<your-pi-local-ip>:3010"
  fi
}

log "Starting Home Chat Pi setup"
step "Install or verify Node.js"
install_node
step "Deploy app files"
deploy_app
step "Install production dependencies"
install_dependencies
step "Write secret env file"
write_env_file
step "Configure and start systemd service"
write_service
step "Verify service is running"
ensure_service_running
post_summary
