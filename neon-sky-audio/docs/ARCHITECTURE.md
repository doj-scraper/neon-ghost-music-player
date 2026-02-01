# Neon Sky Audio Architecture

## Overview

Neon Sky Audio is a Vite-powered React single-page application (SPA) with a minimal Express server used in production to serve static assets and handle client-side routing. The codebase is organized into a `client` app, a `server` runtime for production, and shared constants used across layers.

## High-level architecture

```text
┌──────────────────────────────────────────────────────────┐
│                      Browser (SPA)                       │
│  React UI + Hooks + Tailwind CSS + Radix Components       │
└───────────────▲──────────────────────────────────────────┘
                │ HTTP (static assets + SPA routes)
                │
┌───────────────┴──────────────────────────────────────────┐
│                 Express Production Server                │
│  Serves dist/ assets + SPA fallback to index.html         │
└───────────────▲──────────────────────────────────────────┘
                │
                │ Build output (Vite + esbuild)
                ▼
┌──────────────────────────────────────────────────────────┐
│                           dist/                          │
│  Compiled SPA + bundled Node server                       │
└──────────────────────────────────────────────────────────┘
```

## Runtime flow

1. **Development**
   - `npm run dev` starts the Vite dev server on port 3000.
   - Vite serves the SPA from `client/`, handling module transforms and HMR.
2. **Production**
   - `npm run build` runs:
     - `vite build` to create the SPA bundle in `dist/`.
     - `esbuild server/index.ts` to bundle the Express server into `dist/index.js`.
   - `npm start` launches the Express server, which:
     - Serves static assets from `dist/`.
     - Falls back to `index.html` for all routes to support client-side routing.

## Code organization

- `client/`
  - `index.html` is the Vite HTML entry.
  - `src/` contains React components, pages, hooks, contexts, and styling.
- `server/`
  - `index.ts` defines the Express server for production hosting.
- `shared/`
  - Shared constants used across the codebase.
- `docs/`
  - Architecture and audit documentation.

## Build & tooling pipeline

- **Vite** handles the SPA build, TypeScript support, and asset bundling.
- **Tailwind CSS** is configured through the Vite plugin and styles in `client/src/index.css`.
- **esbuild** bundles the Express server into `dist/index.js` for production.
- **TypeScript** is used across both client and server for type safety.

## Configuration

- `vite.config.ts`
  - Vite root is `client/`.
  - Output directory is `dist/`.
  - Path aliases:
    - `@` → `client/src`
    - `@shared` → `shared`
- `vercel.json`
  - Configures SPA rewrites for static deployments.

## Deployment targets

### Vercel (static)

- Uses the SPA build output in `dist/`.
- SPA routing is handled by the `vercel.json` rewrite to `index.html`.
- Recommended settings:
  - Build Command: `npm run build`
  - Output Directory: `dist`

### Railway (Node server)

- Runs the Express server after `npm run build`.
- Recommended settings:
  - Build Command: `npm run build`
  - Start Command: `npm start`
- Railway provides `PORT`; the server reads `process.env.PORT` automatically.

## Observability & logging

- The Vite development server includes a debug log collector that stores browser logs in `.manus-logs/` during local development.
- No production logging pipeline is configured by default.

## Future extension points

- Add API routes to the Express server for music metadata or user profiles.
- Extend analytics handling with server-side forwarding or feature flags.
- Introduce tests (unit + component) with Vitest or React Testing Library.
