# Kanleaf Agent Guidelines

## Product direction

Kanleaf is an open-source, local-first-friendly task and project management
application developed for Inkveil Games. It combines structured task workflows
inspired by Plane and GitHub Issues/Projects with Markdown-first content inspired
by Obsidian.

Each task has two separate conceptual parts:

- structured metadata such as ID, title, status, priority, project, timestamps,
  and relationships;
- a reference to a normal Markdown document containing long-form content.

Do not collapse structured application state and Markdown content into one data
representation or assume all task state belongs in Markdown frontmatter.

## Technology direction

- Use Rust for the backend, domain logic, persistence, and vault operations.
- Tauri is the preferred desktop and multiplatform application shell.
- Keep Tauri-specific code at the application boundary.
- Use a web frontend inside Tauri, but do not introduce speculative
  cross-platform abstractions.
- Keep the backend small and modular. Do not introduce microservices or elaborate
  infrastructure without a concrete need.

## Architecture and dependency direction

Start simple and grow incrementally. Dependencies should flow inward:

```text
UI / Tauri commands
        ↓
Application
        ↓
Domain
```

Infrastructure provides concrete adapters needed by application or domain code.
Domain code must not depend on Tauri, database drivers, filesystem
implementations, or frontend code.

Layer responsibilities:

- `domain`: pure business concepts and rules such as Task, Project, Status,
  Priority, IDs, and domain errors. It must be testable without Tauri, a
  database, or a filesystem.
- `application`: use cases coordinating domain objects, such as creating,
  updating, or deleting a task and attaching a Markdown document.
- `infrastructure`: concrete database, filesystem, Markdown vault, and
  configuration adapters.
- `commands`: thin Tauri boundaries that deserialize and validate input, invoke
  an application use case, and translate its result for the frontend. Do not put
  business logic in commands.

These are responsibility boundaries, not a requirement to pre-create matching
crates or directories.

## Repository and Rust workspace philosophy

Prefer the smallest useful repository structure and expand only when complexity
appears. Reuse current conventions rather than inventing a parallel
architecture.

Prefer this evolution:

```text
small module → larger module → extracted crate
```

Do not create placeholder crates, services, packages, or directories for future
requirements. Extract a crate only when an existing body of code has a clear
responsibility boundary. Use a Cargo workspace when multiple Rust components
actually become necessary.

Before creating a top-level directory or Rust crate:

1. Explain the responsibility it owns.
2. Explain why an existing module cannot own it.
3. Identify its dependency direction.
4. Confirm there is actual code to put in it.

## Markdown vault

Markdown content is first-class user data. The vault is a user-selected or
user-owned directory, not application source code and not opaque database data.
Markdown files should remain human-readable, inspectable, and editable with
other Markdown tools where reasonably possible.

The exact vault layout is not decided. Avoid an elaborate hierarchy until real
requirements justify it. Prefer stable document IDs or references over treating
filenames as permanent identity, but discuss the mapping before committing to a
design.

## Persistence

Structured task metadata needs a proper persistence layer, while Markdown stays
filesystem-based. Keep persistence concerns sufficiently separate from domain
logic so the implementation can evolve.

PostgreSQL, SQLite, and other options have not been permanently selected. Do not
silently make a lasting storage choice without discussing options and trade-offs.
Do not commit local databases, vault contents, secrets, build output, or
machine-specific editor state unless explicitly required as development
fixtures or shared project configuration.

## Implementation approach

Build vertically whenever practical:

```text
UI → application logic → persistence
```

Prefer a complete small feature over empty architectural layers. The first
important milestone is:

```text
Create task
    → save structured metadata
    → create/open its Markdown document
    → edit it
    → restart Kanleaf
    → retain both metadata and Markdown content
```

Current priorities are:

1. Establish a working Tauri application.
2. Establish a clean, minimal Rust architecture.
3. Define the minimal Task domain model.
4. Decide how structured data is persisted.
5. Define how tasks reference Markdown documents.
6. Implement basic vault/file operations.
7. Build a minimal end-to-end task workflow.
8. Expand the architecture only in response to concrete requirements.

## Workflow for changes

Before coding:

1. Inspect the repository and current directory structure.
2. Inspect relevant `Cargo.toml`, Tauri configuration, frontend package
   configuration, and existing modules.
3. Identify the appropriate existing responsibility or layer.
4. Propose significant structural changes before performing them.
5. Make the smallest coherent change that solves the requested problem.

After coding:

1. Run formatting.
2. Run relevant tests.
3. Run applicable lint and check commands.
4. Review the diff for unrelated changes and unnecessary abstractions.

When giving setup commands, explicitly state the working directory, what the
command creates or changes, and whether it modifies the current directory or
creates a new project directory.

## Decisions that remain open

Do not silently make these permanent architectural decisions:

- PostgreSQL vs. SQLite vs. another database;
- the exact Markdown vault layout;
- the exact mapping between task entities and Markdown files;
- a Markdown frontmatter schema;
- the frontend framework used inside Tauri;
- whether a future web app shares the exact desktop frontend;
- sync, collaboration, and conflict-resolution architecture;
- plugin architecture;
- exact monorepo or Cargo workspace layout;
- attachment storage;
- search and indexing technology.

Propose options and trade-offs before making large structural commitments in
these areas. Design current code so likely future concerns are not needlessly
blocked, but do not implement them before they are needed.

## Guiding principle

Kanleaf should feel like a structured project and task manager in which every
task can also be a real, durable Markdown document. Choose the simplest solution
that satisfies the current requirement without obviously blocking this product
direction.
