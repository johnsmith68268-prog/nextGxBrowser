#!/usr/bin/env bash
# nextGx Browser — 1-Click Universal Linux Installer
# Supports:
#   1) Local offline install (if placed beside nextGx-Browser-*.deb or *.AppImage)
#   2) Online 1-command install from GitHub Releases:
#      curl -fsSL https://raw.githubusercontent.com/johnsmith68268-prog/nextGxBrowser/main/scripts/install-linux.sh | bash
set -euo pipefail

APP_NAME="nextGx Browser"
APP_ID="nextgx-browser"
REPO="johnsmith68268-prog/nextGxBrowser"
INSTALL_DIR="$HOME/.local/share/nextgx-browser"
BIN_DIR="$HOME/.local/bin"
APPS_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || pwd)"

info() { echo "[nextGx Installer] $*"; }
notify_gui() {
  local title="$1"
  local msg="$2"
  if command -v zenity >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    zenity --info --title="$title" --text="$msg" --width=380 2>/dev/null || true
  elif command -v kdialog >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    kdialog --msgbox "$msg" --title "$title" 2>/dev/null || true
  fi
}

find_local_file() {
  local pattern="$1"
  for dir in "$SCRIPT_DIR" "$SCRIPT_DIR/../dist" "$PWD" "$PWD/dist"; do
    [ -d "$dir" ] || continue
    for f in "$dir"/$pattern; do
      if [ -f "$f" ]; then
        echo "$f"
        return 0
      fi
    done
  done
  return 1
}

# 1) Try native .deb install on Debian/Ubuntu/Mint/Pop!_OS if a local .deb is present and user prefers system install
LOCAL_DEB="$(find_local_file 'nextGx-Browser-*.deb' || true)"
LOCAL_APPIMAGE="$(find_local_file 'nextGx-Browser-*.AppImage' || true)"

if [ -n "$LOCAL_DEB" ] && command -v apt-get >/dev/null 2>&1 && [ "${NEXTGX_FORCE_APPIMAGE:-0}" != "1" ]; then
  info "Found local Debian package: $LOCAL_DEB"
  if [ "$(id -u)" -eq 0 ]; then
    apt-get install -y "$LOCAL_DEB"
  elif command -v pkexec >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    info "Launching graphical system installer..."
    pkexec apt-get install -y "$LOCAL_DEB"
  elif command -v sudo >/dev/null 2>&1; then
    sudo apt-get install -y "$LOCAL_DEB"
  else
    LOCAL_DEB=""
  fi
  if [ -n "$LOCAL_DEB" ]; then
    info "$APP_NAME installed successfully via .deb!"
    notify_gui "$APP_NAME Installed" "$APP_NAME has been installed! You can now launch it from your Applications menu."
    exit 0
  fi
fi

# 2) Universal Zero-Sudo AppImage Installation (works on Ubuntu, Fedora, Arch, Mint, Manjaro, openSUSE, Kali, etc.)
mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$APPS_DIR" "$ICON_DIR"
TARGET_APPIMAGE="$INSTALL_DIR/nextGx-Browser.AppImage"

if [ -n "$LOCAL_APPIMAGE" ]; then
  info "Installing from local AppImage: $LOCAL_APPIMAGE"
  cp -f "$LOCAL_APPIMAGE" "$TARGET_APPIMAGE"
else
  info "Fetching latest $APP_NAME AppImage from GitHub Releases ($REPO)..."
  RELEASE_API="https://api.github.com/repos/$REPO/releases/latest"
  DL_URL="$(curl -fsSL "$RELEASE_API" | grep -oE '"browser_download_url":[[:space:]]*"[^"]+\.AppImage"' | head -n 1 | sed -E 's/.*"([^"]+)"$/\1/' || true)"
  if [ -z "$DL_URL" ]; then
    echo "[nextGx Installer] ERROR: No local .AppImage/.deb found and no .AppImage asset published on GitHub Releases yet." >&2
    echo "Place nextGx-Browser-3.0.0-x86_64.AppImage next to this script or upload it to GitHub Releases." >&2
    exit 1
  fi
  info "Downloading $DL_URL ..."
  curl -fL --progress-bar "$DL_URL" -o "$TARGET_APPIMAGE"
fi

chmod +x "$TARGET_APPIMAGE"

# Install icon (local build/icon.png if available, otherwise raw GitHub icon)
ICON_PATH="$ICON_DIR/$APP_ID.png"
LOCAL_ICON=""
for cand in "$SCRIPT_DIR/icon.png" "$SCRIPT_DIR/../build/icon.png" "$PWD/build/icon.png"; do
  if [ -f "$cand" ]; then LOCAL_ICON="$cand"; break; fi
done
if [ -n "$LOCAL_ICON" ]; then
  cp -f "$LOCAL_ICON" "$ICON_PATH"
else
  curl -fsSL "https://raw.githubusercontent.com/$REPO/main/build/icon.png" -o "$ICON_PATH" 2>/dev/null || true
fi

# Create CLI launcher symlink (handles --no-sandbox fallback if FUSE or unprivileged userns is restricted)
LAUNCHER="$BIN_DIR/$APP_ID"
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
exec "$TARGET_APPIMAGE" "\$@"
EOF
chmod +x "$LAUNCHER"

# Create Applications Menu .desktop entry
DESKTOP_FILE="$APPS_DIR/$APP_ID.desktop"
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=$APP_NAME
Comment=Modern Gaming Chromium Desktop Browser with Built-in Privacy Shield
Exec="$TARGET_APPIMAGE" %U
Icon=$ICON_PATH
Terminal=false
Categories=Network;WebBrowser;
MimeType=text/html;text/xml;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;
StartupWMClass=nextgx-browser
EOF
chmod +x "$DESKTOP_FILE"

# Also place Desktop shortcut if Desktop folder exists
DESKTOP_DIR="${XDG_DESKTOP_DIR:-$HOME/Desktop}"
if [ -d "$DESKTOP_DIR" ]; then
  cp -f "$DESKTOP_FILE" "$DESKTOP_DIR/$APP_ID.desktop"
  chmod +x "$DESKTOP_DIR/$APP_ID.desktop"
  if command -v gio >/dev/null 2>&1; then
    gio set "$DESKTOP_DIR/$APP_ID.desktop" metadata::trusted true 2>/dev/null || true
  fi
fi

# Refresh desktop database & icon cache
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR" 2>/dev/null || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

info "$APP_NAME installed successfully!"
info "  AppImage : $TARGET_APPIMAGE"
info "  Menu     : $DESKTOP_FILE"
info "  Command  : $LAUNCHER"
notify_gui "$APP_NAME Installed" "$APP_NAME is ready! Launch it from your Applications menu or Desktop icon."
