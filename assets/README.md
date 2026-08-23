# Assets

Tracked binary/vector assets **for the project and its README** — this folder is *not* served.
Anything the app has to fetch at runtime belongs in [`public/`](../public) instead, which Vite
copies to the site root verbatim (audio goes in `public/audio/`, e.g. the score at
`/audio/OneStillPoint.m4a`).

| file | what | how it's made |
| ---- | ---- | ------------- |
| [`hero.svg`](hero.svg) | The animated logo mark (a tilted accretion ring + event horizon + spiralling dust). Used in the README header and mirrored by the in-app About dialog (`src/ui/about.ts`). | Hand-authored SVG (self-contained CSS animation; dark card so it reads on either GitHub theme). |
| [`creation.gif`](creation.gif) | A looping capture of the **moment of creation** (the firework burst that opens the intro), shown in the README "Moment of creation" section. | Auto-generated — `npm run capture:creation` ([`scripts/capture-creation.mjs`](../scripts/capture-creation.mjs)). |
| [`splash.gif`](splash.gif) | A looping capture of the **load splash** (the binary-merger intro), shown in the README "Splash" section. | Auto-generated — `npm run capture:splash` ([`scripts/capture-splash.mjs`](../scripts/capture-splash.mjs)). |

## Regenerating the intro GIFs

```bash
npm run capture:creation    # → assets/creation.gif
npm run capture:splash      # → assets/splash.gif
```

The **moment of creation** is pure CSS keyframes, so its capture is a single
deterministic pass per frame — fire `--go`, freeze every animation at time *T* via
the Web Animations API (a small `--virtual-time-budget` lets the freeze apply),
screenshot, and stitch with ffmpeg.

The splash is CSS keyframes + a `<canvas>` particle field, so it can't be filmed
in real time headlessly. The script renders each frame in two deterministic
passes — CSS frozen at time *T* via the Web Animations API, and the canvas
advanced to *T* via Chromium's `--virtual-time-budget` — composites them, and
stitches a palette-optimised GIF with ffmpeg. Needs a Chromium and ffmpeg; set
`$CHROME` to point at a specific binary. **Re-run it after changing the splash**
(`index.html` / `src/style.css`) so the README stays in sync.
