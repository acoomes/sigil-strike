# SIGIL STRIKE

A wizard duel arcade game where you draw glyphs to cast spells.

**Play:** Open `index.html` in any modern browser, or serve the folder over HTTP.

## Quick Start

```bash
# From this directory
python3 -m http.server 8080
# Then open http://localhost:8080
```

Or just open `index.html` directly — no build step, no dependencies.

## Install and Offline Play

When served over HTTPS (including GitHub Pages), SIGIL STRIKE is an installable Progressive Web App. Use the browser's **Install app** or **Add to Home Screen** action after opening the site.

The first online visit caches the landing page, full game, manifest, icon, and local artwork. Later launches and gameplay work offline. Service workers require HTTP(S), so offline behavior is not available when opening the files directly with a `file://` URL.

## itch.io Release

Build a versioned HTML5 upload bundle from the standalone game:

```bash
python3 scripts/package-itch.py
```

The command validates the game entry point and its CSS/JavaScript assets, creates `dist/sigil-strike-<version>-itch.zip`, verifies the archive, and writes a matching SHA-256 checksum. The ZIP contains `index.html` at its root as required by itch.io, alongside `styles.css` and `game.js`. Set the release version in `VERSION`, or override it with `--version`.

For CI or a pre-release check that leaves no artifacts:

```bash
python3 scripts/package-itch.py --check
```

Builds are reproducible when `SOURCE_DATE_EPOCH` is fixed:

```bash
SOURCE_DATE_EPOCH=1767225600 python3 scripts/package-itch.py
```

## Continuous Integration

GitHub Actions runs an assertion-based browser gameplay regression check and validates the itch.io archive on every push and pull request. Run the packaging check locally with the command above. To run the browser check locally, install Puppeteer with `npm install --no-save --no-package-lock puppeteer`, then run `node scripts/gameplay-regression.js`.

## Controls

| Action | Input |
|--------|-------|
| Draw spell | Click + drag, release to cast |
| Block | Draw a circle while opponent is winding up |
| Restart | `R` key |

Active combat pauses automatically when the page loses visibility. Return to the game and select **Resume Combat** to continue without losing health, mana, or reaction time in the background.

## Accessibility and Audio

Open **Settings** from the main menu to adjust sound effect volume, mute audio, reduce motion, or enable a high-contrast palette. Reduced motion disables particles, screen shake, combat flashes, animated transitions, and projectile trails. Preferences are saved automatically in the current browser via `localStorage`.

## Glyphs (4 elements)

| Shape | Element | Effect |
|-------|---------|--------|
| ● Circle | 🔥 FIRE | Fast, 12 dmg, +50% crit |
| ▲ Triangle | ❄️ FROST | Slow, 14 dmg, slows next AI cast |
| ⚡ Zigzag | ⚡ LIGHTNING | Instant, 10 dmg, ignores 30% shield |
| ■ Square | 🌿 THORNS | Fast, 8 dmg, reflects 50% if blocked |

Elemental advantage: Fire → Frost → Lightning → Thorns → Fire (+5 bonus damage).

## Gameplay Loop

1. Click anywhere to begin (menu screen).
2. **Draw a glyph** on the canvas to cast a spell at the opponent.
3. Opponent attacks every ~2.5s — they show a colored warning ring for 700ms before firing.
4. **Draw a circle (shield glyph)** during the warning window to block 50% damage.
5. First to 0 HP loses. Click anywhere on the game-over screen to restart.

Survival runs are saved automatically to a persistent local top-10 leaderboard. Open **Top Survivors** from the main menu to view scores, waves reached, and run dates. Leaderboard data stays in the current browser via `localStorage`.

## Status

**v0.1 — Functional gameplay loop verified.** Player draws spells, AI casts back, blocking works, win/lose states cycle, score updates. See `CONCEPT.md` for the build roadmap and market research.

## Architecture

- **Small static modules** — semantic HTML, CSS, and vanilla JS + Canvas 2D with zero dependencies and zero build step.
- **Procedural visuals** — no external assets, no load time, instant play.
- **Mobile-ready controls** — touch events wired alongside mouse.
- **Cross-platform path** — same code can be packaged for Steam (Electron) or mobile (Capacitor/Cordova).

## Files

- `game/index.html` — game markup and browser entry point
- `game/styles.css` — game presentation and responsive styles
- `game/game.js` — gameplay state, input, rendering, audio, and persistence
- `index.html` — landing page with the embedded playable game
- `CONCEPT.md` — design rationale + market research
- `README.md` — this file
