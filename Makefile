COMPOSE := docker compose -f infra/compose.yaml

ifneq (,$(wildcard .env))
include .env
export
endif

DATABASE_URL ?= postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf

.PHONY: db-up db-down db-logs backend

db-up:
	$(COMPOSE) up -d postgres

db-down:
	$(COMPOSE) down

db-logs:
	$(COMPOSE) logs -f postgres

backend:
	cd backend && DATABASE_URL="$(DATABASE_URL)" cargo run --locked
