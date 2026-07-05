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
 * Staged behind a flag while it's measured on-device — like the worker migration's `WORKER_DEFAULT`.
 * It targets the **main** path (the one Firefox is pinned to by the Gecko gate, so the browser that
 * most needs this can actually get it). Flip `FIRST_LIGHT_DEFAULT` once the on-device `osp.perf`
 * numbers (compile / prime / bootToLoop, and the new `fullCompile` mark) confirm the win and that the
 * background swap doesn't introduce its own visible hitch. `?firstlight=0/1` overrides the default.
 */
export const FIRST_LIGHT_DEFAULT = false;

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
