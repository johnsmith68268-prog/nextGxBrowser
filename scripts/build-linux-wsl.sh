#!/usr/bin/env bash
set -euo pipefail

# n-5: the Windows source tree is no longer hardcoded. Override with
# NEXTGX_SRC_ROOT, otherwise resolve it from this script's own location
# (this script lives in <repo>/scripts, so the repo root is its parent dir).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)"
SRC_ROOT="${NEXTGX_SRC_ROOT:-$(dirname "$SCRIPT_DIR")}"
if [ ! -f "$SRC_ROOT/package.json" ]; then
  echo "[Linux Build] ERROR: cannot find package.json under SRC_ROOT=$SRC_ROOT" >&2
  echo "[Linux Build] Set NEXTGX_SRC_ROOT to the Windows checkout path and retry." >&2
  exit 1
fi

NODE_VERSION="v22.14.0"
NODE_DIST="node-v22.14.0-linux-x64"
NODE_DIR="$HOME/.local/$NODE_DIST"
if [ ! -x "$NODE_DIR/bin/node" ]; then
  echo "[Linux Build] Downloading portable Linux Node.js $NODE_VERSION..."
  mkdir -p "$HOME/.local"
  # s-10: download the tarball to a temp dir and verify its SHA256 against
  # the sums file nodejs.org publishes before extracting anything.
  NODE_TMP="$(mktemp -d)"
  trap 'rm -rf "$NODE_TMP"' EXIT
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/$NODE_DIST.tar.xz" -o "$NODE_TMP/$NODE_DIST.tar.xz"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$NODE_TMP/SHASUMS256.txt"
  if ! (cd "$NODE_TMP" && grep -F "  $NODE_DIST.tar.xz" SHASUMS256.txt > node.sha256 && sha256sum -c node.sha256); then
    echo "[Linux Build] ERROR: SHA256 checksum verification failed for $NODE_DIST.tar.xz — refusing to extract." >&2
    exit 1
  fi
  echo "[Linux Build] SHA256 checksum verified for $NODE_DIST.tar.xz."
  tar -xJ -f "$NODE_TMP/$NODE_DIST.tar.xz" -C "$HOME/.local"
  rm -rf "$NODE_TMP"
  trap - EXIT
fi

export PATH="$NODE_DIR/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
echo "[Linux Build] Using Node $(node -v), npm $(npm -v)"
echo "[Linux Build] Source tree: $SRC_ROOT"

BUILD_DIR="/tmp/nextgx-linux-build"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
cp -r "$SRC_ROOT/src" "$BUILD_DIR/"
cp -r "$SRC_ROOT/build" "$BUILD_DIR/"
cp "$SRC_ROOT/package.json" "$SRC_ROOT/package-lock.json" "$BUILD_DIR/"
# n-5: tests must be present in the build dir so `npm test` below can run.
if [ -d "$SRC_ROOT/tests" ]; then
  cp -r "$SRC_ROOT/tests" "$BUILD_DIR/"
fi

cd "$BUILD_DIR"
echo "[Linux Build] Installing dependencies inside Linux ext4..."
npm ci --no-audit --no-fund

# n-5: run the test suite before packaging; a failing test fails the build.
echo "[Linux Build] Running tests before packaging..."
npm test

echo "[Linux Build] Packaging Linux AppImage + deb..."
npx electron-builder --linux AppImage deb

mkdir -p "$SRC_ROOT/dist"
cp -f "$BUILD_DIR"/dist/*.AppImage "$SRC_ROOT/dist/"
cp -f "$BUILD_DIR"/dist/*.deb "$SRC_ROOT/dist/"

echo "[Linux Build] Done! Artifacts copied to Windows dist/:"
ls -lh "$SRC_ROOT/dist/"*.AppImage "$SRC_ROOT/dist/"*.deb
rm -rf "$BUILD_DIR"
