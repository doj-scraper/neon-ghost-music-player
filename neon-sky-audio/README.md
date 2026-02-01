# Neon Sky Audio

## Local development

```bash
npm install
npm run dev
```

The app runs on `http://localhost:3000` by default.

## Build

```bash
npm run build
npm run preview
```

The production build outputs to `dist/`.

## Deployment (Vercel)

1. Create a new Vercel project pointing at this repo.
2. Use the following settings:
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. Deploy.

> The `vercel.json` file in this repo already configures the SPA rewrite to `index.html`.

## Environment variables

No environment variables are required for the default build. Optional analytics variables used in `index.html`:

- `VITE_ANALYTICS_ENDPOINT` (e.g., `https://analytics.example.com`)
- `VITE_ANALYTICS_WEBSITE_ID`
