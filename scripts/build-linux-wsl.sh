#!/usr/bin/env bash
set -euo pipefail

NODE_DIR="$HOME/.local/node-v22.14.0-linux-x64"
if [ ! -x "$NODE_DIR/bin/node" ]; then
  echo "[Linux Build] Downloading portable Linux Node.js v22.14.0..."
  mkdir -p "$HOME/.local"
  curl -fsSL https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz | tar -xJ -C "$HOME/.local"
fi

export PATH="$NODE_DIR/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
echo "[Linux Build] Using Node $(node -v), npm $(npm -v)"

SRC_ROOT="/mnt/c/nextGx browser"
BUILD_DIR="/tmp/nextgx-linux-build"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
cp -r "$SRC_ROOT/src" "$BUILD_DIR/"
cp -r "$SRC_ROOT/build" "$BUILD_DIR/"
cp "$SRC_ROOT/package.json" "$SRC_ROOT/package-lock.json" "$BUILD_DIR/"

cd "$BUILD_DIR"
echo "[Linux Build] Installing dependencies inside Linux ext4..."
npm ci --no-audit --no-fund

echo "[Linux Build] Packaging Linux AppImage + deb..."
npx electron-builder --linux AppImage deb

mkdir -p "$SRC_ROOT/dist"
cp -f "$BUILD_DIR"/dist/*.AppImage "$SRC_ROOT/dist/"
cp -f "$BUILD_DIR"/dist/*.deb "$SRC_ROOT/dist/"

echo "[Linux Build] Done! Artifacts copied to Windows dist/:"
ls -lh "$SRC_ROOT/dist/"*.AppImage "$SRC_ROOT/dist/"*.deb
rm -rf "$BUILD_DIR"
