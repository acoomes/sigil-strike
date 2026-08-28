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

## Controls

| Action | Input |
|--------|-------|
| Draw spell | Click + drag, release to cast |
| Block | Draw a circle while opponent is winding up |
| Restart | `R` key |

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

## Status

**v0.1 — Functional gameplay loop verified.** Player draws spells, AI casts back, blocking works, win/lose states cycle, score updates. See `CONCEPT.md` for the build roadmap and market research.

## Architecture

- **Single HTML file** — vanilla JS + Canvas 2D, zero dependencies, zero build step.
- **Procedural visuals** — no external assets, no load time, instant play.
- **Mobile-ready controls** — touch events wired alongside mouse.
- **Cross-platform path** — same code can be packaged for Steam (Electron) or mobile (Capacitor/Cordova).

## Files

- `index.html` — the game (open this to play)
- `CONCEPT.md` — design rationale + market research
- `README.md` — this file