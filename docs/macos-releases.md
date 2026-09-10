# Signed macOS releases

Pushing an `app-v<version>` tag runs `.github/workflows/release.yml` and creates
a draft release with Apple Silicon and Intel installers. Each Mac job uses
`scripts/release-macos.sh` to sign and notarize the app, generate the signed
Tauri updater archive, then notarize and staple the DMG. Signature, ticket,
disk-image, and Gatekeeper checks must pass before the action uploads artifacts.
Missing Apple credentials stop the Mac build instead of producing an ad hoc release.

## GitHub Actions secrets

Configure these repository secrets under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID Application `.p12` file |
| `APPLE_CERTIFICATE_PASSWORD` | Password for that `.p12` file |
| `APPLE_SIGNING_IDENTITY` | Full certificate name, such as `Developer ID Application: Volver Health LLC (PWT3Q52LZ2)` |
| `APPLE_API_KEY` | App Store Connect team API key ID |
| `APPLE_API_ISSUER` | App Store Connect Issuer ID |
| `APPLE_API_PRIVATE_KEY` | Entire contents of the corresponding `.p8` file |

Keep `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` configured
as well. They authenticate automatic updates and are separate from Apple signing.

Tauri uses temporary signing keychains. The wrapper writes the API private key to
a restricted temporary file and deletes it on exit. Never commit credential files.
Local development retains its existing ad hoc signing configuration.

Before the Apple certificate expires, replace `APPLE_CERTIFICATE` and its password;
update `APPLE_SIGNING_IDENTITY` if its name changes. The certificate supplied for
the September 2026 setup expires February 1, 2027. If the API key is replaced,
update its ID and private-key secrets together, and its Issuer ID if needed.

The wrapper can also run locally with the same environment variables and the
existing Rust targets and frontend dependencies installed:

```bash
bash scripts/release-macos.sh build --target aarch64-apple-darwin
bash scripts/release-macos.sh build --target x86_64-apple-darwin
```
