/**
 * The music pool's play order (roadmap #11): an endless **random rotation** — every track plays
 * once per cycle (a shuffle), and across cycle seams the same track never plays twice in a row.
 * Pure over an injectable rng, so the whole contract is unit-testable.
 */

/** Fisher–Yates over [0, n), using the injected rng. */
function shuffled(n: number, rng: () => number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

/**
 * Returns a `next()` that walks shuffled cycles of `[0, n)` forever. Guarantees per cycle:
 * every index exactly once; across the seam: the new cycle never *starts* with the index the
 * previous one *ended* on (no back-to-back repeats — the audible sin of small pools). `n = 1`
 * legitimately repeats (there is only the one track); `n = 0` returns −1.
 */
export function createRotation(n: number, rng: () => number = Math.random): () => number {
  if (n <= 0) return () => -1;
  let order = shuffled(n, rng);
  let i = 0;
  return () => {
    if (i >= order.length) {
      const last = order[order.length - 1]!;
      let fresh = shuffled(n, rng);
      // Re-shuffle (or, deterministically worst-case, rotate) until the seam doesn't repeat.
      let guard = 8;
      while (n > 1 && fresh[0] === last && guard-- > 0) fresh = shuffled(n, rng);
      if (n > 1 && fresh[0] === last) fresh.push(fresh.shift()!);
      order = fresh;
      i = 0;
    }
    return order[i++]!;
  };
}
