# YükLab

Global Smart Logistics Network.

YükLab is a web-first, cross-platform, API-first logistics platform designed for Turkey first and global expansion later.

## Architecture

- `apps/web` — Next.js + TypeScript web/PWA client
- `apps/api` — Node.js + TypeScript API
- `packages/ui` — shared UI primitives and design tokens
- `packages/types` — shared domain types
- `packages/validation` — shared validation schemas
- `packages/i18n` — localization resources and helpers
- `infra` — local infrastructure and deployment configuration
- `docs` — architecture and product documentation

## Principles

- Modular monolith first; extract services when scale justifies it.
- API-first boundaries between clients and backend.
- Turkey-first UX with global-ready localization and country configuration.
- Type-safe contracts and validation.
- Production-oriented security, testing, observability, and performance.

## Development

This repository is currently in Phase 1: architecture and design-system foundation.

The implementation will be expanded incrementally. Features must be wired end-to-end rather than represented by visual-only mock controls.
