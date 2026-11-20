#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# KobeanSQL Native macOS App Builder & Packager (No Apple Developer Account)
# ==============================================================================
# Builds the pure Swift / SwiftUI / AppKit macOS app, runs the built-in self-test
# suite, generates AppIcon.icns, bundles KobeanSQL.app, performs ad-hoc code
# signing (identity: "-"), strips quarantine xattrs, and packages .zip + .dmg.
# ==============================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NATIVE_DIR="$ROOT_DIR/native/macos"
OUT_DIR="$ROOT_DIR/dist/native-macos"
CONFIG="${KOBEAN_NATIVE_CONFIG:-release}"
ARCH_MODE="${KOBEAN_NATIVE_ARCH:-native}" # native | universal
VERSION="${KOBEAN_NATIVE_VERSION:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2#v}"
      shift 2
      ;;
    --arch)
      ARCH_MODE="$2"
      shift 2
      ;;
    --config)
      CONFIG="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$VERSION" ]; then
  if command -v node >/dev/null 2>&1 && [ -f "$ROOT_DIR/package.json" ]; then
    VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
  else
    VERSION="1.34.0"
  fi
fi
VERSION="${VERSION#v}"

ARCH_FLAGS=()
if [ "$ARCH_MODE" = "universal" ]; then
  ARCH="universal"
  ARCH_FLAGS=(--arch arm64 --arch x86_64)
else
  ARCH="$(uname -m)"
fi

echo "==> Building KobeanSQL Native macOS ($CONFIG, $ARCH, v$VERSION)"

# Detect if CommandLineTools has an incomplete usr/include/c++/v1 shadowing the SDK's libc++
CXX_FLAGS=()
if ! echo '#include <memory>' | clang++ -x c++ -fsyntax-only - >/dev/null 2>&1; then
  SDK_PATH="$(xcrun --show-sdk-path)"
  if [ -d "$SDK_PATH/usr/include/c++/v1" ]; then
    echo "==> Applying SDK libc++ header path ($SDK_PATH/usr/include/c++/v1)"
    CXX_FLAGS=(-Xcxx -nostdinc++ -Xcxx -isystem -Xcxx "$SDK_PATH/usr/include/c++/v1")
  fi
fi

# Optional: generate Xcode project if xcodegen is installed so iOS/macOS devs can open KobeanSQL.xcodeproj
if command -v xcodegen >/dev/null 2>&1 && [ -f "$NATIVE_DIR/project.yml" ]; then
  (cd "$NATIVE_DIR" && xcodegen generate --quiet || true)
fi

cd "$NATIVE_DIR"
swift build -c "$CONFIG" ${ARCH_FLAGS[@]+"${ARCH_FLAGS[@]}"} ${CXX_FLAGS[@]+"${CXX_FLAGS[@]}"}
BIN_DIR="$(swift build -c "$CONFIG" ${ARCH_FLAGS[@]+"${ARCH_FLAGS[@]}"} ${CXX_FLAGS[@]+"${CXX_FLAGS[@]}"} --show-bin-path)"
BIN_PATH="$BIN_DIR/KobeanSQL"

if [ ! -x "$BIN_PATH" ]; then
  echo "ERROR: Compiled binary not found at $BIN_PATH" >&2
  exit 1
fi

if command -v lipo >/dev/null 2>&1; then
  echo "==> Binary architecture: $(lipo -info "$BIN_PATH" 2>/dev/null || file "$BIN_PATH")"
fi

if [ "${KOBEAN_NATIVE_SKIP_SELFTEST:-0}" != "1" ]; then
  echo "==> Running built-in native self-test suite"
  "$BIN_PATH" --self-test
fi

# Assemble .app bundle
APP_BUNDLE="$OUT_DIR/KobeanSQL.app"
CONTENTS_DIR="$APP_BUNDLE/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

rm -rf "$APP_BUNDLE"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

cp "$BIN_PATH" "$MACOS_DIR/KobeanSQL"
chmod +x "$MACOS_DIR/KobeanSQL"

sed "s/__APP_VERSION__/$VERSION/g" "$NATIVE_DIR/Resources/Info.plist" > "$CONTENTS_DIR/Info.plist"
printf "APPL????" > "$CONTENTS_DIR/PkgInfo"

# Generate AppIcon.icns from build/icon.png
SOURCE_ICON="$ROOT_DIR/build/icon.png"
if [ -f "$SOURCE_ICON" ] && command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
  echo "==> Generating AppIcon.icns from build/icon.png"
  ICONSET_DIR="$(mktemp -d)/AppIcon.iconset"
  mkdir -p "$ICONSET_DIR"
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$SOURCE_ICON" --out "$ICONSET_DIR/icon_${size}x${size}.png" >/dev/null 2>&1
    double=$((size * 2))
    sips -z "$double" "$double" "$SOURCE_ICON" --out "$ICONSET_DIR/icon_${size}x${size}@2x.png" >/dev/null 2>&1
  done
  iconutil -c icns "$ICONSET_DIR" -o "$RESOURCES_DIR/AppIcon.icns" || true
  rm -rf "$(dirname "$ICONSET_DIR")"
fi

# Ad-hoc code sign (identity "-") so macOS Apple Silicon allows execution without an Apple Developer account
echo "==> Ad-hoc signing KobeanSQL.app (no Apple Developer account required)"
xattr -cr "$APP_BUNDLE" 2>/dev/null || true
codesign --force --deep --sign - \
  --entitlements "$NATIVE_DIR/Resources/Entitlements.plist" \
  "$APP_BUNDLE"
codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"

# Create .zip archive (preserving bundle symlinks & permissions via ditto)
ZIP_VERSIONED="$OUT_DIR/KobeanSQL-${VERSION}-macOS-native-${ARCH}.zip"
ZIP_LATEST="$OUT_DIR/KobeanSQL-macOS-native.zip"
rm -f "$ZIP_VERSIONED" "$ZIP_LATEST"
echo "==> Creating ZIP archive: $(basename "$ZIP_VERSIONED")"
ditto -c -k --sequesterRsrc --keepParent "$APP_BUNDLE" "$ZIP_VERSIONED"
cp "$ZIP_VERSIONED" "$ZIP_LATEST"

# Create .dmg installer with Applications symlink + Gatekeeper-bypass helper script
DMG_VERSIONED="$OUT_DIR/KobeanSQL-${VERSION}-macOS-native-${ARCH}.dmg"
DMG_LATEST="$OUT_DIR/KobeanSQL-macOS-native.dmg"
rm -f "$DMG_VERSIONED" "$DMG_LATEST"

if command -v hdiutil >/dev/null 2>&1; then
  echo "==> Creating DMG disk image: $(basename "$DMG_VERSIONED")"
  DMG_STAGE="$(mktemp -d)"
  cp -R "$APP_BUNDLE" "$DMG_STAGE/KobeanSQL.app"
  ln -s /Applications "$DMG_STAGE/Applications"

  cat > "$DMG_STAGE/Install KobeanSQL (No Apple Dev Account).command" <<'INSTALLER_EOF'
#!/usr/bin/env bash
set -euo pipefail
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_SRC="$SRC_DIR/KobeanSQL.app"
if [ -w "/Applications" ]; then
  DEST_DIR="/Applications"
else
  DEST_DIR="$HOME/Applications"
  mkdir -p "$DEST_DIR"
fi
DEST_APP="$DEST_DIR/KobeanSQL.app"
echo "==> Installing KobeanSQL to $DEST_APP"
rm -rf "$DEST_APP"
ditto "$APP_SRC" "$DEST_APP"
echo "==> Removing browser quarantine attribute & applying local ad-hoc signature"
xattr -cr "$DEST_APP" 2>/dev/null || true
codesign --force --deep --sign - "$DEST_APP" 2>/dev/null || true
echo "==> Installed! Launching KobeanSQL..."
open "$DEST_APP"
INSTALLER_EOF
  chmod +x "$DMG_STAGE/Install KobeanSQL (No Apple Dev Account).command"

  hdiutil create -volname "KobeanSQL Native" \
    -srcfolder "$DMG_STAGE" \
    -ov -format UDZO \
    "$DMG_VERSIONED" >/dev/null
  cp "$DMG_VERSIONED" "$DMG_LATEST"
  rm -rf "$DMG_STAGE"
fi

# Generate SHA-256 checksums for release verification
SHA_VERSIONED="$OUT_DIR/KobeanSQL-${VERSION}-macOS-native-SHA256SUMS.txt"
SHA_LATEST="$OUT_DIR/KobeanSQL-macOS-native-SHA256SUMS.txt"
rm -f "$SHA_VERSIONED" "$SHA_LATEST"
if command -v shasum >/dev/null 2>&1; then
  echo "==> Generating SHA-256 checksums: $(basename "$SHA_VERSIONED")"
  (
    cd "$OUT_DIR"
    CHECKSUM_TARGETS=()
    [ -f "$(basename "$ZIP_VERSIONED")" ] && CHECKSUM_TARGETS+=("$(basename "$ZIP_VERSIONED")")
    [ -f "$(basename "$DMG_VERSIONED")" ] && CHECKSUM_TARGETS+=("$(basename "$DMG_VERSIONED")")
    if [ "${#CHECKSUM_TARGETS[@]}" -gt 0 ]; then
      shasum -a 256 "${CHECKSUM_TARGETS[@]}" > "$SHA_VERSIONED"
      cp "$SHA_VERSIONED" "$SHA_LATEST"
    fi
  )
fi

echo "==> Native macOS build complete!"
echo "    App Bundle : $APP_BUNDLE"
echo "    ZIP        : $ZIP_VERSIONED"
echo "    DMG        : $DMG_VERSIONED"
echo "    SHA256SUMS : $SHA_VERSIONED"
