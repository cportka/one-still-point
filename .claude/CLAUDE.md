<!-- BEGIN portka-standard (managed by repo-bootstrap — edit between the markers, or re-run to refresh) -->
# Portka standard workflow

Standing conventions for how Claude Code works here. Follow them for every change, without being
asked, so our back-and-forth stays on the code — not on process.

For each change you make:

1. **Update `main` first.** Begin by switching to `main` and pulling the latest. A previous
   change's branch being gone is the user's confirmation that they saw it (see step 5).
2. **Branch for everything.** Every fix, update, or change goes on a new branch — never commit to
   `main` directly.
3. **Tests + CI, then a PR.** Update the relevant tests, keep CI running them, and open a pull
   request. If the repo has no CI yet, add a basic workflow that runs the test suite.
4. **Green, then merge.** Wait until every check passes, then merge the PR automatically. Never
   merge on red.
5. **Hand back a short PR link.** Give the user a short link to the merged PR as confirmation. They
   delete the branch when satisfied — which you pick up next time you update `main` (step 1).

## Versioning — SemVer (enforced)

Versions follow [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH` — **MAJOR** for
breaking changes, **MINOR** for backward-compatible features, **PATCH** for backward-compatible
fixes. Every change bumps the right part. One source of truth, kept in agreement across three
places. **In this repo** the triplet is repo-native (package.json + the in-app version constant,
not a bare `VERSION` file):

- `package.json` `"version"` — the source of truth (a SemVer string).
- `src/version.ts` `VERSION` — mirrors it (shown in the UI).
- `CHANGELOG.md` — a `**MAJOR.MINOR.PATCH**` entry for each released version (newest first).

`npm test` (via `src/version.test.ts`) asserts `package.json` ↔ `src/version.ts` ↔ `CHANGELOG.md`
agree, and CI runs it on every push/PR, so they can't drift. This is the repo-native form of the
Portka standard's enforced `VERSION`/`CHANGELOG`/`README` sync.

## Commit identity (Portka standard 1.11.0)

Author/committer commits as **Chris Portka <chrisportka+github@gmail.com>** — set it before the
first commit of a session (`git config user.name "Chris Portka"; git config user.email
"chrisportka+github@gmail.com"`). Use that same identity for every commit so history stays
consistent, and keep the repo's `Co-Authored-By:` trailer.

In this hosted environment commit **signing** is unavailable (the signing key file is empty and the
signer is a stub), so commits land **unsigned** — that's expected: **don't force a signature.** And
**never rewrite already-merged history** to "fix" the authorship of **GitHub's own squash-merge
commit** (committer `noreply@github.com`, reachable from `origin/main`). After each merge the pinned
branch is reset onto `origin/main`, so its tip *is* that merge commit — the global
`~/.claude/stop-hook-git-check.sh` flags it as "Unverified" every time, and that is a **known false
positive**: take no action (amending would rewrite `main`'s published history). The hook lives
outside this repo (a harness-global), so it can't yet read this declaration — until it can, this
section is the authority (marketplace triage: claude-plugins#98).

## CI

- `ci.yml` — lint · typecheck · unit tests, on every PR + push to `main`.
- `validate-physics.yml` — the geodesic/disk/orbit/lensing **maths** validation, run **only when
  physics or shader-maths files change** (`src/physics/**`, `src/render/tsl/**`, `src/scene/**`,
  `scripts/validate-*.mjs`). UI/docs/CSS changes skip it.
<!-- END portka-standard -->

## Start here — current state & handoff

Read [`docs/handoff.md`](../docs/handoff.md) first: a short, living snapshot of where the project is
(what shipped recently, the one active problem, the in-flight OffscreenCanvas migration, open caveats
like Share needing a real-device check, and what's blocked/out-of-scope). Then
[`docs/future-improvements.md`](../docs/future-improvements.md) is the roadmap (top = next). **Keep
`docs/handoff.md` current at the end of a session** so the next one starts oriented.
