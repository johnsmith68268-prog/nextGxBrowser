#!/usr/bin/env bash
# nextGx Browser — Linux Uninstaller
set -euo pipefail

APP_ID="nextgx-browser"
DESKTOP_DIR="${XDG_DESKTOP_DIR:-$HOME/Desktop}"

echo "[nextGx Uninstaller] Removing nextGx Browser..."
rm -rf "$HOME/.local/share/nextgx-browser"
rm -f "$HOME/.local/bin/$APP_ID"
rm -f "$HOME/.local/share/applications/$APP_ID.desktop"
rm -f "$HOME/.local/share/icons/hicolor/512x512/apps/$APP_ID.png"
rm -f "$DESKTOP_DIR/$APP_ID.desktop"

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo "[nextGx Uninstaller] Done! (User profile data in ~/.config/nextgx-browser was preserved.)"
