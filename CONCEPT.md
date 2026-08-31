# SIGIL STRIKE — Concept & Build Notes

**Created:** 2026-07-28 PDT  
**Status:** v0.1 — core gameplay loop functional

## Concept (one-liner)

A wizard duel where you **draw glyphs in real-time to cast spells**. Click-and-drag shapes to attack; defend with a shield glyph when AI fires.

## Why this concept (market research synthesis)

**Saturated (skip):** Cozy tavern (11+ sims), cozy farming/restaurant/cooking (100+ new in 2026), match-3, tower defense, vampire-survivors-likes, deck-builders.

**Open niches found:**
- Drawing-rune spell combat — only **Paper Strike** (itch.io demo, May 2026) and **Mega Circle** have it. No Steam dominant.
- Atmospheric insect/light stealth — no dominant moth/firefly game found.
- Mobile roguelikes with unique themes — active but uncrowded.

**Why drawing-rune won:**
1. Novel mechanic that works equally well in browser (mouse), mobile (finger), Steam (mouse+controller).
2. Action/arcade — outperforms puzzle/simulation per 2026 indie market data.
3. Quick sessions (1-3 min matches) → mobile hypercasual fit.
4. Atmospheric & visually distinctive (glowing rune trails, particles) → screenshot-worthy.
5. Fast to prototype (no procedural content needed; spell variety = glyph variety).

## Core gameplay loop

1. Player & AI face off across a 2D arena, both with HP (100) and Mana (regens 5/s).
2. Player **click-drags** a glyph shape → release to cast.
3. Glyph shape determines element → spell → damage.
4. AI casts on a timer (escalating speed per round).
5. Player must **draw a shield glyph** within reaction window to block incoming spell (50% damage).
6. First to 0 HP loses. Match ends → score (time survived, accuracy) → return to menu.

## Elements & glyphs (4 to start, expandable)

| Element   | Glyph shape | Damage | Speed | Special |
|-----------|-------------|--------|-------|---------|
| 🔥 Fire   | Circle      | 12     | Fast  | +50% crit |
| ❄️ Frost  | Triangle    | 14     | Slow  | Slows AI next cast 1s |
| ⚡ Lightning | Zigzag   | 10     | Instant | Ignores 30% shield |
| 🌿 Thorns | Square      | 8      | Fast  | Reflects 50% if blocked |

**Elemental advantage chain:** Fire > Frost > Lightning > Thorns > Fire (+5 bonus dmg on hit).

## Controls

- **Mouse / touch:** click-and-drag to draw, release to cast.
- **R:** restart match.
- **Esc:** back to menu.

## Visual / aesthetic

- Dark magical arena background (purple-black gradient + subtle magical particles).
- Glowing trail follows cursor while drawing (cyan→white→element color on cast).
- HP bar (red→green gradient), Mana bar (blue→cyan), both with smooth interpolation.
- Cast effects: particle burst per element, screen shake on big hits.
- Shield glyph: white circle around player when active.
- AI is on right side with subtle red glow; player on left with blue glow.

## Build plan

- **v0.1 (THIS):** Single HTML file, vanilla JS + Canvas 2D. Player can draw 4 glyphs, cast spells, AI fires back, basic HP/mana, game-over loop. ← **FUNCTIONAL LOOP TARGET**
- **v0.2:** Visual polish (particles, screen shake, glyph trail glow), sound effects (Web Audio synth).
- **v0.3:** Upgrades/menu system, survival mode, difficulty scaling.
- **v0.4:** More elements (6 total), combo system, leaderboard.
- **v0.5:** Mobile touch optimization, controller support (gamepad API), Steam assets.

## Technical choices

- **No framework** — vanilla JS keeps it portable (works in any browser, easy to package for Steam via Electron later, easy to wrap for mobile via Cordova/Capacitor).
- **Static modules** — `game/index.html`, `game/styles.css`, and `game/game.js` stay portable while keeping the now-1,900-line prototype maintainable.
- **Canvas 2D** — sufficient for the visual style, no WebGL needed.
- **No external assets** — all procedural (gradients, particles, text). Zero load time.

## Files

- `game/index.html` — main game markup
- `game/styles.css` — game styles
- `game/game.js` — gameplay and rendering logic
- `CONCEPT.md` — this file
- `README.md` — quick start
