# Self-hosted Web Client Implementation Plan

Design source:
`docs/superpowers/specs/2026-08-31-self-hosted-web-client-design.md`

## Delivery strategy

Deliver one infrastructure prerequisite and three vertical capability commits.
Each capability must pass its focused checks before commit. The final commit
must pass the complete Rust, frontend, Playwright, and Docker verification
available locally.

## 1. Restore a portable frontend CI baseline

Files:

- Update `apps/desktop/src/features/workspace/WorkspaceStorageSettings.test.tsx`.

Behavior:

- Build the mocked archive response from byte data supported consistently by
  the pinned Node 22 CI runtime and newer local Node runtimes.
- Keep the test's assertions about preparation, download name, and archive
  request behavior unchanged.

Focused verification:

```text
vitest run src/features/workspace/WorkspaceStorageSettings.test.tsx
NODE 22: pnpm test
```

Commit: `test(desktop): make archive response portable`

## 2. Add explicit same-origin client configuration

Files:

- Update `apps/desktop/src/lib/config/server.ts`.
- Update `apps/desktop/src/lib/config/server.test.ts`.
- Update configuration types or examples only if the supported value needs to
  be documented there.

Behavior:

- Resolve the exact reserved value `same-origin` to
  `window.location.origin`.
- Preserve complete HTTP/HTTPS URL validation and missing-value errors.
- Do not introduce an implicit browser fallback or a server-selection UI.
- Keep health validation and session scoping on the resolved absolute URL.

Focused verification:

```text
vitest run src/lib/config/server.test.ts src/app/App.test.tsx
tsc -b --pretty false
eslint . --max-warnings 0
```

Commit: `feat(web): support same-origin server configuration`

## 3. Serve the production client from Axum

Files:

- Update `apps/server/src/config.rs` and its unit tests.
- Update `apps/server/src/http.rs` and its HTTP tests.
- Update `apps/server/src/main.rs`.
- Enable the focused Tower HTTP filesystem feature in
  `apps/server/Cargo.toml` and refresh `Cargo.lock` if required.

Behavior:

- Parse optional `KANLEAF_WEB_DIR` without changing API-only defaults.
- Validate the configured directory and `index.html` before binding the
  listener.
- Serve root, real static files, and SPA navigation from the configured root.
- Return immutable cache headers for Vite hashed assets and non-long-lived
  headers for `index.html`.
- Return static 404 for missing assets and structured JSON 404 for unknown API
  routes.
- Keep request IDs, tracing, CORS, body limits, and authorization behavior on
  the API boundary.

Focused verification:

```text
cargo fmt --all --check
cargo clippy --locked -p kanleaf-server --all-targets --all-features -- -D warnings
cargo test --locked -p kanleaf-server http:: config::
```

Commit: `feat(server): serve the Kanleaf web client`

## 4. Publish and verify the combined self-host image

Files:

- Update `apps/server/Dockerfile`.
- Update the Playwright environment/global setup and add a focused self-host
  configuration or smoke test.
- Update root and desktop package scripts where needed.
- Update `.github/workflows/quality.yml`.
- Update `.env.example`, `README.md`, `docs/architecture.md`, and
  `docs/development.md`.

Behavior:

- Build the frontend with pinned pnpm and
  `VITE_KANLEAF_SERVER_URL=same-origin` in a dedicated Docker stage.
- Copy only `dist` into the runtime image and configure
  `KANLEAF_WEB_DIR=/usr/share/kanleaf`.
- Keep one Compose application service and port.
- Run a Playwright smoke test against the UI served directly by Axum.
- Document browser access at `http://<pi-address>:3000`, API-only local runs,
  Tauri absolute URL configuration, LAN HTTP limitations, and update commands.

Final verification:

```text
prettier --check .
tsc -b --pretty false
eslint . --max-warnings 0
vitest run
vite build
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --all-features --locked
playwright test
playwright test --config playwright.self-host.config.ts
docker build -f apps/server/Dockerfile -t kanleaf:self-host-web .
docker run health and root-page smoke checks
```

Review the built image to confirm Node and pnpm are absent, inspect the root and
unknown-API responses, inspect the browser at desktop and narrow widths, scan
for debug output and stale API-only self-host instructions, then commit.

Commit: `feat(self-host): publish the browser client`
