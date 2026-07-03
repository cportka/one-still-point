# The intro — moment of creation · splash · sequencing

A small, self-contained **load intro** for the web: a black hold, a one-frame test
pattern, a pure-CSS **"moment of creation"** burst, and a colourful **binary-merger
splash** — all painting on the *first frame*, before your real app's bundle parses —
that then crossfades into your app, with a **Replay** that melts the live view inward
and plays it all again.

It's the intro of [**One Still Point**](https://onestillpoint.app) (`onestillpoint.app`),
kept here as **one cohesive, forkable unit** so it can be lifted into its own repo with
`git filter-repo` (see [Extract into its own repo](#extract-into-its-own-repo)). One Still
Point consumes these exact files, so this directory is the live source — it never rots.

> Names are prefixed `osp-` / `__osp` (One Still Point). They're just namespaces; rename
> them in a fork if you like (one find-and-replace across this directory + `intro.css`).

---

## What's here

| File | What it is |
| --- | --- |
| [`overlay.html`](overlay.html) | **The intro itself** — the creation + splash markup and the inline boot script that sequences them (`window.__ospSplash` / `__ospSplashPlay` / `__ospDials` / `__ospIntro`). Designed to be **inlined into your HTML before the bundle** so it paints first. |
| [`intro.css`](intro.css) | All the intro styles (creation burst, splash, Replay melt). Namespaced selectors only; driven by `--osp-*` custom properties. Load it as its own `<link>`. |
| [`introTimeline.ts`](introTimeline.ts) | The **dials** (`INTRO_DIALS`) and beat metadata — the one source of timing, mirrored by `window.__ospDials` in `overlay.html` (a test keeps them in lockstep). |
| [`melt.ts`](melt.ts) | The **Replay melt** — collapses a canvas inward toward the centre, then restores it. Host-agnostic (`meltInward(el, onComplete, opts)`). |
| `*.test.ts` | Unit tests for the timeline (incl. the inline-sync guard) and the melt. |
| [`README.md`](README.md) | This file. |

Satellites (outside this directory, but part of the unit — see the filter list below):

| Path | What it is |
| --- | --- |
| `../../scripts/verify-intro.mjs` | Headless visual + play-state test of the prelude beats (`npm run verify:intro`). |
| `../../scripts/capture-{creation,splash}.mjs` | Render the creation / splash to looping GIFs (`npm run capture:*`). |
| `../../assets/{creation,splash}.gif` | Captured intro loops. |
| `../../docs/intro-script.md` | The beat-by-beat storyboard. |

---

## How it works — the integration contract

The intro is **engine-agnostic**: it knows nothing about your app except one hook. The
whole surface is a handful of globals the inline script defines on `window`:

| Global | Direction | Meaning |
| --- | --- | --- |
| `window.__ospIntro()` | you call | Play the whole intro from black. Auto-called once on load; call again to replay. |
| `window.__ospDials` | you read/write | The live timing dials (ms + speed multipliers). Tweak then `__ospIntro()`. Mirrors `INTRO_DIALS`. |
| **`window.__ospBoot`** | **you define** | **The one hook.** The intro calls it at the very start so your app's heavy bundle loads *under the black hold* (not at the reveal). Define it to kick off loading (One Still Point does `() => import('./main.ts')`). Guarded by `window.__ospBooted`. |
| `window.__ospSplashStart` | you read | `performance.now()` of the splash's first *painted* frame. Hold your crossfade a minimum time past this so the merger is always seen (even on a slow mobile first paint). |
| `window.__ospSplash(defer)` / `__ospSplashPlay()` | internal/you | Build (and optionally pre-build-then-play) the splash. Rarely called directly. |

**Revealing your app.** The splash is an opaque layer (`#osp-splash`, the creation
`#osp-creation` above it). When your app's first real frame is ready *and* the splash has
had its minimum time on screen, add the class **`osp-splash--hide`** to crossfade it out:

```js
const splash = document.getElementById('osp-splash');
const MIN_ON_SCREEN = window.__ospDials.splashHoldMs; // 600ms by default
const reveal = () => splash.classList.add('osp-splash--hide');
// wait for the splash's first paint, then its minimum hold, then reveal:
(function whenPainted() {
  const t = window.__ospSplashStart;
  if (t === undefined) return requestAnimationFrame(whenPainted);
  setTimeout(reveal, Math.max(0, t + MIN_ON_SCREEN - performance.now()));
})();
```

**Replay.** `meltInward(yourCanvas, onMelted, { durationMs })` collapses the live view
inward; in `onMelted` re-run `window.__ospIntro()` (the black hold hides the snap-back),
then `meltInward(...).restore()` once the splash covers again. See `main.ts` in One Still
Point for the reference wiring.

**The dials drive CSS** via custom properties on the layers (set by `__ospIntro` from
`__ospDials`): `--osp-cr-scale` / `--osp-splash-scale` (animation speed), `--osp-cr-fade`
/ `--osp-splash-fade` (crossfade speed). So timing lives in one place (the dials) and the
stylesheet just reads it.

---

## Use it in your own app — three steps

1. **Inline `overlay.html` before your bundle** so it paints first. The cleanest way is a
   tiny Vite plugin that replaces a marker (build-time inline, not a runtime fetch — see
   the [standalone `vite.config.ts`](#2-viteconfigts) below). Put `<!-- @osp-intro-overlay -->`
   in your `index.html` `<body>` and the plugin swaps in `overlay.html`.
2. **Link the stylesheet**: `<link rel="stylesheet" href="/src/intro/intro.css" />`.
3. **Define `window.__ospBoot`** (start loading your app) and **add `osp-splash--hide`**
   when your app is ready (snippet above). That's the whole contract.

---

## Extract into its own repo

The other repo is built with [`git filter-repo`](https://github.com/newren/git-filter-repo)
(the modern replacement for `filter-branch` / subtree split): clone One Still Point, then
rewrite the clone so **only the intro paths remain, with their commit history intact**.

```bash
git clone https://github.com/cportka/one-still-point moment-of-creation
cd moment-of-creation

git filter-repo \
  --path src/intro/ \
  --path scripts/verify-intro.mjs \
  --path scripts/capture-creation.mjs \
  --path scripts/capture-splash.mjs \
  --path assets/creation.gif \
  --path assets/splash.gif \
  --path docs/intro-script.md
```

That leaves a tidy tree (`src/intro/`, `scripts/`, `assets/`,
`docs/`) carrying just the commits that touched those files. Keep the `src/intro/` layout
as-is — every reference (`/src/intro/intro.css`, the overlay marker)
already lines up, so nothing needs rewriting.

### Then add a tiny scaffold (the only "new" files)

The intro deliberately isn't a standalone build system, so add these four small files and
you're running. They're generic — no app coupling.

#### 1. `package.json`

```json
{
  "name": "intro",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "verify:intro": "node scripts/verify-intro.mjs",
    "capture:creation": "node scripts/capture-creation.mjs",
    "capture:splash": "node scripts/capture-splash.mjs"
  },
  "devDependencies": {
    "@types/node": "^22",
    "jsdom": "^25",
    "typescript": "^5",
    "vite": "^7",
    "vitest": "^3"
  }
}
```

#### 2. `vite.config.ts`

The build-time overlay-inliner (lifted verbatim from One Still Point — in a standalone
repo you can import `node:fs` directly once `@types/node` is installed, so the shim One
Still Point needed isn't required):

```ts
import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';

const OVERLAY_MARKER = '<!-- @osp-intro-overlay -->';
const overlayUrl = new URL('./src/intro/overlay.html', import.meta.url);

function introOverlay(): Plugin {
  return {
    name: 'intro-overlay',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.includes(OVERLAY_MARKER) ? html.replace(OVERLAY_MARKER, readFileSync(overlayUrl, 'utf8')) : html,
    },
    handleHotUpdate(ctx) {
      if (ctx.file.endsWith('/src/intro/overlay.html')) {
        ctx.server.hot.send({ type: 'full-reload' });
        return [];
      }
    },
  };
}

export default defineConfig({ plugins: [introOverlay()] });
```

#### 3. `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "moduleDetection": "force"
  },
  "include": ["src", "vite.config.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

#### 4. `index.html` (a demo)

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="color-scheme" content="dark" />
    <title>The intro</title>
    <link rel="stylesheet" href="/src/intro/intro.css" />
  </head>
  <body style="margin: 0; background: #05060a">
    <!-- @osp-intro-overlay -->
    <script type="module">
      // Where your real app would load. Here we just reveal a placeholder once the
      // splash has played its minimum time, to show the full handoff.
      window.__ospBoot = () => {
        /* import('./your-app.ts') */
      };
      const splash = document.getElementById('osp-splash');
      const hold = window.__ospDials.splashHoldMs;
      (function whenPainted() {
        const t = window.__ospSplashStart;
        if (t === undefined) return requestAnimationFrame(whenPainted);
        setTimeout(() => splash.classList.add('osp-splash--hide'), Math.max(0, t + hold - performance.now()));
      })();
    </script>
  </body>
</html>
```

Then:

```bash
npm install
npm run dev            # http://localhost:5173  (the intro)
npm test               # the timeline + melt unit tests
npm run verify:intro   # headless visual test of the prelude beats (needs Chromium + ffmpeg)
```

> The capture scripts (`capture:creation` / `capture:splash`) need a Chromium/headless
> shell + ffmpeg. The splash's canvas dust layer wants a *real* first paint, so capture it
> in a headed/real headless browser rather than a virtual-time one if the dust comes out
> sparse.

---
