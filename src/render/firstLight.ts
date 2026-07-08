/**
 * First-light election (roadmap #1 — the cold-start compile freeze).
 *
 * The reveal can be shown on a **lean** raymarch variant (the four heaviest per-slot blocks omitted
 * at build time — see `createBlackHoleNode`'s `lean` option), which compiles far faster, so the
 * splash lifts to a *live* scene in a fraction of the cold-compile time. The **full** shader then
 * compiles off the critical path and swaps in **invisibly** — the lean variant is pixel-identical
 * for the whole intro, which never tears, merges, or lenses a companion hole (the seeded line-up is
 * stars + planets on stable orbits). Net: time-to-first-light drops from the full ~4 s cold compile
 * to the lean compile, and the heavy work happens while the user already has a running scene rather
 * than a frozen splash.
 *
 * **On by default (v0.71.0)** — the on-device numbers confirmed the win: Firefox `?firstlight=1`
 * measured `bootToLoop 4372 → 1800ms` cold (compile 1703→481, prime 2661→1311), then `316ms` warm,
 * with the reveal now smooth (janks 0, maxMs 22) once the resolution-ceiling ramp landed (v0.69.0)
 * and the lean→full swap moved off the reveal to first-need. It targets the **main** path (the one
 * Firefox is pinned to by the Gecko gate — so it reaches the browser that most needed it), and it
 * also makes the *default* Chrome load faster than the worker path (which pays spawn/transfer
 * overhead). `?firstlight=0` is the escape hatch. (The worker path always uses the lean head-start
 * regardless — see workerEngine.ts.)
 */
export const FIRST_LIGHT_DEFAULT = true;

/**
 * Elect the first-light path from the query string, pure + injectable for tests:
 *   `?firstlight=0` (or `off`/`false`) → force off (escape hatch)
 *   `?firstlight=1` (or `on`/`true`)   → force on
 *   (no param)                          → `def` (FIRST_LIGHT_DEFAULT)
 */
export function resolveFirstLight(search: string, def: boolean = FIRST_LIGHT_DEFAULT): boolean {
  const param = new URLSearchParams(search).get('firstlight');
  if (param === '0' || param === 'off' || param === 'false') return false;
  if (param === '1' || param === 'on' || param === 'true') return true;
  return def;
}
