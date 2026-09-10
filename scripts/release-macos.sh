#!/usr/bin/env bash
set -euo pipefail

# tauri-action passes these arguments and uploads only after this script succeeds.
if [[ $# != 3 || $1 != build || $2 != --target ]]; then
  echo 'Usage: bash scripts/release-macos.sh build --target <macOS target>' >&2
  exit 1
fi
case "$3" in
  aarch64-apple-darwin|x86_64-apple-darwin) ;;
  *) echo "Unsupported macOS release target: $3" >&2; exit 1 ;;
esac

for name in APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY APPLE_API_KEY APPLE_API_ISSUER APPLE_API_PRIVATE_KEY; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required release secret: $name" >&2
    exit 1
  fi
done
if [[ "$APPLE_SIGNING_IDENTITY" != 'Developer ID Application: '* ]]; then
  echo 'APPLE_SIGNING_IDENTITY must be a Developer ID Application identity.' >&2
  exit 1
fi

umask 077
signing_dir=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/grainery-signing.XXXXXX")
trap 'rm -rf "$signing_dir"' EXIT
export APPLE_API_KEY_PATH="$signing_dir/AuthKey.p8"
printf '%s' "$APPLE_API_PRIVATE_KEY" > "$APPLE_API_KEY_PATH"
unset APPLE_API_PRIVATE_KEY

# Tauri imports the certificate, signs and notarizes the app, staples its ticket,
# then creates the updater archive/signature and signed DMG.
npm run tauri -- "$@" --ci --config '{"bundle":{"macOS":{"hardenedRuntime":true}}}'

bundle="src-tauri/target/$3/release/bundle"
app="$bundle/macos/Grainery.app"
codesign --verify --deep --strict --verbose=2 "$app"
xcrun stapler validate "$app"
spctl --assess --type execute --verbose=2 "$app"
test -s "$app.tar.gz"
test -s "$app.tar.gz.sig"

# Notarize the final installer too. Do not change the already-signed updater.
for dmg in "$bundle"/dmg/*.dmg; do
  codesign --verify --strict --verbose=2 "$dmg"
  hdiutil verify "$dmg"
  report="$signing_dir/notarization.json"
  xcrun notarytool submit "$dmg" --key "$APPLE_API_KEY_PATH" \
    --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" \
    --wait --timeout 20m --output-format json > "$report"
  cat "$report"
  node -e 'const fs = require("node:fs"); const result = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); if (result.status !== "Accepted") throw new Error("Installer notarization failed: " + result.status);' "$report"
  xcrun stapler staple "$dmg"
  xcrun stapler validate "$dmg"
  spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"
done
