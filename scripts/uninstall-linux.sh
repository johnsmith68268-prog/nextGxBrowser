#!/usr/bin/env bash
# nextGx Browser — Linux Uninstaller
set -euo pipefail

APP_ID="nextgx-browser"
DEB_PKG="nextgx-browser"
DESKTOP_DIR="${XDG_DESKTOP_DIR:-$HOME/Desktop}"

echo "[nextGx Uninstaller] Removing nextGx Browser..."
rm -rf "$HOME/.local/share/nextgx-browser"
rm -f "$HOME/.local/bin/$APP_ID"
rm -f "$HOME/.local/share/applications/$APP_ID.desktop"
rm -f "$HOME/.local/share/icons/hicolor/512x512/apps/$APP_ID.png"
rm -f "$DESKTOP_DIR/$APP_ID.desktop"

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

# s-6: also handle a system .deb installation. The old script only removed
# the ~/.local AppImage install yet still printed "Done!" when a .deb
# package was in place. Never report success while the system package remains.
DEB_REMOVE_FAILED=0
if command -v dpkg-query >/dev/null 2>&1 && dpkg-query -W -f='${Status}' "$DEB_PKG" 2>/dev/null | grep -q "install ok installed"; then
  echo "[nextGx Uninstaller] Found system package '$DEB_PKG' installed via .deb — removing it..."
  if [ "$(id -u)" -eq 0 ]; then
    apt-get remove -y "$DEB_PKG" || DEB_REMOVE_FAILED=1
  elif command -v sudo >/dev/null 2>&1; then
    sudo apt-get remove -y "$DEB_PKG" || DEB_REMOVE_FAILED=1
  elif command -v pkexec >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    pkexec apt-get remove -y "$DEB_PKG" || DEB_REMOVE_FAILED=1
  else
    DEB_REMOVE_FAILED=1
  fi
fi

if [ "$DEB_REMOVE_FAILED" -eq 1 ]; then
  echo "[nextGx Uninstaller] WARNING: user files were removed, but the system package '$DEB_PKG' is still installed (no sudo/pkexec available, or removal failed)." >&2
  echo "[nextGx Uninstaller] Finish uninstalling with:" >&2
  echo "    sudo apt-get remove -y $DEB_PKG" >&2
  exit 1
fi

echo "[nextGx Uninstaller] Done! (User profile data in ~/.config/nextgx-browser was preserved.)"
