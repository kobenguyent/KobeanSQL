#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# KobeanSQL Native macOS Local Installer (For MacBook Pro Testing)
# ==============================================================================
# Installs KobeanSQL.app into /Applications (or ~/Applications), clears macOS
# Gatekeeper quarantine attributes (xattr -cr), applies a local ad-hoc signature
# (codesign --sign -), and registers the app with Spotlight / LaunchServices.
# No paid Apple Developer Program account required.
# ==============================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BUNDLE="$ROOT_DIR/dist/native-macos/KobeanSQL.app"

LAUNCH_AFTER=0
FORCE_BUILD=0
TARGET_DIR=""

for arg in "$@"; do
  case "$arg" in
    --launch|--open) LAUNCH_AFTER=1 ;;
    --build) FORCE_BUILD=1 ;;
    --user) TARGET_DIR="$HOME/Applications" ;;
    --system) TARGET_DIR="/Applications" ;;
  esac
done

if [ "$FORCE_BUILD" -eq 1 ] || [ ! -d "$APP_BUNDLE" ]; then
  "$ROOT_DIR/scripts/build-macos-native.sh"
fi

if [ -z "$TARGET_DIR" ]; then
  if [ -w "/Applications" ]; then
    TARGET_DIR="/Applications"
  else
    TARGET_DIR="$HOME/Applications"
  fi
fi

mkdir -p "$TARGET_DIR"
DEST_APP="$TARGET_DIR/KobeanSQL.app"

echo "==> Installing KobeanSQL Native to $DEST_APP"
rm -rf "$DEST_APP"
ditto "$APP_BUNDLE" "$DEST_APP"

echo "==> Clearing quarantine attributes and applying local ad-hoc signature"
xattr -cr "$DEST_APP" 2>/dev/null || true
codesign --force --deep --sign - \
  --entitlements "$ROOT_DIR/native/macos/Resources/Entitlements.plist" \
  "$DEST_APP"
codesign --verify --deep --strict "$DEST_APP"

# Register with LaunchServices so Spotlight finds KobeanSQL immediately
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [ -x "$LSREGISTER" ]; then
  "$LSREGISTER" -f "$DEST_APP" >/dev/null 2>&1 || true
fi

echo "==> Successfully installed: $DEST_APP"
echo "    Run with: open \"$DEST_APP\""

if [ "$LAUNCH_AFTER" -eq 1 ]; then
  open "$DEST_APP"
fi
