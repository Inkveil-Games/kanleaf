# Kanleaf

## Quickstart

Run all commands below from the repository root unless a step says otherwise.

Requirements:

- Rust and Cargo
- Docker with the Compose plugin
- Tauri CLI 2
- Dioxus CLI 0.7

Install the Rust CLIs if needed:

```bash
cargo install tauri-cli --version '^2.0.0' --locked
cargo install dioxus-cli --version '^0.7.0' --locked
```

On Linux, make sure `docker info` works without `sudo`. If it reports a socket
permission error, run the following once, then log out and back in:

```bash
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Create the local environment file. This creates an ignored `.env` file in the
repository root:

```bash
cp .env.example .env
```

Start PostgreSQL:

```bash
make db-up
```

Start the backend in the first terminal:

```bash
make backend
```

The backend listens on <http://127.0.0.1:3000> and runs pending database
migrations automatically.

### Desktop app

Start the desktop app in a second terminal:

```bash
cd app
cargo tauri dev
```

### Web only

To run the web UI without the desktop shell, use a second terminal instead:

```bash
cd app
dx serve --port 1420
```

Open <http://localhost:1420>. The backend must remain running separately.

### Stop

Stop PostgreSQL from the repository root:

```bash
make db-down
```

This keeps the PostgreSQL data in its Docker volume.

## Self-host

The self-host stack runs the Kanleaf backend and PostgreSQL together. Run these
commands from the repository root.

Create a private deployment configuration file, then edit its data directory,
bind address, port, and PostgreSQL password:

```bash
cp infra/self-host/.env.example infra/self-host/.env
```

`infra/self-host/.env` is ignored by Git. Use a strong URL-safe database
password because Compose uses it to construct `DATABASE_URL`.

Start the stack:

```bash
docker compose \
  --env-file infra/self-host/.env \
  -f infra/self-host/compose.yaml \
  up -d --build
```

The backend runs migrations automatically. Check it after the services start:

```bash
curl http://127.0.0.1:3000/api/health
```

Use the address and port configured in `infra/self-host/.env` if they differ.
The login screen's **Server** control lets each client select this address
without rebuilding Kanleaf.

View logs or stop the stack with:

```bash
docker compose --env-file infra/self-host/.env -f infra/self-host/compose.yaml logs -f
docker compose --env-file infra/self-host/.env -f infra/self-host/compose.yaml down
```

Stopping the stack keeps PostgreSQL files under
`KANLEAF_DATA_DIR/postgres`. PostgreSQL is not published to the host. To expose
Kanleaf directly on a trusted LAN or VPN, set `KANLEAF_BIND_ADDRESS=0.0.0.0`.
TLS, domains, reverse proxies, and VPNs remain external deployment concerns.
