# Security dependency update — 2026-10-21

This update addresses the eMudhra/emSign certificate-authority incident and the
editor/build-tool advisories found in the dependency audit. It is not evidence
that Grainery was compromised.

## Updated

- `webpki-roots` and `webpki-root-certs`: 1.0.10, removing the affected emSign root
  ([RUSTSEC-2026-0381](https://rustsec.org/advisories/RUSTSEC-2026-0381.html),
  [RUSTSEC-2026-0383](https://rustsec.org/advisories/RUSTSEC-2026-0383.html)).
- `rustls-webpki`: 0.103.16, rejecting the distrusted intermediate keys
  ([RUSTSEC-2026-0382](https://rustsec.org/advisories/RUSTSEC-2026-0382.html)).
- `rustls`: 0.23.46, covering the additional TLS advisories.
- TipTap packages: 3.32.0; `prosemirror-view`: 1.42.6, covering unsafe attribute
  merging and HTML paste handling. The updated dependency tree no longer includes
  the vulnerable `markdown-it` and `linkify-it` packages.
- Vite: 7.3.7, with patched transitive build dependencies.
- Grainery's plugin archive reader: `zip` 9.0.5. Filename decoding errors are
  propagated; path validation, symlink rejection and extraction limits remain.
- Compatible Rust security updates for `bytes`, `time`, `anyhow`, `event-listener`,
  `serde_with`, `rand` 0.8/0.9 and `quinn-proto`. Updating `plist` and
  `wayland-scanner` replaces the affected `quick-xml` with 0.41.0.

The Windows updater's legacy ZIP support is now disabled. The published 1.6.6
Windows updates are signed EXE/MSI installers, and `createUpdaterArtifacts: true`
keeps Tauri 2's native formats. Linux retains the updater's `zip` feature because
it also enables tar payloads, including the system-linked Linux updater. Do not
switch to legacy ZIP updater artifacts without revisiting this decision.

Both lockfiles must be included when merging and releasing this update.
Installed applications need a rebuilt release; these edits do not update them.

## Remaining upstream alerts

The Rust audit is **not clean**. An OSV scan of all 632 registry package/version
entries in `Cargo.lock` still flags 16 entries, including maintenance notices and
platform-specific dependencies. No advisory suppressions were added.

| Dependency | Remaining issue and follow-up |
| --- | --- |
| `glib` 0.18.5 | [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html): unsafe string-variant iterator implementation. Retained by Tauri's Linux GTK/WebKit stack. Static review found no affected iterator calls in Grainery or the resolved dependency source directories; see below. Track a supported upstream fix and repeat the review when dependencies change. This is not a claim that the library itself is patched. |
| `lopdf` 0.31.0 | [RUSTSEC-2026-0187](https://rustsec.org/advisories/RUSTSEC-2026-0187.html): deeply nested PDF input can abort parsing. Retained by `printpdf` 0.7; Grainery generates PDFs rather than loading untrusted PDFs. Migrate before adding PDF import. |
| `rand` 0.7.3 | [RUSTSEC-2026-0097](https://rustsec.org/advisories/RUSTSEC-2026-0097.html): custom-logger reentrancy can violate memory safety. Retained by Tauri's `phf_generator` build dependency; no affected custom logger was identified. Upgrade through the upstream build stack. |
| `zip` 4.6.1 | [RUSTSEC-2026-0367](https://rustsec.org/advisories/RUSTSEC-2026-0367.html), [0368](https://rustsec.org/advisories/RUSTSEC-2026-0368.html), [0369](https://rustsec.org/advisories/RUSTSEC-2026-0369.html): extraction permissions/symlinks. Still an optional lockfile entry because Cargo resolves features across platforms, but no longer in the active Windows dependency graph: Windows ZIP updating is disabled. Grainery's plugin archive reader uses patched ZIP 9. Keep signing keys protected and retain the platform-feature regression checks. |

The remaining notices concern unmaintained `fxhash`, `proc-macro-error`,
`ttf-parser`, `unic-*`, `zbus_names`, `zvariant` and `zvariant_derive` packages.
They require upstream dependency migrations, not a claim of an active exploit.

## GLib reachability review

Resolved the Linux graph with `cargo metadata --locked --filter-platform
x86_64-unknown-linux-gnu`, then searched 465 resolved `src` directories, including
Grainery's Rust source, for the exact `VariantStrIter` and `array_iter_str` symbols.
No references were found outside GLib. Within GLib, references were limited to
the implementation/constructor, imports/re-exports, examples and tests; no
production internal calls to the constructor were found.

This is a static source review, not exhaustive proof about generated code or
future dependency versions. Forcing GLib 0.20 into the GTK 0.18 dependency stack
would be an incompatible change, so no override or advisory suppression was added.

## Automated follow-up

- `.github/workflows/security-checks.yml` runs npm audit, frontend tests/builds,
  platform-feature checks, Rust tests and native debug builds on Linux, Windows
  and macOS. It runs on pushes, pull requests, manual dispatch and weekly schedules.
- `.github/dependabot.yml` requests weekly npm/Cargo update checks and groups
  TipTap updates together. This is not a replacement for a full RustSec audit.
- The release workflow now runs npm audit and the updater-feature guards before
  publishing draft release artifacts. No release was published by this work.
- Push the branch to run hosted checks. Scheduled checks and Dependabot config
  take effect after merging to the default branch; no hosted run has been verified.

## Verification

- Clean npm install from the lockfile with lifecycle scripts disabled.
- `npm audit`: zero reported vulnerabilities.
- `npm test`: 22 tests, including a JSON `__proto__` attribute regression.
- `npm run build`: passed.
- `cargo test --manifest-path src-tauri/Cargo.toml --locked`: 20 tests passed on
  macOS ARM64 and Linux ARM64 (Debian 12 Docker), including symlink rejection and
  Unicode-filename archive extraction.
- `node --test test/native/updater-features.test.mjs`: four checks passed, covering
  Windows/Linux/macOS updater features and native-format updater configuration.
- Both GitHub Actions workflows passed `actionlint` validation; their hosted jobs
  have not been run for this branch.
- `npm run tauri -- build --debug --no-bundle --ci -- --locked`: passed on macOS ARM64.
- `cargo build --manifest-path src-tauri/Cargo.toml --locked`: native Linux ARM64
  build passed in the same Debian 12 container.
- One-off verification of the published 1.6.6 Windows EXE and MSI with the
  configured public key and the updater's exact `minisign-verify` 0.2.5 library:
  authentic signatures accepted, modified installer bytes rejected. Neither
  installer was executed. Temporary fixtures/verifier are outside the repository.
- Live OSV scan: no alerts for the targeted CA/TLS libraries or Rust patch updates.

Not verified: Windows native builds or end-to-end installation, interactive
Linux/editor/paste behavior, signed installers for this branch or a production
release. Linux ARM64 tests do not validate the released x86_64 Ubuntu build.
Existing Cocoa/compiler and frontend build warnings remain; repository-wide Rust
formatting also has pre-existing differences in `src-tauri/src/fonts.rs` and
`src-tauri/src/pdf/mod.rs`.
