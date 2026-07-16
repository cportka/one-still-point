import GUI, { type Controller } from 'lil-gui';
import type BloomNode from 'three/addons/tsl/display/BloomNode.js';
import type { WebGPURenderer } from 'three/webgpu';
import { VERSION } from '../version';
import type { FormationSequence } from '../core/FormationSequence';
import type { QualityTier } from '../core/quality';
import type { ResolutionScaler } from '../core/ResolutionScaler';
import type { TimeController } from '../core/TimeController';
import type { PhysicsController } from '../physics/PhysicsController';
import { setDarkSector } from '../physics/integrators';
import { MAX_BODIES } from '../render/bodyUniforms';
import type { BodyType } from '../scene/Body';
import type { BlackHole } from '../scene/BlackHole';
import { bodyCap, type Scene } from '../scene/Scene';
import type { Hud } from './hud';
import type { HistoryBar } from './historyBar';
import { createAboutButton } from './about';
import { createGalaxyDials, type GalaxyDial } from './galaxyFolder';
import { createHudFolder } from './hudFolder';
import { attachKeybindings } from './keybindings';
import { createShareButton } from './share';
import { BACKGROUNDS, BG_PRESETS, PRESETS } from './presets';
import { createStepper, type Stepper } from './stepper';
import { attachTouchTooltips } from './touchTooltips';

/** Attach a native hover tooltip to a controller's row. */
function tip<T extends Controller>(controller: T, text: string): T {
  controller.domElement.title = text;
  return controller;
}

/**
 * The lil-gui control panel. Expanded, it leads with the essentials —
 * About/version · Filter · Background · Bodies (± steppers) · Replay · Pause · Step · an
 * Advanced-settings toggle — and folds the deep tuning (Galaxy mode, click-outside, Speed, and
 * the Look / Animation / Bloom / Quality / Background folders, each starting collapsed) behind that
 * toggle. Nothing persists across page loads — every fresh open starts from defaults (Advanced OFF).
 * Every row has a hover tooltip (long-press on touch).
 */
export function createControls(ctx: {
  blackHole: BlackHole;
  scene: Scene;
  physics: PhysicsController;
  time: TimeController;
  formation: FormationSequence;
  renderer: WebGPURenderer;
  scaler: ResolutionScaler;
  bloom: BloomNode;
  hud: Hud;
  autoTier: QualityTier;
  applyQuality: (tier: QualityTier) => void;
  background: { value: number };
  bgLook: { brightness: { value: number }; saturation: { value: number }; tint: { value: number } };
  /** Melt the live view inward, then replay the whole intro from the black screen.
   *  `onReplay` runs after the melt, under the black/splash (re-seed + restart). */
  replaySplash: (onReplay?: () => void) => void;
  /** The bottom history scrub bar — always on, hidden only during a Replay intro. */
  historyBar: HistoryBar;
  /** Cap the render rate (0 = uncapped). Drives the optional cinematic frame cap. */
  setMaxFps: (fps: number) => void;
  /** Toggle Galaxy Mode (roadmap #9) — a small full galaxy around the central hole. */
  setGalaxyMode: (on: boolean) => void;
  isGalaxyMode: () => boolean;
  /** Push a live Galaxy-Mode dial (rotation speed / brightness / size / core glow) to the layer. */
  setGalaxyDial: (key: GalaxyDial, value: number) => void;
}): GUI {
  const { blackHole: bh, scene, physics, time, formation, renderer, scaler, bloom } = ctx;
  const { hud, autoTier, applyQuality, background, bgLook, replaySplash, historyBar, setMaxFps, setGalaxyMode, isGalaxyMode, setGalaxyDial } = ctx;
  const gui = new GUI({ title: 'One Still Point' });
  // Control labels are UI chrome, not page content — keep them out of search snippets.
  gui.domElement.setAttribute('data-nosnippet', '');
  // The still Ember-Core mark rides the title row, right-aligned (served as the favicon, so it's
  // already cached). lil-gui's $title is the header button — flex it and let the mark sit at the end.
  {
    const mark = document.createElement('img');
    mark.src = '/favicon.svg';
    mark.alt = '';
    mark.setAttribute('aria-hidden', 'true');
    mark.className = 'osp-panel__mark';
    gui.$title.appendChild(mark);
    gui.$title.classList.add('osp-panel__title');
  }
  // Settings are intentionally NOT persisted across page loads — every fresh open / hard refresh
  // starts from these defaults (Advanced OFF). Within a session the live panel keeps its values, and
  // Galaxy Mode / Replay intro don't rebuild it, so a mode toggle preserves the user's tweaks; only a
  // reload resets them. (This is a deliberate product choice — see the removed localStorage blob.)
  const prefs = { advanced: false, tapOutsideClose: true, showFps: false };

  // --- Filter (named looks; formerly "Preset") ---
  const filterProxy = { preset: 'Physical' };
  const filterCtrl = tip(
    gui
      .add(filterProxy, 'preset', Object.keys(PRESETS))
      .name('Filter')
      .onChange((name: string) => {
        const p = PRESETS[name];
        if (!p) return;
        bh.emissiveStrength.value = p.emissiveStrength;
        bh.diskDensity.value = p.diskDensity;
        bh.diskTemp.value = p.diskTemp;
        bh.scatterStrength.value = p.scatterStrength;
        bh.extinction.value = p.extinction;
        bh.doppler.value = p.doppler;
        bh.redshift.value = p.redshift;
        bh.turbAmount.value = p.turbAmount;
        bh.rotationSpeed.value = p.rotationSpeed;
        renderer.toneMappingExposure = p.exposure;
        gui.controllersRecursive().forEach((c) => c.updateDisplay());
      }),
    'A named look. Physical = accurate (full beaming + redshift). EHT (Event Horizon ' +
      'Telescope) = the real imaged look of M87*/Sgr A*: a cooler, smoother orange photon ' +
      'ring. Interstellar = symmetric, beaming OFF (stylised). Stylized = hot, punchy, ' +
      'turbulent. Filters toggle real physics on/off.',
  );

  // --- Background (the sky behind everything; it lenses around the holes too) ---
  // BACKGROUNDS + BG_PRESETS live in presets.ts, shared with the worker panel (step 4a).
  const bgCtrls: Controller[] = []; // the Background folder's sliders (filled below)
  const applyBgPreset = (mode: number): void => {
    const p = BG_PRESETS[mode] ?? BG_PRESETS[0]!;
    bgLook.brightness.value = p.brightness;
    bgLook.saturation.value = p.saturation;
    bgLook.tint.value = p.tint;
    bgCtrls.forEach((c) => c.updateDisplay());
  };
  const bgProxy = { sky: BACKGROUNDS[background.value] ?? 'Stars' };
  const bgSkyCtrl = tip(
    gui.add(bgProxy, 'sky', BACKGROUNDS).name('Background').onChange((v: string) => {
      const mode = Math.max(0, BACKGROUNDS.indexOf(v));
      background.value = mode;
      applyBgPreset(mode); // load that sky's look preset
    }),
    'The sky behind the hole — it lenses around the shadow either way. Stars = the default ' +
      'star field; Nebula = a glowing Eagle-palette gas cloud; Filaments = a monochrome cosmic ' +
      'web; Lattice = a spacetime grid that visibly warps near the holes. Each loads its own ' +
      'look preset (Advanced → Background).',
  );

  // Speed now lives under Advanced settings (created just before the Look folder, below), so the
  // regular menu leads with Filter · Background · Bodies. The ↑/↓ keys still drive it via `speedBy`.

  // --- Bodies (− N + steppers; how many black holes orbit caps the rest) ---
  const bodies = gui.addFolder('Bodies');
  const countOf = (type: BodyType): number => scene.companions.filter((b) => b.type === type).length;
  // A 4th black hole is only allowed when nothing else orbits, so the hole cap
  // also depends on the star + planet count (not just the hole count).
  const capFor = (type: BodyType): number => bodyCap(type, countOf('hole'), countOf('star') + countOf('planet'));
  const steppers: Stepper[] = [];
  const refreshAll = (): void => steppers.forEach((s) => s.refresh());
  // De-bounce adds (rapid-fire adds are what crowd the scene into the close
  // encounters that misbehave): half a second for stars/planets, a full second
  // for the heavier black holes. The + buttons grey out for the cooldown, then a
  // scheduled refresh re-enables them.
  const cooldownMs = (type: BodyType): number => (type === 'hole' ? 1000 : 500);
  let addReadyAt = 0;
  const addStepper = (type: BodyType, label: string, add: () => void): void => {
    const noun = label.toLowerCase().replace(/s$/, '');
    const stepper = createStepper({
      label,
      count: () => countOf(type),
      canInc: () =>
        performance.now() >= addReadyAt && countOf(type) < capFor(type) && scene.companions.length < MAX_BODIES,
      // − is blocked while a removal is still plunging in, so removals queue one
      // at a time (each plays its full collision animation before the next).
      canDec: () => countOf(type) > 0 && !scene.removing,
      onInc: () => {
        add();
        physics.syncBodies();
        const cd = cooldownMs(type);
        addReadyAt = performance.now() + cd;
        refreshAll(); // a new hole can lower the star/planet caps; also greys + for the cooldown
        window.setTimeout(refreshAll, cd); // re-enable + when the cooldown is up
      },
      onDec: () => {
        // Begins the plunge animation; the body (and the GPU buffers) are freed
        // when it lands, via prune → onChange → refreshAll.
        scene.removeOne(type);
        refreshAll();
      },
      incTip: `Add a ${noun}`,
      decTip: `Remove a ${noun}`,
    });
    steppers.push(stepper);
    bodies.$children.appendChild(stepper.row);
  };
  addStepper('star', 'Stars', () => scene.addStar());
  addStepper('planet', 'Planets', () => scene.addPlanet());
  addStepper('hole', 'Black holes', () => scene.addBlackHole());
  scene.onChange = refreshAll; // keep the counts live when bodies escape / merge

  // --- Replay intro (melt inward → replay everything from the black screen) ---
  // Named so the R key can trigger it too (see attachKeybindings below). The re-seed
  // + restart run *after* the 2s melt (passed as the callback), under the black/splash
  // — so the live view collapses inward before the scene re-forms.
  const replayIntro = (): void => {
    // Get the panel out of the way for the whole replayed intro: collapse it (so it
    // returns folded, not expanded) and hide it entirely. It reappears via
    // formation.onDone (below) only once the replayed intro has finished settling.
    gui.close();
    gui.hide();
    historyBar.setVisible(false); // the scrub bar rides with the panel — hide it for the Replay
    // In Galaxy Mode the *exit* path already is an intro replay — it reseeds, restarts the formation,
    // and clears the mode so the timeline + raymarch resume. Route Replay through it; a plain
    // replaySplash here would render invisibly under the still-opaque galaxy backdrop with physics
    // frozen. (The Galaxy checkbox self-corrects on its next click.)
    if (isGalaxyMode()) {
      setGalaxyMode(false);
      return;
    }
    replaySplash(() => {
      scene.reseed(); // fresh orbits for the current composition
      physics.syncBodies(); // rebuild GPU buffers for the new bodies
      refreshAll(); // update counts + ± limits
      formation.restart();
    });
  };
  // Reveal the panel + scrub bar again the moment the (replayed) intro finishes its dolly, and
  // re-sync the mode-aware menu (a Galaxy exit / Replay lands here in Singularity mode). Harmless on
  // first load — the panel is already shown and the mode already Singularity. `refreshModeUI` is a
  // mutable hook assigned once the mode registry exists (below), so this closure can reference it early.
  let refreshModeUI = (): void => {};
  formation.onDone = () => {
    gui.show();
    historyBar.setVisible(true);
    refreshModeUI();
  };
  const replayCtrl = tip(
    gui.add({ replay: replayIntro }, 'replay').name('Replay intro'),
    'Melt the current view inward toward the centre (~2s), then replay the whole intro from the ' +
      'black screen — re-seeded onto fresh orbits, so it looks like a clean page-load for the same ' +
      'line-up (identical for the default 3 + 3). [R]',
  );

  // --- Pause + Step, then Display HUD (the last regular controls, before the Advanced toggle) ---
  // Pause is a proper toggle button that shows its own state (label + a lit
  // "pressed" style when paused), not a checkbox. A lil-gui function controller
  // calls its function on click, so route it through a mutable callback.
  let onPauseClick = (): void => {};
  const pauseCtrl = gui.add({ toggle: () => onPauseClick() }, 'toggle');
  const refreshPause = (): void => {
    pauseCtrl.name(time.paused ? 'Resume' : 'Pause'); // text only — no glyphs
    pauseCtrl.domElement.classList.toggle('osp-paused', time.paused); // red = stopped
    pauseCtrl.domElement.classList.toggle('osp-running', !time.paused); // green = running
  };
  onPauseClick = (): void => {
    time.paused = !time.paused;
    refreshPause();
  };
  pauseCtrl.domElement.classList.add('osp-pausebtn');
  refreshPause();
  tip(pauseCtrl, 'Freeze time to inspect the lensing on a still frame. Click again to resume.');
  const stepFwdCtrl = tip(
    gui.add({ step: () => time.step() }, 'step').name('Step forward'),
    'Advance time (→ key). Paused: one frame at the current Speed. Running: a ~1-second jump ' +
      'forward (at least 20 frames) at the current Speed.',
  );
  const stepBackCtrl = tip(
    gui.add({ stepBack: () => time.stepBack() }, 'stepBack').name('Step back'),
    'Rewind time (← key). Paused: one frame back; running: a ~1-second jump back. The orbits ' +
      'reverse exactly (the integrator is time-reversible) — but absorbed/removed bodies and the ' +
      'one-shot intro do not come back.',
  );

  // --- Display HUD: the last regular control, under Step back ---
  // A compact collapsible folder whose *title carries the on/off checkbox* (off + collapsed by
  // default); its children — Frame-time graph + Detail — are on by default, so the first time the
  // HUD is turned on it shows everything. It lives in the regular menu, not behind Advanced (so the
  // folder is created here for its DOM position; only its on/off toggle is referenced later).
  const { toggle: toggleFps } = createHudFolder(gui, hud, prefs, tip);

  // --- Advanced settings toggle (remembered across sessions) ---
  const advCtrl = gui.add(prefs, 'advanced').name('Advanced settings');
  advCtrl.domElement.classList.add('osp-section'); // bold label + a stronger divider

  // --- Advanced, first item: the MODE SWITCH (roadmap #9). The two modes — Singularity (the raymarched
  // black hole + N-body companions) and Galaxy (the spiral) — now have distinct settings, so this is a
  // button that flips between them and relabels: "Galaxy mode" in Singularity, "Singularity mode" in
  // Galaxy. Below it, the mode-specific settings show/hide via the registry (applyVisibility). Entering
  // Galaxy updates the menu at once; exiting routes through the intro-replay, so the menu re-syncs on
  // formation.onDone (refreshModeUI). Same slot the old Galaxy toggle held.
  const modeBtn = gui.add({ switch: () => onModeSwitch() }, 'switch').name('Galaxy mode');
  modeBtn.domElement.classList.add('osp-modebtn');
  const relabelMode = (): void => {
    const inGalaxy = isGalaxyMode();
    modeBtn.name(inGalaxy ? 'Singularity mode' : 'Galaxy mode');
    modeBtn.domElement.classList.toggle('osp-mode-galaxy', inGalaxy); // in Galaxy → "return" affordance
  };
  const onModeSwitch = (): void => {
    if (isGalaxyMode()) {
      // Exit to Singularity — tuck the panel away for the exit intro (like Replay); formation.onDone
      // re-shows it and re-syncs the menu to Singularity.
      gui.close();
      gui.hide();
      historyBar.setVisible(false);
      setGalaxyMode(false);
    } else {
      // Enter Galaxy — galaxyMode flips synchronously, so update the menu at once (no intro replay on
      // enter); then re-sync once the async lazy build settles, so a rare build failure that drops back
      // to Singularity corrects the menu rather than stranding it on the Galaxy view.
      const entering = setGalaxyMode(true);
      refreshModeUI();
      // Re-sync on both settle + reject (a stray rejection shouldn't strand the menu; the sync call
      // above already applied the optimistic state, and galaxyMode reflects reality either way).
      void Promise.resolve(entering).then(refreshModeUI, refreshModeUI);
    }
  };
  tip(
    modeBtn,
    'Switch between Singularity mode (the black hole + its orbiting bodies) and Galaxy mode (a small ' +
      'spiral galaxy — glowing core, blue arms, ~1600 stars). Each has its own settings below. Entering ' +
      'Galaxy pauses regular mode; returning replays the intro. (The camera auto-frames the galaxy.)',
  );

  // --- Speed — the mode switch's immediate neighbour. Created right after the mode button so in
  // Galaxy mode it sits directly below the "Singularity mode" return button (the two most-used Galaxy
  // controls at the top, then the dials); in Singularity it opens the tuning run. Log-space, so it
  // tracks the slider and the ↑/↓ keys' double / halve. ---
  const speedProxy = { exp: 0 };
  const fmtScale = (s: number): string => {
    if (s >= 1e6) return `${(s / 1e6).toFixed(1)}M`;
    if (s >= 1e3) return `${(s / 1e3).toFixed(1)}k`;
    if (s >= 1) return `${Math.round(s)}`;
    return `1/${Math.round(1 / s)}`; // slow-motion: ×1/10 … ×1/1000
  };
  // exp is log10(timeScale): −3 → ×1/1000 (slow-mo) up to 6 → ×1,000,000.
  const speedCtrl = gui.add(speedProxy, 'exp', -3, 6, 0.05).name('Speed ×1');
  speedCtrl.onChange((v: number) => {
    time.timeScale = Math.pow(10, v);
    speedCtrl.name(`Speed ×${fmtScale(time.timeScale)}`);
  });
  // Multiply the speed by a factor (the ↑/↓ keys double / halve it); log-space, so
  // it tracks the slider and clamps to the same ×1/1000 … ×1,000,000 range.
  const speedBy = (factor: number): void => {
    speedCtrl.setValue(Math.min(6, Math.max(-3, speedProxy.exp + Math.log10(factor))));
  };
  tip(
    speedCtrl,
    'How fast time runs — from ×1/1000 (slow-motion) through ×1 (real-time) up to ' +
      '×1,000,000. Speeding up accelerates the orbits and smoothly averages the fine ' +
      'turbulence into a steady disk instead of strobing; slowing down resolves every detail.',
  );

  // The Galaxy-Mode dials — added flat (no sub-folder) right after the mode switch + Speed, shown
  // only while Galaxy mode is active (the registry hides them in Singularity). In Galaxy the whole
  // menu *is* the galaxy's settings, so these aren't behind Advanced — they're simply visible.
  const galaxyDials = createGalaxyDials(gui, setGalaxyDial, tip);

  // Click/tap the scene outside the panel to collapse it (a general pref, shown in both modes).
  // (CPU vs GPU physics is now chosen automatically by body count — see PhysicsController.autoSelect
  // — so there's no GPU toggle; the HUD's CPU/GPU readout shows which path the selector picked.)
  const tapOutsideCtrl = tip(
    gui.add(prefs, 'tapOutsideClose').name('Click outside closes'),
    'Clicking or tapping the scene outside this panel collapses it. On by default.',
  );

  // --- Advanced: dark sector (roadmap #12/#13), right after Speed ---
  // Sliders, not toggles: the strength is a continuous dial with a natural 0 = off, and easing it up
  // shows the effect *build* (the halo tightening orbits; Λ flinging the outer bodies) — a binary
  // switch couldn't convey that. Both are position-only radial forces (reversible; see integrators).
  const darkProxy = { matter: 0, energy: 0 };
  const applyDark = (): void => setDarkSector(darkProxy.matter, darkProxy.energy);
  const dmCtrl = tip(
    gui.add(darkProxy, 'matter', 0, 1, 0.01).name('Dark matter'),
    'Add a dark-matter halo around the system — an extra inward pull whose enclosed mass grows with ' +
      'radius, so the orbits tighten and the rotation curve flattens (outer bodies orbit as fast as ' +
      'inner ones) instead of falling off. 0 = off. A reversible, position-only force.',
  );
  dmCtrl.onChange(applyDark);
  const deCtrl = tip(
    gui.add(darkProxy, 'energy', 0, 1, 0.01).name('Dark energy'),
    'Add a cosmological-constant repulsion — an outward push that grows with distance. Past a ' +
      'turnaround radius it overwhelms gravity and flings the outer bodies away (cosmic expansion, ' +
      'in miniature). Exaggerated for visibility. 0 = off. A reversible, position-only force.',
  );
  deCtrl.onChange(applyDark);

  // --- Advanced: experimental Kerr spin (roadmap #10) ---
  // A real on/off toggle now: Off = 0 = byte-exact Schwarzschild; On = near-extremal a/M 0.99 — the
  // *most extreme* frame-drag, a bold D-shaped shadow + one-sided ring. Drives `bh.spin`; the
  // frame-drag term lives in the full shader (main.ts swaps it in when spin > 0). Sets the direction
  // toward the exact rotating metric (ergosphere / photon torus) — the deferred follow-up.
  const KERR_SPIN_ON = 0.99;
  const kerrProxy = { on: bh.spin.value > 0 };
  const kerrCtrl = tip(
    gui
      .add(kerrProxy, 'on')
      .name('Kerr spin')
      .onChange((v: boolean) => {
        bh.spin.value = v ? KERR_SPIN_ON : 0;
      }),
    'Spin the hole to a near-extremal a/M 0.99. A strong frame-dragging swirl drags light in the spin ' +
      'direction, so the shadow shifts into a bold D-shape and the photon ring brightens on one side. ' +
      'Off = Schwarzschild (no spin). A phenomenological look — the exact rotating metric (ergosphere, ' +
      'photon torus) is the follow-up.',
  );

  // --- Advanced: deep tuning folders ---
  const look = gui.addFolder('Look');
  tip(
    look.add(bh.emissiveStrength, 'value', 0, 2, 0.01).name('Disk brightness'),
    'Heat-glow intensity of the disk. Higher = brighter (more bloom); lower = a ' +
      'fainter, more ethereal disk dominated by the glow.',
  );
  tip(
    look.add(bh.diskDensity, 'value', 0, 3, 0.05).name('Density'),
    'How much gas is in the disk. Higher = thicker, more opaque, more contrast; ' +
      'lower = thin and wispy, more background showing through.',
  );
  tip(
    look.add(bh.diskTemp, 'value', 3000, 30000, 100).name('Temperature (K)'),
    'Peak blackbody temperature of the inner disk. Higher (≳10000K) = blue-white; ' +
      'lower (≈3000–6000K) = orange-red.',
  );
  tip(
    look.add(bh.scatterStrength, 'value', 0, 2, 0.05).name('Scattering'),
    'How much the dust catches and scatters the hot inner light. Higher = a softer, ' +
      'milkier glow through the gas; lower = pure heat emission.',
  );
  tip(
    look.add(bh.extinction, 'value', 0, 1, 0.01).name('Opacity (extinction)'),
    'How strongly the dust absorbs light passing through it (Beer–Lambert). Higher = ' +
      'darker, more solid overlaps; lower = translucent, light passes through.',
  );
  tip(
    look.add(renderer, 'toneMappingExposure', 0.1, 2, 0.05).name('Exposure'),
    'Overall brightness of the final image (camera exposure). Higher = brighter / ' +
      'more blown-out highlights; lower = darker, more detail in bright areas.',
  );
  tip(
    look.add(bh.doppler, 'value', { Off: 0, On: 1 }).name('Doppler beaming'),
    'Relativistic beaming: the side of the disk rotating toward you is brighter and ' +
      'bluer. ON = physically accurate (asymmetric); OFF = symmetric (Interstellar-style).',
  );
  tip(
    look.add(bh.redshift, 'value', { Off: 0, On: 1 }).name('Gravitational redshift'),
    'Light climbing out of the gravity well loses energy (redder, dimmer) near the ' +
      'hole. ON = accurate; OFF = no inward reddening.',
  );

  const anim = gui.addFolder('Animation');
  tip(
    anim.add(bh.rotationSpeed, 'value', 0, 20, 0.5).name('Rotation speed'),
    'How fast the disk visibly churns (multiplies the Keplerian rate). Higher = faster ' +
      'swirl; inner gas always outpaces outer either way.',
  );
  tip(
    anim.add(bh.turbAmount, 'value', 0, 2, 0.05).name('Turbulence'),
    'Strength of the turbulent filaments/gaps in the dust. Higher = more wispy, ' +
      'mottled structure; 0 = a smooth disk.',
  );
  tip(
    anim.add(bh.turbScale, 'value', 0.05, 1, 0.01).name('Turbulence scale'),
    'Spatial frequency of the turbulence. Higher = finer, smaller-scale detail; lower = ' +
      'large, soft billows.',
  );
  tip(
    anim.add(bh.infallRate, 'value', 0, 1, 0.01).name('Infall'),
    'How quickly dust spirals inward over time. Higher = faster inward drift; 0 = no ' +
      'net infall.',
  );
  tip(
    anim.add(bh.churnRate, 'value', 0, 1, 0.01).name('Churn'),
    'How fast the turbulence pattern evolves/morphs over time. Higher = more restless ' +
      'boiling; lower = a more frozen, slowly-shearing pattern.',
  );

  const post = gui.addFolder('Bloom');
  tip(
    post.add(bloom.strength, 'value', 0, 2, 0.02).name('Strength'),
    'Intensity of the HDR glow bleeding off bright areas. Higher = dreamier, more ' +
      'bloom; 0 = off (crisp).',
  );
  tip(
    post.add(bloom.radius, 'value', 0, 1, 0.02).name('Radius'),
    'How far the glow spreads. Higher = wider, softer halo; lower = tight glow.',
  );
  tip(
    post.add(bloom.threshold, 'value', 0, 2, 0.02).name('Threshold'),
    'Brightness above which things bloom. Higher = only the very brightest spots glow; ' +
      'lower = more of the image blooms.',
  );

  const quality = gui.addFolder('Quality');
  const qProxy = { tier: 'Auto' };
  tip(
    quality
      .add(qProxy, 'tier', ['Auto', 'Low', 'Medium', 'High'])
      .name('Quality')
      .onChange((v: string) => {
        applyQuality(v === 'Auto' ? autoTier : (v.toLowerCase() as QualityTier));
        gui.controllersRecursive().forEach((c) => c.updateDisplay());
      }),
    'Overall performance vs. fidelity. Auto picks a tier for your device on load; Low is ' +
      'lightest (best for phones), High is sharpest. It sets the starting resolution, the dust ' +
      'step, and the pixel-ratio cap — the controls below fine-tune them.',
  );
  tip(
    quality.add(scaler, 'enabled').name('Auto resolution'),
    'Automatically lower the render resolution to hold a smooth frame rate, then raise ' +
      'it when there is headroom. Off = always render at full resolution.',
  );
  const fpsCap = { cap: false };
  const targetFpsCtrl = tip(
    quality.add(scaler, 'targetFps', 24, 60, 1).name('Target FPS'),
    'The frame rate the app aims for. Auto-resolution trades sharpness to hold it; with "Cap ' +
      'frame rate" on it also becomes a hard cinematic cap. Lower (24–30) = a calmer, film-like feel ' +
      'with more GPU headroom (so it can stay at full resolution); 60 = the smoothest motion.',
  );
  const capCtrl = tip(
    quality.add(fpsCap, 'cap').name('Cap frame rate'),
    'Render at most "Target FPS" — a cinematic cap (try 24 or 30) that frees GPU headroom and ' +
      'stays consistent across devices. The achieved rate locks to the nearest display divisor (24 ' +
      'on a 120Hz screen, ~20 on 60Hz) to keep the pacing even. Off = render at the display rate.',
  );
  const applyCap = (): void => setMaxFps(fpsCap.cap ? scaler.targetFps : 0);
  targetFpsCtrl.onChange(applyCap);
  capCtrl.onChange(applyCap);
  tip(
    quality.add(scaler, 'minScale', 0.3, 1, 0.05).name('Min resolution'),
    'Lowest resolution auto-scaling may drop to. Lower = smoother but softer when busy; ' +
      'higher = always sharper but may drop frames.',
  );
  tip(
    quality.add(bh.volumeStep, 'value', 0.1, 0.6, 0.01).name('Volume step (perf)'),
    'Sampling step through the dust. Higher = faster but coarser/banded; lower = smoother ' +
      'volume but slower.',
  );

  // Background look: a few knobs that post-process whichever sky is selected.
  // Their values are also driven by the per-sky presets (see applyBgPreset).
  const bgFolder = gui.addFolder('Background');
  bgCtrls.push(
    tip(
      bgFolder.add(bgLook.brightness, 'value', 0, 2, 0.01).name('Brightness'),
      'Overall brightness of the selected background sky.',
    ),
    tip(
      bgFolder.add(bgLook.saturation, 'value', 0, 2, 0.01).name('Saturation'),
      'Colour intensity of the background. 0 = greyscale, 1 = as-authored, higher = punchier.',
    ),
    tip(
      bgFolder.add(bgLook.tint, 'value', -0.5, 0.5, 0.01).name('Tint (cool–warm)'),
      'Shift the background cooler (−, bluer) or warmer (+, redder).',
    ),
  );
  applyBgPreset(background.value); // seed the preset for the initial sky

  // Each tuning folder starts collapsed when Advanced is first shown.
  [look, anim, post, quality, bgFolder].forEach((f) => f.close());

  // --- Mode-aware visibility -----------------------------------------------------------------------
  // Every managed control carries two flags: `advanced` (behind the Advanced toggle) and `mode` (which
  // mode it belongs to). It shows only when BOTH gates pass — but the Advanced gate applies **only in
  // Singularity**: Galaxy mode has no Advanced folder, so every Galaxy-relevant control (the return
  // switch, Speed, the flat dials) is simply visible (see applyVisibility). So the Singularity-only
  // settings (Filter … Quality, Kerr, the regular dark sector) vanish in Galaxy mode, the Galaxy dials
  // vanish in Singularity, and the panel always reflects just the mode you're in. `advCtrl` is
  // Singularity-only (there's nothing to reveal in Galaxy); the Display HUD folder is always-on 'both'
  // and isn't registered.
  type Toggleable = { show(): unknown; hide(): unknown };
  const registry: Array<{
    ctrl: Toggleable;
    advanced: boolean;
    mode: 'singularity' | 'galaxy' | 'both';
  }> = [
    // Singularity-only, in the regular (non-Advanced) menu:
    { ctrl: filterCtrl, advanced: false, mode: 'singularity' },
    { ctrl: bgSkyCtrl, advanced: false, mode: 'singularity' },
    { ctrl: bodies, advanced: false, mode: 'singularity' },
    { ctrl: replayCtrl, advanced: false, mode: 'singularity' },
    { ctrl: pauseCtrl, advanced: false, mode: 'singularity' },
    { ctrl: stepFwdCtrl, advanced: false, mode: 'singularity' },
    { ctrl: stepBackCtrl, advanced: false, mode: 'singularity' },
    // The Advanced toggle itself — Singularity-only (Galaxy shows everything, so there's nothing to
    // gate there).
    { ctrl: advCtrl, advanced: false, mode: 'singularity' },
    // Both modes. In Singularity these sit behind Advanced; in Galaxy they're always visible.
    { ctrl: modeBtn, advanced: true, mode: 'both' },
    { ctrl: speedCtrl, advanced: true, mode: 'both' },
    { ctrl: tapOutsideCtrl, advanced: true, mode: 'both' },
    // Galaxy-only — flat dials, just visible in Galaxy (no Advanced gate there):
    ...galaxyDials.map((ctrl) => ({ ctrl, advanced: false, mode: 'galaxy' as const })),
    // Singularity-only, behind Advanced:
    { ctrl: dmCtrl, advanced: true, mode: 'singularity' },
    { ctrl: deCtrl, advanced: true, mode: 'singularity' },
    { ctrl: kerrCtrl, advanced: true, mode: 'singularity' },
    { ctrl: look, advanced: true, mode: 'singularity' },
    { ctrl: anim, advanced: true, mode: 'singularity' },
    { ctrl: post, advanced: true, mode: 'singularity' },
    { ctrl: quality, advanced: true, mode: 'singularity' },
    { ctrl: bgFolder, advanced: true, mode: 'singularity' },
  ];
  const applyVisibility = (): void => {
    const inGalaxy = isGalaxyMode();
    const cur = inGalaxy ? 'galaxy' : 'singularity';
    for (const e of registry) {
      const modeOk = e.mode === 'both' || e.mode === cur;
      // Advanced gating applies only in Singularity. In Galaxy there's no Advanced folder — every
      // mode-relevant control (the "Singularity mode" return switch, Speed, the flat Galaxy dials) is
      // just visible. This also keeps the return switch on screen with Advanced off (no strand).
      const advOk = inGalaxy || !e.advanced || prefs.advanced;
      if (modeOk && advOk) e.ctrl.show();
      else e.ctrl.hide();
    }
  };
  refreshModeUI = (): void => {
    applyVisibility();
    relabelMode();
  };
  refreshModeUI(); // initial state (Singularity, Advanced off)
  advCtrl.onChange(() => applyVisibility());
  tip(advCtrl, 'Reveal the mode switch and the deeper tuning folders. Remembered for next time.');

  // (No settings persistence — see the note by `prefs` above. A fresh open restores all defaults.)

  // Top row — About · Share — pinned above the folders; the panel starts collapsed.
  // (v0.96.0: the "Keys" popover and the version chip folded INTO the About card — shortcuts +
  // the event colour key live under the animated logo, and the title line is the app name +
  // version as one click-to-copy button. ? and Esc both route to About now.)
  const about = createAboutButton(VERSION);
  const topRow = document.createElement('div');
  topRow.className = 'osp-toprow';
  topRow.append(about.button, createShareButton());
  gui.$children.prepend(topRow);
  gui.close();
  // The panel is now mounted + visible (collapsed) → bring the scrub bar up with it. From here
  // the bar tracks the panel: hidden during a Replay (above), back on settle (formation.onDone).
  historyBar.setVisible(true);

  attachKeybindings({
    onEscape: () => about.toggle(),
    toggleShortcuts: about.toggle, // ? opens the same dialog — the shortcuts live in About now
    togglePause: () => onPauseClick(),
    toggleFps,
    stepForward: () => time.step(),
    stepBackward: () => time.stepBack(),
    replayIntro,
    speedBy,
  });

  // Long-press on a row shows its tooltip on touch devices (no native hover).
  attachTouchTooltips(gui.domElement);

  // Collapse the panel when the user clicks/taps the scene outside it (default on).
  document.addEventListener('pointerdown', (e) => {
    if (!prefs.tapOutsideClose) return;
    if (gui.domElement.contains(e.target as Node)) return;
    gui.close();
  });

  return gui;
}
