# Neon Sky Audio

Neon Sky Audio is a single-page music player experience built with React, Vite, and Tailwind CSS, served by a lightweight Express server for production deployments. The app bundles static assets with Vite and serves them from a Node runtime that handles SPA routing.

## Features

- React + Vite SPA with shared UI components and hooks.
- Tailwind CSS styling and Radix UI primitives.
- Express production server that serves the `dist/` build and handles client-side routing.
- Optional analytics configuration via `VITE_*` environment variables.

## Tech stack

- **Frontend:** React 19, Vite 7, Tailwind CSS 4, Radix UI, Framer Motion.
- **Backend (production serving):** Express 4 (static file server + SPA fallback).
- **Tooling:** TypeScript, ESLint, Prettier, pnpm/npm.

## Project structure

```text
neon-sky-audio/
├── client/            # Vite root + React SPA
│   ├── public/        # Static public assets
│   └── src/           # Application code
├── server/            # Express production server
├── shared/            # Shared constants/types
├── dist/              # Production build output (generated)
├── docs/              # Documentation (architecture, audits)
├── vercel.json        # Vercel SPA rewrite config
├── vite.config.ts     # Vite/Tailwind configuration
└── package.json       # Scripts and dependencies
```

## Local development

```bash
npm install
npm run dev
```

The app runs on `http://localhost:3000` by default.

## Build & preview

```bash
npm run build
npm run preview
```

The production build outputs to `dist/`.

## Testing & checks

Run these before deployment to validate the build:

```bash
npm run lint
npm run typecheck
npm run build
```

## Deployment

### Vercel (static + SPA routing)

1. Create a new Vercel project pointing at this repo.
2. Set the build settings:
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. Deploy.

> The included `vercel.json` configures SPA rewrites to `index.html`.

### Railway (Node server)

Railway can run the Express server for production traffic.

1. Create a new Railway project pointing at this repo.
2. Use the following settings:
   - **Build Command:** `npm run build`
   - **Start Command:** `npm start`
3. Ensure `NODE_ENV=production` is set (Railway defaults to this in most templates).
4. Railway will inject the `PORT` environment variable; the server reads it automatically.

## Environment variables

No environment variables are required for the default build. Optional analytics variables used in `client/index.html`:

- `VITE_ANALYTICS_ENDPOINT` (e.g., `https://analytics.example.com`)
- `VITE_ANALYTICS_WEBSITE_ID`

## Architecture

See `docs/ARCHITECTURE.md` for a detailed breakdown of the system, build pipeline, and deployment flows.
