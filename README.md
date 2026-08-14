# Kanleaf

## Quickstart

Install the required CLIs once:

```bash
cargo install tauri-cli --version '^2.0.0' --locked
cargo install dioxus-cli --version '^0.7.0' --locked
```

### Backend server

Run from the repository root:

```bash
cd backend
cargo run
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
