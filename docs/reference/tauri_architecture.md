Tauri pairs a web UI with a Rust core, talking via secure command-based IPC.

What Tauri is

Tauri is a desktop app framework that combines a WebView-based UI (HTML/CSS/JS) with a native Rust runtime. The web layer is sandboxed and communicates with Rust through a strict, capability-scoped IPC. This yields very small binaries, strong security defaults, and native access with cross‑platform packaging.

Core Architecture

- Webview UI: Your frontend runs inside a system WebView (WebKit on macOS, WebView2 on Windows, WebKitGTK on Linux). No Chromium bundle. The UI is served from static assets baked into the app or loaded during dev from a local server.

- Rust Runtime (Core): A long‑lived Rust process manages windows, file system, OS integration, and plugins. It initializes the app, registers commands, holds shared state, and orchestrates async tasks.

- Command-based IPC: The web layer calls named Rust “commands”. Each command is explicitly registered and typed, and the bridge validates/serializes parameters. This is the primary surface between JS and Rust; by design there’s no arbitrary native eval from JS.

- Plugins: Common functionality (filesystem, shell, updater, notifications, clipboard, etc.) is shipped as Tauri plugins. You opt into capabilities by enabling plugins—keeping the surface minimal unless you need it.

- Configuration & Capabilities: The app’s behavior and allowed resources are set in tauri.conf.json (domains, protocol, URLs, CSP-like restrictions, updater settings, bundle targets). These constraints shape what the webview can reach and what commands are exposed.

- Asset bundling: Frontend assets are compiled and packaged into the binary or alongside it. In production, the webview serves them from the app bundle without a dev server.

- Bundling & Signing: Tauri outputs platform-specific installers/app bundles and integrates with codesigning/notarization. It supports multi-arch builds and differential auto‑updates via the updater plugin.

Data Flow (simplified)

1. Bootstrap: Rust core starts, reads config, creates a window hosting the webview, exposes a set of commands.

2. UI Load: The webview loads your compiled frontend (index.html, JS, CSS) from the app bundle.

3. IPC Calls: Frontend invokes `invoke('commandName', payload)` (imported from `@tauri-apps/api/core`); the bridge validates and forwards to Rust.

4. Rust Work: The command runs Rust code (sync/async), uses plugins or OS APIs, returns structured results.

5. Response to UI: Rust serializes a result and the bridge delivers it back to the webview JS.

6. Events: Rust can emit events to the webview; the webview can subscribe to channels to react to native changes.

Security Model (why it’s tight)

- Least privilege by default: No Node.js, no bundled browser with broad APIs. The webview is constrained to allowed URLs and protocols.

- Allowlisted commands: Only registered commands are callable; parameters are typed and validated. You decide what crosses the boundary.

- Content limits: Configuration constrains external network access and resource loading; you can enforce strict CSP-like rules.

- OS interaction via plugins: Capabilities are opt-in; unused surfaces aren’t exposed.

- Process model: A single native runtime owns privileged operations—no ad hoc sidecars unless you add them intentionally.

Concurrency & State

- Async commands: Rust commands can be async, spawn tasks, and stream progress via events.

- Shared state: The runtime provides patterns (managed state, mutex/Arc) for application-wide data. The webview never touches native memory directly; it asks through commands.

Updates & Distribution

- Updater: Optional automatic updates with signed artifacts. Rust core checks version, downloads, verifies, and applies.

- Platform bundlers: Builds platform-native formats (DMG/APP, MSI/EXE, AppImage/etc), integrating with OS expectations for permissions and signing.

Extending Beyond Commands

- Sidecars (optional): You can ship extra binaries and call them via the shell plugin or custom code. Tauri still mediates access and environment.

- Custom protocols: Define `asset://` or custom schemes to tightly control resource loading routes.

Typical Project Layout

- Frontend: Svelte/React/Vue/etc built to static assets.

- Rust src: Commands, plugin wiring, app setup, state, windows/events.

- Config: tauri.conf.json for permissions, bundling, updater, windows, URLs.

How it differs from Electron

- No bundled Chromium/Node: Uses system WebView; Rust core instead of Node main process.

- Smaller footprint: Much smaller binaries, lower memory.

- Security posture: A narrower, explicit IPC surface and capability gating, rather than a full Node-in-renderer model.

Bottom line: The webview renders the UI, the Rust runtime does privileged work, and commands are the disciplined bridge between them—kept tight by configuration, plugins, and explicit allowlists. That’s the essence of Tauri’s architecture.
