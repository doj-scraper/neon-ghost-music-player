# Neon Sky Audio - Agent Guide

## Project Overview

Neon Sky Audio is a single-page music player application with audio mastering capabilities. It features a cyberpunk-inspired "liquid neon glassmorphism" design with a Web Audio-based engine for real-time audio processing, visualizations, and export functionality.

**Key Capabilities:**
- Music playback with transport controls (play/pause/prev/next)
- Real-time audio visualizer (spectrum, oscilloscope, vectorscope modes)
- 3-band EQ suite with real-time adjustments
- Playlist/queue management with multi-file upload
- Audio export/bounce via OfflineAudioContext
- ID3 metadata parsing with artwork extraction

## Technology Stack

- **Frontend Framework:** React 19 + TypeScript
- **Build Tool:** Vite 7 with custom plugins
- **Styling:** Tailwind CSS 4 (OKLCH color space, CSS variables)
- **UI Components:** Radix UI primitives + custom shadcn/ui-style components
- **Routing:** Wouter (lightweight React router)
- **Animation:** Framer Motion
- **Backend (Production):** Express 4 server for static file serving and SPA routing
- **Package Manager:** pnpm 10.4.1 (primary), npm compatible

## Project Structure

```
neon-sky-audio/
├── client/                    # Vite root + React SPA
│   ├── index.html            # HTML entry point
│   ├── public/               # Static public assets
│   │   └── worklets/         # AudioWorklet processors (limiter, meter)
│   └── src/
│       ├── components/       # React components
│       │   ├── ui/          # 50+ shadcn/ui-style components
│       │   ├── ErrorBoundary.tsx
│       │   ├── ManusDialog.tsx
│       │   └── Map.tsx
│       ├── contexts/         # React contexts (ThemeContext)
│       ├── hooks/            # Custom React hooks
│       │   ├── useAudioEngine.ts    # Core audio engine (Web Audio API)
│       │   ├── useComposition.ts    # Composition logic
│       │   ├── useMobile.tsx        # Mobile detection
│       │   └── usePersistFn.ts      # Persist function references
│       ├── pages/            # Page components
│       │   ├── Home.tsx      # Main player interface
│       │   └── NotFound.tsx
│       ├── lib/
│       │   └── utils.ts      # Utility functions (cn helper)
│       ├── index.css         # Tailwind entry + custom animations
│       ├── main.tsx          # React entry point
│       ├── App.tsx           # Root App component with routing
│       └── const.ts          # Client-side constants
├── server/
│   └── index.ts              # Express production server
├── shared/
│   └── const.ts              # Shared constants (COOKIE_NAME, ONE_YEAR_MS)
├── docs/
│   ├── ARCHITECTURE.md       # Detailed architecture documentation
│   └── audit.md              # Feature audit and wiring map
├── patches/                  # pnpm patches
│   └── wouter@3.7.1.patch
├── dist/                     # Production build output (generated)
├── .manus-logs/              # Dev-time browser debug logs (generated)
├── vite.config.ts            # Vite configuration with custom plugins
├── vercel.json               # Vercel deployment config
├── components.json           # shadcn/ui configuration
├── package.json
├── tsconfig.json             # TypeScript config (ESNext, bundler resolution)
└── .github/workflows/ci.yml  # GitHub Actions CI
```

## Build and Development Commands

All commands should be run from the `neon-sky-audio/` directory:

```bash
# Install dependencies
npm install
# OR (preferred)
pnpm install

# Start development server (port 3000)
npm run dev

# Production build
npm run build

# Preview production build locally
npm run preview

# Start production server (requires build first)
npm start

# Type checking
npm run typecheck
# OR
npm run check

# Linting
npm run lint

# Code formatting
npm run format
```

### Build Process Details

The build command runs two steps:
1. `vite build` - Bundles the React SPA into `dist/` (client assets)
2. `esbuild server/index.ts` - Bundles the Express server into `dist/index.js`

Output structure:
```
dist/
├── index.html           # SPA entry
├── assets/              # Bundled JS/CSS
├── worklets/            # AudioWorklet processors
└── index.js             # Express server bundle
```

## Code Style Guidelines

### Prettier Configuration
- **Semicolons:** Required
- **Quotes:** Double quotes
- **Print Width:** 80 characters
- **Tab Width:** 2 spaces (no tabs)
- **Trailing Commas:** ES5 style
- **Bracket Spacing:** Enabled
- **Arrow Function Parens:** Avoid when possible

### ESLint Rules
- TypeScript recommended rules enabled
- React and React Hooks plugins active
- **Disabled rules:** `react/react-in-jsx-scope`, `react/prop-types`, `@typescript-eslint/no-explicit-any`

### Import Aliases
Configured in both `tsconfig.json` and `vite.config.ts`:
- `@/` → `client/src/*`
- `@shared/` → `shared/*`
- `@assets/` → `attached_assets/`

### Naming Conventions
- React components: PascalCase (`Button.tsx`, `useAudioEngine.ts`)
- Utilities: camelCase (`utils.ts`, `const.ts`)
- CSS classes: Use Tailwind utilities; custom classes in `kebab-case`

### Component Patterns
Components follow the shadcn/ui pattern:
```typescript
// Variant-based styling with cva
const buttonVariants = cva(
  "base-classes",
  {
    variants: {
      variant: { default: "...", destructive: "..." },
      size: { default: "...", sm: "...", lg: "..." },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

// Use cn() utility for class merging
function Button({ className, variant, size, ...props }) {
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
```

## Key Technical Details

### Audio Engine Architecture
The core audio functionality is in `client/src/hooks/useAudioEngine.ts`:
- Web Audio API graph with AudioContext
- Three-band EQ (low/mid/high) with BiquadFilterNodes
- Compressor, limiter, and saturation effects
- Stereo width and pan controls
- Metering (peak, RMS, LUFS) via AudioWorklet
- Visualizer with AnalyserNode
- Export via OfflineAudioContext (WAV format)

### Safari/iOS Compatibility
Critical notes for audio development:
- AudioContext must be created/resumed on user gesture
- Visualizer uses ResizeObserver for responsive canvas sizing
- Touch events handled separately for mobile seek
- MediaRecorder fallback for export on Safari

### Styling System
- Tailwind CSS 4 with OKLCH color space
- CSS variables for theming (`--primary`, `--background`, etc.)
- Custom cyberpunk purple accent (`#bc13fe` / `oklch(0.68 0.24 310)`)
- Custom animations: `tieDye`, `spin-slow`, `pulse-glow`
- Font: JetBrains Mono (monospace)

### Environment Variables
Optional variables (used in `index.html`):
- `VITE_ANALYTICS_ENDPOINT` - Analytics endpoint URL
- `VITE_ANALYTICS_WEBSITE_ID` - Analytics website ID
- `VITE_OAUTH_PORTAL_URL` - OAuth portal base URL
- `VITE_APP_ID` - Application ID for OAuth

## Testing Strategy

**Current State:** No tests are currently implemented. Vitest is available as a dev dependency.

**Recommended Approach:**
- Unit tests: Vitest for utility functions and hooks
- Component tests: React Testing Library for UI components
- Integration: Test audio engine state management

To add tests:
```bash
npm install -D @testing-library/react @testing-library/jest-dom jsdom
# Create vitest.config.ts with jsdom environment
```

## Deployment

### Vercel (Static + SPA)
Build settings:
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- `vercel.json` handles SPA routing with rewrites to `index.html`

### Railway (Node Server)
Build settings:
- **Build Command:** `npm run build`
- **Start Command:** `npm start`
- Server reads `PORT` from environment (defaults to 3000)

### Root-Level Vercel Config
The root `vercel.json` (outside `neon-sky-audio/`) is configured for monorepo deployment:
```json
{
  "framework": "vite",
  "installCommand": "cd neon-sky-audio && npm install",
  "buildCommand": "cd neon-sky-audio && npm run build",
  "outputDirectory": "neon-sky-audio/dist"
}
```

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`):
- Triggers on pull requests
- Node.js 20 with npm caching
- Steps: checkout → install → typecheck → lint → build

## Development Notes

### Debug Log Collection
During development, browser logs are automatically collected and written to `.manus-logs/`:
- `browserConsole.log` - Console output
- `networkRequests.log` - Network activity
- `sessionReplay.log` - Session events

Logs are auto-trimmed to 1MB (keeps newest entries).

### Hot Module Replacement
Vite dev server runs on port 3000 with HMR enabled. The server allows specific hosts including `.manus.computer` domains for development environments.

### File Upload Handling
The audio engine supports multi-file uploads:
- Creates object URLs for audio files and artwork
- Automatically revokes URLs on replacement/unmount
- Parses ID3 metadata using `music-metadata` library

### Web Workers/Worklets
Audio processing worklets in `client/public/worklets/`:
- `limiter-processor.js` - Dynamics limiting
- `meter-processor.js` - Level metering (peak, RMS, LUFS)

These are not bundled by Vite and must remain in `public/`.

## Security Considerations

- **File System:** Vite dev server has strict FS access with dotfile denial
- **CORS:** No specific CORS configuration; defaults apply
- **Analytics:** Optional external analytics via environment variables
- **OAuth:** Client-side only; no server-side token storage

## Troubleshooting

### Common Issues

**Build fails with TypeScript errors:**
```bash
npm run typecheck  # Check types separately
```

**Audio not playing on iOS:**
- Ensure user interaction triggered the play action
- Check AudioContext state is `running`

**Visualizer shows blank:**
- Canvas resize observer may need time; check console for errors
- Verify AudioContext is not suspended

**pnpm patch not applying:**
```bash
cd neon-sky-audio && pnpm install
```

## Resources

- [Vite Documentation](https://vitejs.dev/)
- [Tailwind CSS Documentation](https://tailwindcss.com/)
- [Web Audio API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Radix UI Documentation](https://www.radix-ui.com/)
