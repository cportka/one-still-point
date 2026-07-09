# Archive — historical docs & findings

This folder holds **point-in-time docs that have served their purpose** — perf audits, screen-recording
findings, and the OffscreenCanvas-worker migration log. The living docs stay one level up
(`handoff.md`, `future-improvements.md`, `intro-script.md`, `physical-script.md`); everything here is
kept for the *why*, not because it's still driving work. The actionable findings all shipped (see the
[CHANGELOG](../../CHANGELOG.md)) and the durable ones are baked into the code.

## Files in this archive

- [`offscreen-canvas.md`](offscreen-canvas.md) — the original OffscreenCanvas + Web-Worker render
  design (the "big swing" for the cold-start lag, since superseded by first light as problem #1's fix).
- [`offscreen-canvas-session.md`](offscreen-canvas-session.md) — the migration checklist / session log
  (steps 1–6, the staged `WORKER_DEFAULT` flip and its parity criteria).
- [`perf-frame-rate.md`](perf-frame-rate.md) — frame-rate / resolution-scaler perf notes.
- [`perf-recording-2026-07-01.md`](perf-recording-2026-07-01.md) ·
  [`-02`](perf-recording-2026-07-02.md) · [`-03`](perf-recording-2026-07-03.md) — the measured
  screen-recording investigations (the intro-lag / reveal-freeze diagnoses).

## Compressed digest (older per-version docs)

The below keeps the *conclusions* of even older files (`video-findings-v0.14.4/5.md`,
`perf-audit-v0.15.md`, `intro-description.md`) that were removed once their findings shipped.

## Physics / N-body (perf audit, v0.15 + v0.15.1)

- **The CPU integrator is the default, on purpose.** The GPU compute path forces a
  per-frame position+velocity **read-back** (a CPU↔GPU sync that stalls the
  pipeline). For this app's body counts (`MAX_BODIES = 14`) the velocity-Verlet CPU
  integrator is exact *and* faster, so **GPU physics stays a manual opt-in** — it's a
  scaling foundation for hundreds of bodies, not a win for a handful (revisit if a
  "swarm" mode raises the cap; see [future-improvements](../future-improvements.md)).
- Removed a per-frame allocation in `updateBodyUniforms`; reused the read-back
  `Vector3` temps. The raymarch worst-case bounds (`MAX_STEPS`, `volSamples` cap) are
  left as-is — most rays early-out, and lowering them risked photon-ring banding.

## Stability / scene (video findings, v0.14.4–v0.14.6)

- **All-black-screen blowup (fixed v0.14.5).** A non-finite body position propagated
  into the raymarch and blacked out the whole frame. Fixed with defensive guards so a
  non-finite body can never reach the uniforms; the integrator blowup itself is
  guarded at the source too.
- **"Adding a body dropped the count" (fixed v0.14.6).** A seeding/prune race.
- **Crowded multi-hole ejection is real physics, not a bug** — close encounters
  slingshot bodies out (verified against energy/momentum). The ± steppers de-bounce
  adds to avoid manufacturing those pile-ups by accident.
- **Camera ↔ gravity "wobble" is an input artifact**, not the simulation — the camera
  is OrbitControls + damping with no physical coupling. Noted as a possible *opt-in*
  feature (sample the lensing potential to nudge the camera) rather than a defect.

## Intro reality (v0.16.5 transcription)

Superseded by [`intro-script.md`](../intro-script.md) (the master beat table + tuning
log). The honest notes from that snapshot — mobile "splash never plays" (first-paint
gating), the black void at the splash→engine cut, and fresh-load shader-compile
stutter — all shipped (v0.17–0.17.1), and fresh-load smoothness improved again in
v0.20.2 by deferring the engine bundle under the splash.
