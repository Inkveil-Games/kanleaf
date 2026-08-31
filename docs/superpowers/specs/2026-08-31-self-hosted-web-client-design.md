# Self-hosted Web Client Design

## Summary

Kanleaf will serve its React client and Axum API from the same server image and
the same origin. A Raspberry Pi deployment will expose the complete application
at `http://<pi-address>:3000`, while existing Tauri clients continue to connect
to an explicitly configured server URL.

The web client is a production Vite build, not a Vite development server. The
Docker runtime image contains static browser assets but does not contain Node,
pnpm, or a separate web server.

## Goals

- Open the complete Kanleaf interface from a browser using the Pi's LAN address.
- Keep the API under `/api` and the web client on one origin and one port.
- Publish the web client in the existing AMD64/ARM64 server image.
- Preserve Tauri's explicit build-time server configuration.
- Keep local Vite development and API-only `cargo run` workflows intact.
- Support browser refreshes on client routes without returning HTML for unknown
  API routes.
- Keep self-host updates to the existing Compose pull-and-recreate workflow.

## Non-goals

- Internet exposure, domain management, TLS, or a bundled reverse proxy.
- A separate web-client image or service.
- A PWA, service worker, offline mode, or browser install flow.
- Runtime server selection in the application UI.
- Replacing the Tauri desktop application.
- Supporting multiple Kanleaf servers from one web build.

## Chosen approach

Axum will serve the compiled Vite application alongside the existing API. The
Docker build gains a frontend build stage and copies `apps/desktop/dist` into
the final server image. The server activates web serving only when an optional
web-root environment variable is configured; the published image configures it
by default.

The web build uses a reserved `same-origin` value for
`VITE_KANLEAF_SERVER_URL`. At runtime, the client resolves that value to
`window.location.origin`. The published image therefore works at any LAN IP or
hostname without rebuilding it for that address.

Alternatives considered:

- A separate Nginx or Caddy container would serve static files well but adds a
  second service, proxy configuration, another image, and more failure modes
  without providing value for the LAN-only requirement.
- A Vite development server on the Pi would require Node at runtime and provide
  development behavior rather than a stable self-host deployment.

## Build and image layout

The Dockerfile will contain three responsibilities:

1. A Node build stage installs the pinned pnpm version, performs a frozen
   workspace install, and builds `@kanleaf/desktop` with
   `VITE_KANLEAF_SERVER_URL=same-origin`.
2. The existing Rust build stage produces the release Axum binary.
3. The Debian runtime stage receives only the binary, entrypoint, certificates,
   healthcheck tooling, and compiled web assets.

The runtime image stores the web output at `/usr/share/kanleaf` and sets:

```text
KANLEAF_WEB_DIR=/usr/share/kanleaf
```

Node dependencies and frontend source do not enter the runtime layer. The
existing multi-platform workflow remains responsible for publishing one
manifest containing native `linux/amd64` and `linux/arm64` images.

## Client server configuration

`readConfiguredServerUrl` will recognize exactly two configuration forms:

- a complete HTTP or HTTPS URL, retaining the current validation and Tauri
  behavior;
- the reserved value `same-origin`, resolved to `window.location.origin`.

Missing configuration remains an error. There is no implicit browser fallback,
so an accidentally unconfigured Tauri or Vite build cannot silently connect to
the wrong process. Root `.env` development builds continue to use an absolute
`VITE_KANLEAF_SERVER_URL`.

The resolved URL remains the key for retained account sessions. Browser access
by IP and by hostname is intentionally treated as separate origins and separate
local session storage.

## Server configuration and startup

`KANLEAF_WEB_DIR` is optional server configuration:

- unset: start the current API-only server;
- set: require a readable directory and `index.html`, then enable web routes;
- set incorrectly: fail startup with a clear configuration error instead of
  reporting healthy while the UI is unavailable.

Docker sets the variable. Local `cargo run`, backend tests, and deployments that
want API-only behavior do not need to set it. Compose does not expose another
user-facing setting because the path is an internal image detail.

## HTTP routing and caching

Routing preserves the `/api` boundary:

- registered `/api/*` requests use the existing API router;
- unknown `/api/*` requests return the normal JSON 404 response;
- `/assets/*` serves only existing Vite assets and returns 404 for missing
  assets;
- `/` and non-API client paths serve `index.html` so browser refreshes can load
  the application;
- other existing static files are served from the configured web root.

Hashed Vite assets receive long-lived immutable cache headers. `index.html`
does not receive a long-lived cache header, allowing a browser to discover new
asset hashes after a container update. The existing `/api/health` response and
Docker healthcheck remain unchanged.

The HTTP/static boundary belongs in the server's HTTP module. Domain,
application, persistence, and vault code remain unaware of browser assets.

## Deployment behavior

The supported Pi workflow remains:

```bash
docker compose pull kanleaf
docker compose up -d --no-build
```

After the container becomes healthy:

- `http://<pi-address>:3000/` opens Kanleaf;
- `http://<pi-address>:3000/api/health` verifies the server;
- existing Tauri clients may continue using the same API address.

PostgreSQL and vault mounts are unchanged, so image replacement does not move
or recreate application data. Server startup continues to run migrations before
accepting requests.

## Error handling

- A missing configured web root or `index.html` prevents server startup.
- A missing hashed asset returns 404 rather than `index.html`, making stale
  browser caches diagnosable.
- An unknown API path returns JSON 404 rather than SPA content.
- A frontend health-check failure uses the existing server-unavailable screen.
- API errors retain their current structured envelope and request IDs.
- Static-file failures do not expose host filesystem paths.

## Security considerations

The browser client uses the same bearer-session behavior as Tauri. Same-origin
serving removes cross-origin API configuration for the hosted client but does
not weaken server authorization; every Workspace, Project, Task, Library, and
vault request remains authorized by the backend.

LAN HTTP does not encrypt passwords or bearer tokens in transit. This design is
acceptable only for the explicitly requested trusted-LAN deployment and must
not be port-forwarded directly to the Internet. Domain, TLS, and reverse-proxy
guidance can be added when remote access becomes a requirement.

Markdown preview continues to reject raw HTML. Static routing must canonicalize
paths through the serving library and never concatenate request paths into host
filesystem paths.

## Testing

Frontend tests will cover:

- resolving `same-origin` from `window.location.origin`;
- retaining absolute URL validation;
- rejecting missing and malformed configuration.

Rust tests will use temporary web directories to cover:

- root `index.html` serving;
- existing static assets;
- SPA fallback;
- missing asset 404 behavior;
- unknown API JSON 404 behavior;
- disabled web serving when `KANLEAF_WEB_DIR` is absent;
- startup rejection for an invalid configured web root.

A focused Playwright self-host smoke workflow will build the frontend in
same-origin mode, start Axum with that build as its web root, open the UI from
Axum rather than Vite, and verify health plus the authentication screen. The
existing real-service workflow continues to cover the full product flow.

The normal verification suite remains formatting, TypeScript, ESLint, Vitest,
frontend build, Rust formatting, Clippy, Rust tests, PostgreSQL integration
tests, Playwright, and multi-platform image publication.

## Documentation and rollout

README, architecture, development, self-host, and environment documentation
will distinguish:

- Tauri/Vite development: explicit absolute server URL;
- published self-host image: browser client uses same-origin;
- API-only server execution: no web directory configured.

The first published `dev` image containing this change becomes directly usable
on the Pi after the existing update timer pulls and recreates the container. No
database migration or manual asset volume is required.
