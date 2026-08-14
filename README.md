# Kanleaf

## Quickstart

Install Docker with the Compose plugin and the required Rust CLIs first:

```bash
cargo install tauri-cli --version '^2.0.0' --locked
cargo install dioxus-cli --version '^0.7.0' --locked
```

Create the local environment file from the repository root. This creates an
ignored `.env` file in the current directory:

```bash
cp .env.example .env
```

### PostgreSQL

Run from the repository root. This starts PostgreSQL and stores its data in the
named `kanleaf_postgres_data` Docker volume:

```bash
make db-up
```

Stop PostgreSQL without deleting its data:

```bash
make db-down
```

### Backend server

Run from the repository root:

```bash
make backend
```

The server listens on <http://127.0.0.1:3000> by default.

### Desktop

In another terminal, run from the repository root:

```bash
cd app
cargo tauri dev
```

This starts the Dioxus development server and the Rust/Tauri app. The backend
server runs separately.

### Web only

To run only the web UI, use another terminal from the repository root:

```bash
cd app
dx serve --port 1420
```

Open <http://localhost:1420>. The backend server still runs separately.
