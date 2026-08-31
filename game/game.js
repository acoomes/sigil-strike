(() => {
  'use strict';

  // === Canvas setup ===
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // === Game state ===
  const STATE = { MENU: 'menu', PLAYING: 'playing', BETWEEN_WAVES: 'between_waves', PRACTICE: 'practice', GAME_OVER: 'game_over' };
  const MODE  = { CLASSIC: 'classic', SURVIVAL: 'survival', PRACTICE: 'practice' };
  const LEADERBOARD_KEY = 'sigil_strike_survival_leaderboard_v1';
  const PRACTICE_KEY = 'sigil_strike_practice_v1';
  const PREFERENCES_KEY = 'sigil_strike_preferences_v1';
  const SURVIVAL_CHECKPOINT_KEY = 'sigil_strike_survival_checkpoint_v1';
  const defaultPreferences = {
    audioEnabled: true,
    volume: 0.6,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    highContrast: window.matchMedia('(prefers-contrast: more)').matches,
  };

  function loadPracticeProgress() {
    try { return JSON.parse(localStorage.getItem(PRACTICE_KEY) || '{}'); }
    catch { return {}; }
  }

  function savePracticeProgress(progress) {
    try { localStorage.setItem(PRACTICE_KEY, JSON.stringify(progress)); } catch {}
  }

  function loadPreferences() {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}');
      return {
        audioEnabled: typeof saved.audioEnabled === 'boolean' ? saved.audioEnabled : defaultPreferences.audioEnabled,
        volume: Number.isFinite(saved.volume) ? Math.max(0, Math.min(1, saved.volume)) : defaultPreferences.volume,
        reducedMotion: typeof saved.reducedMotion === 'boolean' ? saved.reducedMotion : defaultPreferences.reducedMotion,
        highContrast: typeof saved.highContrast === 'boolean' ? saved.highContrast : defaultPreferences.highContrast,
      };
    } catch {
      return { ...defaultPreferences };
    }
  }

  const preferences = loadPreferences();

  function savePreferences() {
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); } catch {}
  }

  function setToggle(id, enabled) {
    const button = document.getElementById(id);
    button.setAttribute('aria-pressed', String(enabled));
    button.textContent = enabled ? 'ON' : 'OFF';
  }

  function applyPreferences() {
    document.documentElement.classList.toggle('reduced-motion', preferences.reducedMotion);
    document.documentElement.classList.toggle('high-contrast', preferences.highContrast);
    setToggle('setting-audio', preferences.audioEnabled);
    setToggle('setting-motion', preferences.reducedMotion);
    setToggle('setting-contrast', preferences.highContrast);
    const volume = document.getElementById('setting-volume');
    volume.value = String(Math.round(preferences.volume * 100));
    volume.disabled = !preferences.audioEnabled;
    document.getElementById('setting-volume-value').textContent = `${volume.value}%`;
    if (preferences.reducedMotion) {
      game.particles = [];
      game.arenaFlash = 0;
      game.ai.shake = 0;
    }
  }

  function loadLeaderboard() {
    try {
      const saved = JSON.parse(localStorage.getItem(LEADERBOARD_KEY) || '[]');
      return Array.isArray(saved) ? saved.filter(entry =>
        Number.isFinite(entry.score) && Number.isFinite(entry.wave) && Number.isFinite(entry.time)
      ).slice(0, 10) : [];
    } catch {
      return [];
    }
  }

  function saveSurvivalScore() {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      score: game.score,
      wave: game.wave,
      time: Number(game.timeAlive.toFixed(1)),
      date: new Date().toISOString(),
    };
    const scores = [...loadLeaderboard(), entry]
      .sort((a, b) => b.score - a.score || b.wave - a.wave || b.time - a.time)
      .slice(0, 10);
    try { localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(scores)); } catch {}
    return { entry, rank: scores.findIndex(score => score.id === entry.id) + 1 };
  }

  function renderLeaderboard(highlightId = null) {
    const list = document.getElementById('leaderboard-list');
    const scores = loadLeaderboard();
    if (!scores.length) {
      list.innerHTML = '<div class="leaderboard-empty">No survival runs yet.<br>Enter the arena and claim first place.</div>';
      return;
    }
    list.innerHTML = `
      <div class="leaderboard-row header"><span>RANK</span><span>SCORE</span><span>WAVE</span><span>DATE</span></div>
      ${scores.map((entry, index) => `
        <div class="leaderboard-row${entry.id === highlightId ? ' new-score' : ''}">
          <span class="leaderboard-rank">#${index + 1}</span>
          <span class="leaderboard-score">${entry.score}</span>
          <span>${entry.wave}</span>
          <span>${new Date(entry.date).toLocaleDateString()}</span>
        </div>
      `).join('')}
    `;
  }

  // Upgrade definitions
  const UPGRADES = {
    maxHp:   { name: 'VITALITY',      desc: '+20 max HP',                   maxLevel: 5, baseCost: 15, icon: '❤' },
    manaRegen: { name: 'ARCANE FLOW',  desc: '+3 mana per second',           maxLevel: 5, baseCost: 20, icon: '✦' },
    spellDmg:  { name: 'POWER SURGE',  desc: '+15% spell damage',            maxLevel: 5, baseCost: 25, icon: '⚡' },
    shieldDur: { name: 'FORTIFY',      desc: '+0.5s shield duration',       maxLevel: 4, baseCost: 18, icon: '◯' },
    startMana: { name: 'RESERVOIR',    desc: '+15 starting mana',            maxLevel: 4, baseCost: 15, icon: '◈' },
    armor:     { name: 'ARMOR',        desc: '-10% damage taken',             maxLevel: 4, baseCost: 30, icon: '◈' },
  };

  function makeUpgrades() {
    return { maxHp: 0, manaRegen: 0, spellDmg: 0, shieldDur: 0, startMana: 0, armor: 0 };
  }

  function isValidSurvivalCheckpoint(checkpoint) {
    if (!checkpoint || checkpoint.version !== 1 || typeof checkpoint.savedAt !== 'string') return false;
    if (!Number.isInteger(checkpoint.wave) || checkpoint.wave < 1 || checkpoint.wave > 10000) return false;
    if (!Number.isInteger(checkpoint.lives) || checkpoint.lives < 0 || checkpoint.lives > 99) return false;
    if (!Number.isFinite(checkpoint.gold) || checkpoint.gold < 0 || checkpoint.gold > 1000000000) return false;
    if (!Number.isFinite(checkpoint.score) || checkpoint.score < 0 || checkpoint.score > 1000000000000) return false;
    if (!Number.isFinite(checkpoint.timeAlive) || checkpoint.timeAlive < 0 || checkpoint.timeAlive > 31536000) return false;
    if (!checkpoint.upgrades || typeof checkpoint.upgrades !== 'object') return false;
    return Object.entries(UPGRADES).every(([key, definition]) =>
      Number.isInteger(checkpoint.upgrades[key]) && checkpoint.upgrades[key] >= 0 && checkpoint.upgrades[key] <= definition.maxLevel
    );
  }

  function clearSurvivalCheckpoint() {
    try { localStorage.removeItem(SURVIVAL_CHECKPOINT_KEY); } catch {}
  }

  function loadSurvivalCheckpoint() {
    try {
      const checkpoint = JSON.parse(localStorage.getItem(SURVIVAL_CHECKPOINT_KEY) || 'null');
      if (isValidSurvivalCheckpoint(checkpoint)) return checkpoint;
      clearSurvivalCheckpoint();
    } catch {
      clearSurvivalCheckpoint();
    }
    return null;
  }

  function saveSurvivalCheckpoint() {
    if (game.mode !== MODE.SURVIVAL || game.wave < 1) return;
    const checkpoint = {
      version: 1,
      savedAt: new Date().toISOString(),
      wave: game.wave,
      lives: game.lives,
      gold: game.gold,
      upgrades: { ...game.upgrades },
      score: game.score,
      timeAlive: game.timeAlive,
    };
    try { localStorage.setItem(SURVIVAL_CHECKPOINT_KEY, JSON.stringify(checkpoint)); } catch {}
  }

  function showSurvivalRecovery(checkpoint) {
    const recovery = document.getElementById('survival-recovery-screen');
    document.getElementById('survival-recovery-summary').textContent =
      `WAVE ${checkpoint.wave} CLEARED · ${checkpoint.lives} LIVES · ◆ ${checkpoint.gold}`;
    recovery.classList.remove('hidden');
    recovery.setAttribute('aria-hidden', 'false');
  }

  function hideSurvivalRecovery() {
    const recovery = document.getElementById('survival-recovery-screen');
    recovery.classList.add('hidden');
    recovery.setAttribute('aria-hidden', 'true');
  }

  function resumeSurvivalCheckpoint(checkpoint) {
    game.mode = MODE.SURVIVAL;
    game.state = STATE.BETWEEN_WAVES;
    game.wave = checkpoint.wave;
    game.lives = checkpoint.lives;
    game.gold = checkpoint.gold;
    game.upgrades = { ...checkpoint.upgrades };
    game.score = checkpoint.score;
    game.timeAlive = checkpoint.timeAlive;
    const stats = getPlayerStats(game.upgrades);
    game.player.hpMax = stats.hpMax;
    game.player.hp = stats.hpMax;
    game.player.manaMax = 100;
    game.player.mana = stats.startMana;
    game.projectiles = [];
    game.particles = [];
    game.ai.casting = null;
    hideSurvivalRecovery();
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('wave-display').style.opacity = '1';
    document.getElementById('score').style.display = 'block';
    showWaveClearScreen(game.wave, 0, 0, false);
    updateHUD();
  }

  function getUpgradeCost(key, level) {
    return Math.floor(UPGRADES[key].baseCost * Math.pow(1.6, level));
  }

  // Computed stats from upgrades
  function getPlayerStats(ups) {
    return {
      hpMax:     100 + ups.maxHp * 20,
      manaRegen: 6   + ups.manaRegen * 3,
      spellDmg:  1   + ups.spellDmg * 0.15,
      shieldDur: 1.5 + ups.shieldDur * 0.5,
      startMana: 50  + ups.startMana * 15,
      armor:     ups.armor * 0.10,
    };
  }

  let game = null;
  let comboDisplayTimer = 0;
  let visibilityPaused = false;

  // === Gamepad state ===
  let gpState = null;
  let gpCursorX = 0, gpCursorY = 0;
  let gpLastBtnState = {};
  let gpMenuIndex = 0;
  let gpActiveGlyph = null;
  let gpDrawPath = [];
  let gpDrawTrail = [];
  let gpCooldown = {};

  function gpCD(btn, ms) {
    if (typeof gpCooldown[btn] === 'undefined') return true;
    if (Date.now() - gpCooldown[btn] >= ms) { gpCooldown[btn] = Date.now(); return true; }
    return false;
  }

  window.addEventListener('gamepadconnected', e => { if (!gpState) { gpCursorX = W/2; gpCursorY = H/2; } });
  window.addEventListener('gamepaddisconnected', e => {});

  function pollGamepad() {
    if (visibilityPaused) return;
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const g of gamepads) { if (g && g.connected) { gp = g; break; } }
    if (!gp) return;

    const DEAD_STICK = 0.15;
    const lx = Math.abs(gp.axes[0]) > DEAD_STICK ? gp.axes[0] : 0;
    const ly = Math.abs(gp.axes[1]) > DEAD_STICK ? gp.axes[1] : 0;
    const SPEED = 420 * (16/1000);
    gpCursorX = Math.max(0, Math.min(W, gpCursorX + lx * SPEED));
    gpCursorY = Math.max(0, Math.min(H, gpCursorY + ly * SPEED));

    const buttons = gp.buttons.map((b,i) => ({ pressed: b.pressed, value: b.value, index: i }));
    const isPressed = (idx) => buttons[idx] && buttons[idx].pressed;
    const wasPressed = (idx) => gpLastBtnState[idx] === true;
    const justPressed = (idx) => isPressed(idx) && !wasPressed(idx);
    buttons.forEach((b,i) => { gpLastBtnState[i] = b.pressed; });

    // Menu navigation
    if (game.state === STATE.MENU) {
      const menuIds = ['btn-classic','btn-survival','btn-leaderboard'];
      if (justPressed(12) && gpCD('mu', 180)) { gpMenuIndex = (gpMenuIndex - 1 + 3) % 3; highlightMenuBtn(gpMenuIndex); }
      if (justPressed(13) && gpCD('md', 180)) { gpMenuIndex = (gpMenuIndex + 1) % 3; highlightMenuBtn(gpMenuIndex); }
      if ((justPressed(0) || justPressed(7)) && gpCD('ms', 300)) { document.getElementById(menuIds[gpMenuIndex])?.click(); }
      return;
    }

    // Leaderboard screen
    if (!document.getElementById('leaderboard-screen').classList.contains('hidden')) {
      if (justPressed(0) || justPressed(1) || justPressed(7)) document.getElementById('btn-close-leaderboard')?.click();
      return;
    }

    // Upgrade screen
    if (!document.getElementById('upgrade-screen').classList.contains('hidden')) {
      const cards = [...document.querySelectorAll('.upgrade-card:not(.maxed):not(.locked)')];
      if (justPressed(12) && gpCD('uu', 180)) {
        const cur = document.querySelector('.upgrade-card.gp-sel');
        const idx = cur ? cards.indexOf(cur) : -1;
        const next = idx <= 0 ? cards.length - 1 : idx - 1;
        cards.forEach((c,i) => c.classList.toggle('gp-sel', i === next));
      }
      if (justPressed(13) && gpCD('ud', 180)) {
        const cur = document.querySelector('.upgrade-card.gp-sel');
        const idx = cur ? cards.indexOf(cur) : -1;
        const next = idx >= cards.length - 1 ? 0 : idx + 1;
        cards.forEach((c,i) => c.classList.toggle('gp-sel', i === next));
      }
      if ((justPressed(0) || justPressed(7)) && gpCD('ub', 300)) { document.querySelector('.upgrade-card.gp-sel')?.click(); }
      if (justPressed(1) || justPressed(3)) document.getElementById('btn-continue')?.click();
      return;
    }

    // Wave clear screen
    if (!document.getElementById('waveclear-screen').classList.contains('hidden')) {
      if (justPressed(0) || justPressed(7)) document.getElementById('btn-next-wave')?.click();
      if (justPressed(1) || justPressed(3)) document.getElementById('btn-to-upgrades')?.click();
      return;
    }

    // Game over screen
    if (!document.getElementById('gameover-screen').classList.contains('hidden')) {
      if (justPressed(0) || justPressed(7)) {
        const r = document.getElementById('btn-retry-survival');
        if (r && r.style.display !== 'none') r.click();
        else document.getElementById('btn-menu-from-go')?.click();
      }
      if (justPressed(1) || justPressed(3)) document.getElementById('btn-menu-from-go')?.click();
      return;
    }

    // In-game
    if (game.state === STATE.PLAYING) {
      const drawMode = isPressed(4) || isPressed(6); // LB or LT

      if (drawMode) {
        gpDrawTrail.push({ x: gpCursorX, y: gpCursorY, life: 0.5 });
        if (gpDrawTrail.length > 30) gpDrawTrail.shift();
        if (!gpState?.drawMode) { gpDrawPath = [{ x: gpCursorX, y: gpCursorY }]; gpActiveGlyph = null; }
        const last = gpDrawPath[gpDrawPath.length - 1];
        if (Math.hypot(gpCursorX - last.x, gpCursorY - last.y) > 6) {
          gpDrawPath.push({ x: gpCursorX, y: gpCursorY });
          if (gpDrawPath.length > 200) gpDrawPath.shift();
        }
        const classified = classifyGlyph(gpDrawPath);
        if (classified) gpActiveGlyph = classified;
      } else {
        if (gpState?.drawMode && gpDrawPath.length >= 4) {
          const glyph = classifyGlyph(gpDrawPath);
          if (glyph) {
            const isShield = glyph === 'circle';
            if (isShield && game.ai.casting && game.ai.casting.warning > 0) {
              const stats = getPlayerStats(game.upgrades);
              game.player.shieldTimer = stats.shieldDur;
              game.ai.casting.warning = 0;
              burst(game.player.x, game.player.y, '#fff', 24, 200);
              showToast('SHIELDED', '#fff', 500);
              playSound('shield');
            } else {
              const element = SHAPE_TO_ELEMENT[glyph];
              if (element) playerCast(element);
            }
          } else if (gpDrawPath.length >= 4) {
            showToast('UNKNOWN GLYPH', '#888', 500);
          }
          gpDrawPath = [];
          gpActiveGlyph = null;
        }
        gpDrawTrail = [];
      }

      if (!drawMode) {
        if (justPressed(2) && gpCD('qf', 400)) playerCast('fire');
        if (justPressed(3) && gpCD('qg', 400)) playerCast('frost');
        if (justPressed(7) && gpCD('gs', 400)) {
          if (game.ai.casting && game.ai.casting.warning > 0) {
            const stats = getPlayerStats(game.upgrades);
            game.player.shieldTimer = stats.shieldDur;
            game.ai.casting.warning = 0;
            burst(game.player.x, game.player.y, '#fff', 24, 200);
            showToast('SHIELDED', '#fff', 500);
            playSound('shield');
          }
        }
        if (justPressed(14) && gpCD('ql', 400)) playerCast('lightning');
        if (justPressed(15) && gpCD('qt', 400)) playerCast('thorns');
      }

      if (justPressed(9) && gpCD('gp', 500)) document.getElementById('btn-menu-from-go')?.click();
    }

    if (!gpState) gpState = {};
    gpState.drawMode = drawMode;
  }

  function highlightMenuBtn(idx) {
    ['btn-classic','btn-survival','btn-leaderboard'].forEach((id, i) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.style.outline = i === idx ? '3px solid #5fd4ff' : 'none';
      btn.style.boxShadow = i === idx ? '0 0 20px rgba(95,212,255,0.4)' : 'none';
    });
  }

  function updateGpTrail(dt) {
    for (let i = gpDrawTrail.length - 1; i >= 0; i--) {
      gpDrawTrail[i].life -= dt;
      if (gpDrawTrail[i].life <= 0) gpDrawTrail.splice(i, 1);
    }
  }

  function createGame(mode) {
    return {
      mode,
      state: STATE.MENU,
      player: { hp: 100, hpMax: 100, mana: 50, manaMax: 100, x: 0, y: 0, shieldTimer: 0, hitFlash: 0 },
      ai:     { hp: 100, hpMax: 100, x: 0, y: 0, castTimer: 0, castInterval: 2.5, casting: null, hitFlash: 0, shake: 0 },
      projectiles: [],
      particles: [],
      drawing: false,
      drawPath: [],
      drawStart: 0,
      score: 0,
      timeAlive: 0,
      lastCastTime: 0,
      arenaFlash: 0,
      bgStars: [],
      comboDisplay: 0,
      aiArcaneDebuff: 0,
      // Survival-specific
      wave: 0,
      lives: 3,
      gold: 0,
      upgrades: makeUpgrades(),
      waveEnemyHp: 100,
      waveEnemiesDefeated: 0,
      waveStartTime: 0,
    };
  }

  // === Element definitions ===
  const ELEMENTS = {
    fire:      { name: 'FIRE',      color: '#ff7a3a', glyph: 'circle',    damage: 12, cost: 10, speed: 700,  trait: 'crit' },
    frost:     { name: 'FROST',     color: '#6ad8ff', glyph: 'triangle',  damage: 14, cost: 12, speed: 500,  trait: 'slow' },
    lightning: { name: 'LIGHTNING', color: '#ffe14a', glyph: 'zigzag',    damage: 10, cost: 14, speed: 1100, trait: 'pierce' },
    thorns:    { name: 'THORNS',    color: '#7aff8a', glyph: 'square',    damage: 8,  cost: 8,  speed: 800,  trait: 'reflect' },
    arcane:    { name: 'ARCANE',    color: '#c86aff', glyph: 'pentagon',  damage: 16, cost: 16, speed: 900,  trait: 'amplify' },
    nature:    { name: 'NATURE',    color: '#4dffb8', glyph: 'teardrop',  damage: 10, cost: 10, speed: 750,  trait: 'lifesteal' },
  };

  // Practice: element order for glyph training
  const PRACTICE_GLYPH_ORDER = ['circle','triangle','zigzag','square','pentagon','teardrop'];

  // Practice state
  let practicePhase = 'intro';
  let practiceGlyphIdx = 0;
  let practiceGlyph = null;
  let practiceShieldCount = 0;
  let practiceShieldGoal = 5;
  let practiceCombatWins = 0;
  let practiceCombatGoal = 3;
  let practiceGlyphFeedback = null;
  let practiceFeedbackTimer = 0;
  let practiceRoundTimer = 0;
  let practiceRoundActive = false;
  let practicePromptGlyph = null;
  let practiceAiCasting = null;
  let practiceAiCastTimer = 0;
  let practiceAiInterval = 3.5;
  let practiceProjectiles = [];
  let practiceAiHp = 100;
  let practicePlayerHp = 100;
  let practicePlayerMp = 100;
  let practiceCombo = 1;
  let practiceLastCast = null;
  let practiceAiArcaneDebuff = 0;
  let practiceComplete = false;
  // Elemental advantage: Fire>Frost>Lightning>Thorns>Nature>Fire; Arcane is neutral (beats all, hit by nothing)
  const ADV = { fire: 'frost', frost: 'lightning', lightning: 'thorns', thorns: 'nature', nature: 'fire', arcane: null };
  const SHAPE_TO_ELEMENT = {
    circle:   'fire',
    triangle: 'frost',
    zigzag:   'lightning',
    square:   'thorns',
    pentagon: 'arcane',
    teardrop: 'nature',
  };

  // === Background stars ===
  game = createGame(MODE.CLASSIC);
  for (let i = 0; i < 60; i++) {
    game.bgStars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.2 + 0.3, tw: Math.random() * Math.PI * 2 });
  }

  // === Arena positions ===
  function placeArena() {
    if (!game) return;
    game.player.x = W * 0.22;
    game.player.y = H * 0.5;
    game.ai.x     = W * 0.78;
    game.ai.y     = H * 0.5;
  }
  placeArena();
  window.addEventListener('resize', placeArena);

  // === Glyph recognition ===
  function simplifyPath(points, tolerance = 12) {
    if (points.length < 3) return points;
    const out = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const last = out[out.length - 1];
      if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= tolerance) out.push(points[i]);
    }
    const tail = points[points.length - 1];
    if (Math.hypot(tail.x - out[out.length - 1].x, tail.y - out[out.length - 1].y) >= tolerance) out.push(tail);
    return out;
  }

  function classifyGlyph(rawPoints) {
    const points = simplifyPath(rawPoints, 12);
    if (!points || points.length < 4) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const w = maxX - minX, h = maxY - minY;
    const diag = Math.hypot(w, h);
    if (diag < 30) return null;
    let pathLen = 0;
    for (let i = 1; i < points.length; i++) pathLen += Math.hypot(points[i].x - points[i-1].x, points[i].y - points[i-1].y);
    if (pathLen < 60) return null;
    const start = points[0], end = points[points.length - 1];
    const closed = Math.hypot(end.x - start.x, end.y - start.y) < diag * 0.45;
    const aspect = w / Math.max(h, 1);
    const dirs = [];
    for (let i = 2; i < points.length; i++) {
      const v1x = points[i-1].x - points[i-2].x, v1y = points[i-1].y - points[i-2].y;
      const v2x = points[i].x - points[i-1].x,   v2y = points[i].y - points[i-1].y;
      let diff = Math.atan2(v2y, v2x) - Math.atan2(v1y, v1x);
      while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
      dirs.push(diff);
    }
    let sideChanges = 0, prevSide = 0;
    for (const d of dirs) { const s = Math.sign(d); if (s !== 0 && prevSide !== 0 && s !== prevSide) sideChanges++; if (s !== 0) prevSide = s; }
    let corners = 0; for (const d of dirs) if (Math.abs(d) > 0.8) corners++;
    const straightness = pathLen / Math.max(diag, 1);
    const startEnd = Math.hypot(end.x - start.x, end.y - start.y);
    const teardropScore = closed * Math.max(0, 1 - straightness / 3.5) * Math.max(0, 1 - aspect * 0.4) * Math.max(0, Math.min(1, startEnd / diag * 2));
    const pentagonScore = closed * (corners >= 4 && corners <= 6 ? 1 : 0.2) * Math.max(0, 1 - Math.abs(aspect - 1) * 0.6) * Math.max(0, 1 - Math.abs(straightness - 3.5) * 0.2);
    const scores = {
      circle:   closed * Math.max(0, 1 - corners / 5) * Math.max(0, 1 - Math.abs(aspect - 1) * 0.4) * Math.min(1, straightness / 2.0),
      triangle: closed * (corners >= 2 && corners <= 4 ? 1 : 0.3) * Math.max(0, 1 - Math.abs(aspect - 1) * 0.5) * Math.max(0, 1 - (straightness - 2.0) * 0.3),
      square:   closed * (corners >= 3 && corners <= 5 ? 1 : 0.3) * Math.max(0, 1 - Math.abs(aspect - 1) * 0.5) * Math.max(0, 1 - (straightness - 2.5) * 0.3),
      zigzag:   (closed ? 0.15 : 0.85) * (sideChanges >= 3 ? 1 : 0.4) * Math.max(0.3, 1 - Math.max(0, straightness - 5) * 0.1),
      teardrop: teardropScore,
      pentagon: pentagonScore,
    };
    let best = null, bestScore = 0.30;
    for (const k in scores) { if (scores[k] > bestScore) { bestScore = scores[k]; best = k; } }
    return best;
  }

  // === Audio ===
  let audioCtx = null;
  function initAudio() {
    if (!preferences.audioEnabled) return;
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }
  function playSound(type) {
    if (!preferences.audioEnabled || preferences.volume <= 0 || !audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    if (type === 'cast') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, t);
      osc.frequency.exponentialRampToValueAtTime(1200, t + 0.15);
      gain.gain.setValueAtTime(0.15 * preferences.volume, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
      osc.start(t); osc.stop(t + 0.15);
    } else if (type === 'hit') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.2);
      gain.gain.setValueAtTime(0.2 * preferences.volume, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
      osc.start(t); osc.stop(t + 0.2);
    } else if (type === 'shield') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(400, t);
      osc.frequency.linearRampToValueAtTime(800, t + 0.2);
      gain.gain.setValueAtTime(0.1 * preferences.volume, t);
      gain.gain.linearRampToValueAtTime(0.01, t + 0.2);
      osc.start(t); osc.stop(t + 0.2);
    } else if (type === 'waveclear') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, t);
      osc.frequency.setValueAtTime(600, t + 0.1);
      osc.frequency.setValueAtTime(800, t + 0.2);
      gain.gain.setValueAtTime(0.2 * preferences.volume, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
      osc.start(t); osc.stop(t + 0.4);
    }
  }

  // === Particles ===
  function burst(x, y, color, count = 20, speed = 200) {
    if (preferences.reducedMotion) return;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.6);
      game.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.6 + Math.random() * 0.4, maxLife: 1.0, color, size: 2 + Math.random() * 3 });
    }
  }

  function showToast(text, color = '#fff', duration = 1200) {
    const t = document.getElementById('toast');
    t.textContent = text; t.style.color = color; t.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => t.classList.remove('show'), duration);
  }

  // === Projectiles ===
  function spawnProjectile(fromX, fromY, toX, toY, element, fromAI = false, speed = 600, comboMultiplier = 1) {
    const dx = toX - fromX, dy = toY - fromY;
    const dist = Math.hypot(dx, dy);
    game.projectiles.push({ x: fromX, y: fromY, vx: (dx/dist)*speed, vy: (dy/dist)*speed, element, color: ELEMENTS[element].color, fromAI, life: 3.0, size: 8 + Math.random()*4, trail: [], comboMultiplier });
  }

  // === Get wave AI parameters ===
  function getWaveParams(wave) {
    const baseHp     = 100 + (wave - 1) * 25;
    const baseInterval = Math.max(1.0, 2.5 - (wave - 1) * 0.15);
    const aiSpeed    = 0.85 + (wave - 1) * 0.04;
    const enemiesToDefeat = Math.min(1 + Math.floor((wave - 1) / 2), 5);
    return { baseHp, baseInterval, aiSpeed, enemiesToDefeat };
  }

  // === Game start/restart ===
  function startGame(mode) {
    setVisibilityPaused(false);
    game.state = STATE.PLAYING;
    game.mode   = mode;

    const stats = getPlayerStats(game.upgrades);
    game.player.hpMax = stats.hpMax;
    game.player.manaMax = 100;
    game.player.hp   = stats.hpMax;
    game.player.mana = stats.startMana;
    game.player.shieldTimer = 0;
    game.player.hitFlash = 0;
    game.ai.hp = mode === MODE.SURVIVAL ? getWaveParams(game.wave || 1).baseHp : 100;
    game.ai.hpMax = game.ai.hp;
    game.ai.castTimer = mode === MODE.SURVIVAL ? 2.0 : 2.0;
    game.ai.castInterval = mode === MODE.SURVIVAL ? getWaveParams(game.wave || 1).baseInterval : 2.5;
    game.ai.casting = null;
    game.ai.hitFlash = 0;
    game.ai.shake = 0;
    game.projectiles = [];
    game.particles = [];
    game.score = 0;
    game.timeAlive = 0;
    game.arenaFlash = 0;
    game.lastCastTime = 0;
    if (mode === MODE.SURVIVAL) {
      game.waveStartTime = performance.now();
    }
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('upgrade-screen').classList.add('hidden');
    document.getElementById('waveclear-screen').classList.add('hidden');
    document.getElementById('gameover-screen').classList.add('hidden');
    document.getElementById('wave-display').style.opacity = mode === MODE.SURVIVAL ? '1' : '0';
    document.getElementById('score').style.display = 'block';

    if (mode === MODE.SURVIVAL && game.wave === 0) {
      game.wave = 1;
      game.lives = 3;
      game.gold  = 0;
      game.upgrades = makeUpgrades();
      showWaveBanner(game.wave);
    }
    updateHUD();
  }

  function startWave(waveNum) {
    game.wave = waveNum;
    const { baseHp, baseInterval, aiSpeed } = getWaveParams(waveNum);
    game.ai.hp = baseHp;
    game.ai.hpMax = baseHp;
    game.ai.castInterval = baseInterval;
    game.ai.castTimer = 2.0;
    game.ai.casting = null;
    game.ai.hitFlash = 0;
    game.ai.shake = 0;
    game.projectiles = [];
    game.particles = [];
    game.waveStartTime = performance.now();
    game.waveEnemiesDefeated = 0;
    showWaveBanner(waveNum);
    updateHUD();
  }

  function showWaveBanner(wave) {
    const b = document.getElementById('wave-banner');
    document.getElementById('wave-num-text').textContent = `WAVE ${wave}`;
    document.getElementById('wave-sub-text').textContent = getWaveParams(wave).enemiesToDefeat > 1
      ? `${getWaveParams(wave).enemiesToDefeat} OPPONENTS`
      : 'SURVIVE THE ONSLAUGHT';
    b.classList.add('show');
    setTimeout(() => b.classList.remove('show'), 2000);
  }

  // === Player cast ===
  function playerCast(elementKey) {
    if (visibilityPaused || game.state !== STATE.PLAYING) return;
    const el = ELEMENTS[elementKey];
    const stats = getPlayerStats(game.upgrades);
    if (game.player.mana < el.cost) { showToast('NO MANA', '#888', 600); return; }
    game.player.mana -= el.cost;

    // Combo: same element = stacking bonus; different resets
    if (elementKey === lastPlayerCast) {
      playerCombo++;
    } else {
      playerCombo = 1;
    }
    lastPlayerCast = elementKey;
    game.playerLastElement = elementKey;
    const comboMultiplier = 1 + (playerCombo - 1) * 0.25;
    comboDisplayTimer = 1.5;
    game.comboDisplay = playerCombo;

    const targetX = game.ai.x + (Math.random() - 0.5) * 60;
    const targetY = game.ai.y + (Math.random() - 0.5) * 80;
    spawnProjectile(game.player.x, game.player.y, targetX, targetY, elementKey, false, el.speed, comboMultiplier);
    burst(game.player.x, game.player.y, el.color, 12 + playerCombo * 4, 150 + playerCombo * 30);
    game.lastCastTime = performance.now();
    playSound('cast');
  }

  // === AI cast ===
  function aiCast() {
    if (visibilityPaused || game.state !== STATE.PLAYING) return;
    const keys = Object.keys(ELEMENTS);
    const avoidElement = game.playerLastElement || null;
    let pool = keys.filter(k => k !== avoidElement);
    if (pool.length === 0) pool = keys;
    const elementKey = pool[Math.floor(Math.random() * pool.length)];
    const el = ELEMENTS[elementKey];
    const targetX = game.player.x + (Math.random() - 0.5) * 40;
    const targetY = game.player.y + (Math.random() - 0.5) * 60;
    const { aiSpeed } = getWaveParams(game.wave);
    spawnProjectile(game.ai.x, game.ai.y, targetX, targetY, elementKey, true, el.speed * aiSpeed);
    game.ai.casting = { element: elementKey, color: el.color, warning: 0.7 };
    burst(game.ai.x, game.ai.y, el.color, 8, 100);
    playSound('cast');
  }

  // === Hit resolution ===
  function onPlayerHit(proj) {
    const stats = getPlayerStats(game.upgrades);
    const el = ELEMENTS[proj.element];
    let dmg = el.damage;
    if (proj.element === 'lightning' && game.player.shieldTimer > 0) dmg = Math.round(dmg * 0.7);
    dmg = Math.round(dmg * (1 - stats.armor));
    game.player.hp -= dmg;
    game.player.hitFlash = 0.3;
    game.ai.hitFlash = 0.15;
    burst(game.player.x, game.player.y, el.color, 18, 220);
    burst(game.player.x, game.player.y, '#ff4a6a', 8, 300);
    showToast(`-${dmg}`, proj.color, 600);
    playSound('hit');
    if (game.player.hp <= 0) {
      game.player.hp = 0;
      if (game.mode === MODE.SURVIVAL) {
        game.lives--;
        if (game.lives <= 0) endGame(false);
        else {
          // Brief pause then respawn
          const stats2 = getPlayerStats(game.upgrades);
          game.player.hp = stats2.hpMax;
          game.player.mana = stats2.startMana;
          game.projectiles = [];
          showToast(`LIVES: ${game.lives}`, '#ff4a6a', 1000);
        }
      } else {
        endGame(false);
      }
    }
  }

  function onAIHit(proj) {
    const stats = getPlayerStats(game.upgrades);
    const el = ELEMENTS[proj.element];
    const comboMult = proj.comboMultiplier || 1;
    let dmg = Math.round(el.damage * stats.spellDmg * comboMult);
    if (ADV[proj.element] === game.aiLastElement) dmg += 5;
    if (Math.random() < 0.15 && proj.element === 'fire') dmg = Math.round(dmg * 1.5);

    // Nature: lifesteal (heal 30% of damage dealt)
    if (proj.element === 'nature') {
      const heal = Math.round(dmg * 0.3);
      game.player.hp = Math.min(stats.hpMax, game.player.hp + heal);
      burst(game.player.x, game.player.y, '#4dffb8', 12, 120);
    }

    // Arcane: stacking damage-over-time debuff on AI
    if (proj.element === 'arcane') {
      game.aiArcaneDebuff = (game.aiArcaneDebuff || 0) + 0.25;
    }

    game.ai.hp -= dmg;
    game.ai.hitFlash = 0.4;
    game.player.hitFlash = 0.1;
    burst(proj.x, proj.y, el.color, 22 + Math.round((comboMult - 1) * 20), 240);
    burst(proj.x, proj.y, '#fff', 6, 350);
    const comboText = comboMult > 1 ? ` x${comboMult.toFixed(2)}` : '';
    showToast(`-${dmg}${comboText}`, proj.color, 600);
    playSound('hit');
    game.score += Math.round(dmg * 10);

    if (game.ai.hp <= 0) {
      game.ai.hp = 0;
      if (game.mode === MODE.SURVIVAL) {
        game.waveEnemiesDefeated++;
        const { enemiesToDefeat } = getWaveParams(game.wave);
        const waveTime = (performance.now() - game.waveStartTime) / 1000;
        if (game.waveEnemiesDefeated >= enemiesToDefeat) {
          // Wave clear
          const goldEarned = 10 + game.wave * 5;
          game.gold += goldEarned;
          playSound('waveclear');
          showWaveClearScreen(game.wave, goldEarned, waveTime);
        } else {
          // Spawn next enemy in wave
          const { baseHp, baseInterval } = getWaveParams(game.wave);
          setTimeout(() => {
            if (game.state !== STATE.PLAYING) return;
            game.ai.hp = baseHp;
            game.ai.hpMax = baseHp;
            game.ai.castInterval = baseInterval;
            game.ai.castTimer = 1.5;
            game.ai.casting = null;
            game.ai.hitFlash = 0;
            game.projectiles = [];
            showToast(`OPPONENT ${game.waveEnemiesDefeated + 1}/${enemiesToDefeat}`, '#ff5a7a', 1000);
            updateHUD();
          }, 1200);
        }
      } else {
        endGame(true);
      }
    }
  }

  function endGame(won) {
    game.state = STATE.GAME_OVER;
    if (game.mode === MODE.SURVIVAL) {
      clearSurvivalCheckpoint();
      showSurvivalGameOver(won);
    } else {
      showClassicGameOver(won);
    }
  }

  function showClassicGameOver(won) {
    const go = document.getElementById('gameover-screen');
    document.getElementById('leaderboard-result')?.remove();
    document.getElementById('go-title').textContent = won ? 'VICTORY' : 'DEFEAT';
    document.getElementById('go-title').style.color = won ? '#7aff8a' : 'var(--ai)';
    document.getElementById('go-stats').innerHTML = `
      <div class="stat-box"><div class="val">${game.score}</div><div class="lbl">SCORE</div></div>
      <div class="stat-box"><div class="val">${game.timeAlive.toFixed(1)}s</div><div class="lbl">TIME</div></div>
    `;
    go.classList.remove('hidden');
    document.getElementById('btn-retry-survival').style.display = 'none';
    document.getElementById('btn-menu-from-go').onclick = () => { go.classList.add('hidden'); document.getElementById('menu-screen').classList.remove('hidden'); };
  }

  function showSurvivalGameOver(won) {
    const leaderboardResult = saveSurvivalScore();
    const go = document.getElementById('gameover-screen');
    document.getElementById('leaderboard-result')?.remove();
    document.getElementById('go-title').textContent = 'DEFEAT';
    document.getElementById('go-title').style.color = 'var(--ai)';
    document.getElementById('go-stats').innerHTML = `
      <div class="stat-box"><div class="val">${game.wave}</div><div class="lbl">WAVES SURVIVED</div></div>
      <div class="stat-box"><div class="val">${game.score}</div><div class="lbl">SCORE</div></div>
      <div class="stat-box"><div class="val">◆ ${game.gold}</div><div class="lbl">GOLD EARNED</div></div>
      <div class="stat-box"><div class="val">${game.timeAlive.toFixed(1)}s</div><div class="lbl">TIME ALIVE</div></div>
    `;
    if (leaderboardResult.rank) {
      document.getElementById('go-stats').insertAdjacentHTML('afterend', `<div class="leaderboard-result" id="leaderboard-result">NEW LOCAL RANK: #${leaderboardResult.rank}</div>`);
    } else {
      document.getElementById('leaderboard-result')?.remove();
    }
    go.classList.remove('hidden');
    document.getElementById('btn-retry-survival').style.display = 'block';
    document.getElementById('btn-retry-survival').onclick = () => { go.classList.add('hidden'); game.wave = 0; startGame(MODE.SURVIVAL); };
    document.getElementById('btn-menu-from-go').onclick = () => { go.classList.add('hidden'); document.getElementById('menu-screen').classList.remove('hidden'); };
  }

  function showWaveClearScreen(wave, goldEarned, waveTime, persist = true) {
    game.state = STATE.BETWEEN_WAVES;
    game.projectiles = [];
    game.ai.casting = null;
    const wc = document.getElementById('waveclear-screen');
    document.getElementById('wc-wave').textContent = wave;
    document.getElementById('wc-gold-earned').textContent = `+${goldEarned} GOLD`;
    document.getElementById('wc-time').textContent = `Time: ${waveTime.toFixed(1)}s`;
    wc.classList.remove('hidden');
    if (persist) saveSurvivalCheckpoint();
  }

  // === Upgrade screen ===
  function showUpgradeScreen() {
    const us = document.getElementById('upgrade-screen');
    document.getElementById('upgrade-gold').textContent = `◆ ${game.gold}`;
    document.getElementById('upgrade-wave-info').textContent = `WAVE ${game.wave} COMPLETE`;
    renderUpgradeGrid();
    us.classList.remove('hidden');
  }

  function renderUpgradeGrid() {
    const grid = document.getElementById('upgrade-grid');
    grid.innerHTML = '';
    const stats = getPlayerStats(game.upgrades);
    for (const [key, def] of Object.entries(UPGRADES)) {
      const level = game.upgrades[key];
      const cost = getUpgradeCost(key, level);
      const maxed = level >= def.maxLevel;
      const canAfford = game.gold >= cost;
      const locked = false;
      const card = document.createElement('div');
      card.className = 'upgrade-card' + (maxed ? ' maxed' : (!canAfford && !locked ? ' locked' : ''));
      // Level bar
      let barPct = (level / def.maxLevel) * 100;
      let currentVal = '';
      if (key === 'maxHp')    currentVal = `${stats.hpMax} HP`;
      if (key === 'manaRegen') currentVal = `${stats.manaRegen.toFixed(1)}/s`;
      if (key === 'spellDmg') currentVal = `+${Math.round((stats.spellDmg-1)*100)}%`;
      if (key === 'shieldDur')currentVal = `${stats.shieldDur.toFixed(1)}s`;
      if (key === 'startMana')currentVal = `${stats.startMana} mana`;
      if (key === 'armor')    currentVal = `-${Math.round(stats.armor*100)}%`;
      card.innerHTML = `
        <div class="u-name">${def.icon} ${def.name}</div>
        <div class="u-desc">${def.desc} — currently ${currentVal}</div>
        <div class="u-meta">
          <span class="u-cost">${maxed ? 'MAXED' : `◆ ${cost}`}</span>
          <span class="u-level">LV ${level}/${def.maxLevel}</span>
        </div>
        <div class="u-bar"><div class="u-bar-fill" style="width:${barPct}%"></div></div>
      `;
      if (!maxed && canAfford) {
        card.onclick = () => purchaseUpgrade(key, cost);
      }
      grid.appendChild(card);
    }
  }

  function purchaseUpgrade(key, cost) {
    game.gold -= cost;
    game.upgrades[key]++;
    renderUpgradeGrid();
    document.getElementById('upgrade-gold').textContent = `◆ ${game.gold}`;
    // Update player stats immediately for next wave
    const stats = getPlayerStats(game.upgrades);
    game.player.hpMax = stats.hpMax;
    game.player.manaMax = 100;
    saveSurvivalCheckpoint();
  }

  // === Input ===
  let activePointerId = null;
  function onDown(e) {
    e.preventDefault();
    if (visibilityPaused) return;
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch(err) {}
    initAudio();
    if (game.state === STATE.MENU) return;
    if (game.state !== STATE.PLAYING) return;
    game.drawing = true;
    game.drawPath = [{ x: e.clientX, y: e.clientY }];
    game.drawStart = performance.now();
  }
  function onMove(e) {
    e.preventDefault();
    if (!game.drawing || e.pointerId !== activePointerId) return;
    const p = { x: e.clientX, y: e.clientY };
    const last = game.drawPath[game.drawPath.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) > 3) {
      game.drawPath.push(p);
      if (game.drawPath.length > 80) game.drawPath.shift();
    }
  }
  function onUp(e) {
    e.preventDefault();
    if (!game.drawing || e.pointerId !== activePointerId) return;
    activePointerId = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch(err) {}
    game.drawing = false;
    const path = game.drawPath;
    game.drawPath = [];
    if (path.length < 4) return;
    const glyph = classifyGlyph(path);
    if (!glyph) {
      showToast('UNKNOWN GLYPH', '#888', 500);
      burst((path[0].x+path[path.length-1].x)/2, (path[0].y+path[path.length-1].y)/2, '#888', 8, 80);
      return;
    }
    // Shield: only circle is a shield glyph. Other closed shapes always cast their element.
    const isShield = glyph === 'circle';
    if (isShield && game.ai.casting && game.ai.casting.warning > 0) {
      const stats = getPlayerStats(game.upgrades);
      game.player.shieldTimer = stats.shieldDur;
      game.ai.casting.warning = 0;
      burst(game.player.x, game.player.y, '#fff', 24, 200);
      showToast('SHIELDED', '#fff', 500);
      playSound('shield');
      return;
    }
    const element = SHAPE_TO_ELEMENT[glyph];
    if (!element) { showToast('UNKNOWN GLYPH', '#888', 500); return; }
    playerCast(element);
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  window.addEventListener('keydown', e => {
    if (visibilityPaused) return;
    if (e.key === 'r' || e.key === 'R') {
      if (game.state !== STATE.MENU) {
        if (game.mode === MODE.SURVIVAL && game.state === STATE.PLAYING) startWave(game.wave);
        else startGame(game.mode);
      }
    }
  });

  // === Menu buttons ===
  document.getElementById('btn-classic').onclick = () => { game.mode = MODE.CLASSIC; game.wave = 0; startGame(MODE.CLASSIC); };
  document.getElementById('btn-survival').onclick = () => { clearSurvivalCheckpoint(); game.mode = MODE.SURVIVAL; game.wave = 0; startGame(MODE.SURVIVAL); };
  document.getElementById('btn-practice').onclick = () => { startPractice(); };
  document.getElementById('btn-leaderboard').onclick = () => {
    renderLeaderboard();
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('leaderboard-screen').classList.remove('hidden');
  };
  document.getElementById('btn-settings').onclick = () => {
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('settings-screen').classList.remove('hidden');
  };
  document.getElementById('btn-close-settings').onclick = () => {
    document.getElementById('settings-screen').classList.add('hidden');
    document.getElementById('menu-screen').classList.remove('hidden');
  };
  document.getElementById('setting-audio').onclick = () => {
    preferences.audioEnabled = !preferences.audioEnabled;
    savePreferences();
    applyPreferences();
    if (preferences.audioEnabled) initAudio();
  };
  document.getElementById('setting-volume').oninput = event => {
    preferences.volume = Number(event.target.value) / 100;
    savePreferences();
    applyPreferences();
  };
  document.getElementById('setting-motion').onclick = () => {
    preferences.reducedMotion = !preferences.reducedMotion;
    savePreferences();
    applyPreferences();
  };
  document.getElementById('setting-contrast').onclick = () => {
    preferences.highContrast = !preferences.highContrast;
    savePreferences();
    applyPreferences();
  };
  document.getElementById('btn-close-leaderboard').onclick = () => {
    document.getElementById('leaderboard-screen').classList.add('hidden');
    document.getElementById('menu-screen').classList.remove('hidden');
  };
  document.getElementById('btn-continue').onclick = () => {
    document.getElementById('upgrade-screen').classList.add('hidden');
    game.state = STATE.PLAYING;
    game.wave++;
    startWave(game.wave);
  };
  document.getElementById('btn-to-upgrades').onclick = () => {
    document.getElementById('waveclear-screen').classList.add('hidden');
    showUpgradeScreen();
  };
  document.getElementById('btn-next-wave').onclick = () => {
    document.getElementById('waveclear-screen').classList.add('hidden');
    game.wave++;
    startWave(game.wave);
    game.state = STATE.PLAYING;
  };
  const recoverableSurvivalRun = loadSurvivalCheckpoint();
  if (recoverableSurvivalRun) showSurvivalRecovery(recoverableSurvivalRun);
  document.getElementById('btn-resume-survival').onclick = () => {
    const checkpoint = loadSurvivalCheckpoint();
    if (checkpoint) resumeSurvivalCheckpoint(checkpoint);
    else hideSurvivalRecovery();
  };
  document.getElementById('btn-discard-survival').onclick = () => {
    clearSurvivalCheckpoint();
    hideSurvivalRecovery();
  };
  document.getElementById('btn-exit-practice').onclick = () => {
    exitPractice();
  };

  function setVisibilityPaused(paused) {
    visibilityPaused = paused && game.state === STATE.PLAYING;
    const pauseScreen = document.getElementById('visibility-pause-screen');
    pauseScreen.classList.toggle('hidden', !visibilityPaused);
    pauseScreen.setAttribute('aria-hidden', String(!visibilityPaused));
    if (visibilityPaused) {
      game.drawing = false;
      game.drawPath = [];
      if (activePointerId !== null) {
        try { canvas.releasePointerCapture(activePointerId); } catch {}
        activePointerId = null;
      }
      if (audioCtx?.state === 'running') audioCtx.suspend().catch(() => {});
    } else {
      lastT = performance.now();
      if (preferences.audioEnabled && audioCtx?.state === 'suspended') audioCtx.resume().catch(() => {});
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === STATE.PLAYING) setVisibilityPaused(true);
  });

  document.getElementById('btn-resume-visibility').onclick = () => {
    if (!document.hidden) setVisibilityPaused(false);
  };

  // === Update ===
  let lastT = performance.now();
  function update(now) {
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;

    if (visibilityPaused) return;

    pollGamepad();
    updateGpTrail(dt);

    if (game.state === STATE.PLAYING) {
      game.timeAlive += dt;
      const stats = getPlayerStats(game.upgrades);
      game.player.mana = Math.min(100, game.player.mana + stats.manaRegen * dt);
      game.player.shieldTimer = Math.max(0, game.player.shieldTimer - dt);
      game.player.hitFlash = Math.max(0, game.player.hitFlash - dt * 2);
      game.ai.hitFlash = Math.max(0, game.ai.hitFlash - dt * 2);
      game.ai.shake = Math.max(0, game.ai.shake - dt);
      game.arenaFlash = Math.max(0, game.arenaFlash - dt * 2);
      comboDisplayTimer = Math.max(0, comboDisplayTimer - dt);
      if (game.aiArcaneDebuff > 0) game.aiArcaneDebuff = Math.max(0, game.aiArcaneDebuff - dt * 0.08);
      const arcaneDmg = game.aiArcaneDebuff > 0 ? Math.round(game.ai.hp * game.aiArcaneDebuff * dt * 0.05) : 0;
      if (arcaneDmg > 0) {
        game.ai.hp = Math.max(0, game.ai.hp - arcaneDmg);
        game.ai.hitFlash = Math.max(game.ai.hitFlash, 0.05);
      }

      // AI cast
      game.ai.castTimer -= dt;
      if (game.ai.castTimer <= 0 && !game.ai.casting) {
        aiCast();
        game.ai.castTimer = Math.max(1.0, game.ai.castInterval - game.timeAlive * 0.01);
      }
      if (game.ai.casting) {
        game.ai.casting.warning -= dt;
        if (game.ai.casting.warning <= 0) {
          game.ai.casting = null;
          game.ai.castTimer = Math.max(1.0, game.ai.castInterval);
        }
      }

      // Projectiles
      for (let i = game.projectiles.length - 1; i >= 0; i--) {
        const p = game.projectiles[i];
        p.life -= dt;
        p.trail.push({ x: p.x, y: p.y, life: 0.3 });
        if (p.trail.length > 12) p.trail.shift();
        for (const t of p.trail) t.life -= dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        const targetX = p.fromAI ? game.player.x : game.ai.x;
        const targetY = p.fromAI ? game.player.y : game.ai.y;
        if (Math.hypot(p.x - targetX, p.y - targetY) < 28) {
          if (p.fromAI) onPlayerHit(p);
          else onAIHit(p);
          game.projectiles.splice(i, 1);
          continue;
        }
        if (p.life <= 0 || p.x < -50 || p.x > W+50 || p.y < -50 || p.y > H+50) {
          game.projectiles.splice(i, 1);
        }
      }
      for (const p of game.projectiles) {
        if (p.fromAI && p.life > 2.5) game.aiLastElement = p.element;
      }
    }

    // Particles always update
    for (let i = game.particles.length - 1; i >= 0; i--) {
      const p = game.particles[i];
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.96; p.vy *= 0.96;
      if (p.life <= 0) game.particles.splice(i, 1);
    }

    updateHUD();
  }

  function updateHUD() {
    if (!game) return;
    const stats = getPlayerStats(game.upgrades);
    const hpPct = Math.max(0, game.player.hp / (stats.hpMax > 0 ? stats.hpMax : 100)) * 100;
    const mpPct = Math.max(0, game.player.mana / 100) * 100;
    const aiHpPct = game.ai.hpMax > 0 ? Math.max(0, game.ai.hp / game.ai.hpMax) * 100 : 0;
    document.getElementById('player-hp').style.width = hpPct + '%';
    document.getElementById('player-mp').style.width = mpPct + '%';
    document.getElementById('ai-hp').style.width = aiHpPct + '%';
    document.getElementById('score-val').textContent = game.score;
    const comboEl = document.getElementById('combo-display');
    if (comboDisplayTimer > 0 && game.comboDisplay > 1) {
      comboEl.style.opacity = '1';
      document.getElementById('combo-val').textContent = game.comboDisplay;
    } else {
      comboEl.style.opacity = '0';
    }
    if (game.mode === MODE.SURVIVAL) {
      document.getElementById('wave-display').textContent =
        `WAVE ${game.wave}  ·  LIVES ${'♥'.repeat(Math.max(0,game.lives))}  ·  ◆ ${game.gold}`;
    }
  }

  // === Render ===
  function render() {
    const grad = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W, H));
    grad.addColorStop(0, '#1a0a3a'); grad.addColorStop(1, '#07041a');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

    const t = performance.now() / 1000;
    for (const s of game.bgStars) {
      const alpha = preferences.reducedMotion ? 0.65 : 0.4 + 0.3 * Math.sin(t + s.tw);
      ctx.fillStyle = `rgba(180,180,255,${alpha})`;
      ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r * DPR, 0, Math.PI * 2); ctx.fill();
    }

    ctx.strokeStyle = 'rgba(95,212,255,0.15)'; ctx.lineWidth = 1 * DPR;
    ctx.beginPath(); ctx.moveTo(W*0.1, H*0.5); ctx.lineTo(W*0.9, H*0.5); ctx.stroke();

    if (game.state === STATE.MENU) return;

    if (!preferences.reducedMotion && game.arenaFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${game.arenaFlash * 0.05})`;
      ctx.fillRect(0, 0, W, H);
    }

    drawWizard(game.player.x, game.player.y, '#5fd4ff', game.player.hitFlash, game.player.shieldTimer > 0);
    const aiShakeX = preferences.reducedMotion ? 0 : (Math.random()-0.5) * game.ai.shake * 8;
    const aiShakeY = preferences.reducedMotion ? 0 : (Math.random()-0.5) * game.ai.shake * 8;
    drawWizard(game.ai.x + aiShakeX, game.ai.y + aiShakeY, '#ff5a7a', game.ai.hitFlash);

    // AI casting warning
    if (game.ai.casting) {
      const c = game.ai.casting;
      const intensity = 1 - c.warning / 0.7;
      ctx.strokeStyle = c.color; ctx.globalAlpha = 0.4 + intensity * 0.5;
      ctx.lineWidth = 3 * DPR;
      ctx.beginPath(); ctx.arc(game.ai.x, game.ai.y, 32 + intensity * 10, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = c.color; ctx.globalAlpha = intensity * 0.3;
      ctx.lineWidth = 2 * DPR;
      ctx.beginPath(); ctx.moveTo(game.ai.x, game.ai.y); ctx.lineTo(game.player.x, game.player.y); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.color;
      ctx.font = `bold ${14 * DPR}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(`INCOMING: ${ELEMENTS[c.element].name}`, W/2, H * 0.25);
    }

    // Projectiles
    ctx.globalCompositeOperation = 'screen';
    for (const p of game.projectiles) {
      for (let i = 0; !preferences.reducedMotion && i < p.trail.length; i++) {
        const t2 = p.trail[i];
        if (t2.life <= 0) continue;
        ctx.fillStyle = p.color; ctx.globalAlpha = t2.life / 0.3 * 0.5;
        ctx.beginPath(); ctx.arc(t2.x, t2.y, p.size * 0.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 12 * DPR;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Particles
    for (const p of game.particles) {
      ctx.strokeStyle = p.color; ctx.globalAlpha = p.life / p.maxLife;
      ctx.lineWidth = p.size * DPR; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;

    // Drawing path
    if (game.drawing && game.drawPath.length > 1) {
      ctx.strokeStyle = '#5fd4ff'; ctx.shadowColor = '#5fd4ff'; ctx.shadowBlur = 10 * DPR;
      ctx.lineWidth = 3 * DPR; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(game.drawPath[0].x, game.drawPath[0].y);
      for (let i = 1; i < game.drawPath.length; i++) ctx.lineTo(game.drawPath[i].x, game.drawPath[i].y);
      ctx.stroke(); ctx.shadowBlur = 0;
      const last = game.drawPath[game.drawPath.length - 1];
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(last.x, last.y, 4 * DPR, 0, Math.PI * 2); ctx.fill();
    }

    // === Gamepad cursor and drawing ===
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let hasGp = false;
    for (const g of gamepads) { if (g && g.connected) { hasGp = true; break; } }

    if (hasGp) {
      // Draw trail (while holding LB)
      for (let i = 0; i < gpDrawTrail.length; i++) {
        const pt = gpDrawTrail[i];
        ctx.fillStyle = '#5fd4ff'; ctx.globalAlpha = pt.life / 0.5 * 0.6;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 3 * DPR, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Draw path being built with gamepad
      if (gpState?.drawMode && gpDrawPath.length > 1) {
        const element = gpActiveGlyph ? SHAPE_TO_ELEMENT[gpActiveGlyph] : null;
        const color = element ? ELEMENTS[element].color : '#5fd4ff';
        ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 10 * DPR;
        ctx.lineWidth = 3 * DPR; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(gpDrawPath[0].x, gpDrawPath[0].y);
        for (let i = 1; i < gpDrawPath.length; i++) ctx.lineTo(gpDrawPath[i].x, gpDrawPath[i].y);
        ctx.stroke(); ctx.shadowBlur = 0;
        const lastPt = gpDrawPath[gpDrawPath.length - 1];
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(lastPt.x, lastPt.y, 4 * DPR, 0, Math.PI * 2); ctx.fill();
        if (gpActiveGlyph) {
          const el = ELEMENTS[SHAPE_TO_ELEMENT[gpActiveGlyph]];
          ctx.font = `bold ${14 * DPR}px sans-serif`; ctx.textAlign = 'center';
          ctx.fillStyle = el.color; ctx.shadowColor = el.color; ctx.shadowBlur = 10;
          ctx.fillText(el.name, gpCursorX, gpCursorY - 30 * DPR);
          ctx.shadowBlur = 0;
        }
      }

      // Gamepad cursor
      ctx.strokeStyle = '#5fd4ff'; ctx.lineWidth = 2 * DPR;
      ctx.shadowColor = '#5fd4ff'; ctx.shadowBlur = 8 * DPR;
      ctx.beginPath(); ctx.arc(gpCursorX, gpCursorY, 14 * DPR, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gpCursorX - 20 * DPR, gpCursorY); ctx.lineTo(gpCursorX + 20 * DPR, gpCursorY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gpCursorX, gpCursorY - 20 * DPR); ctx.lineTo(gpCursorX, gpCursorY + 20 * DPR); ctx.stroke();
      ctx.shadowBlur = 0;

      // Draw mode indicator
      if (gpState?.drawMode) {
        ctx.fillStyle = 'rgba(95,212,255,0.15)'; ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.arc(gpCursorX, gpCursorY, 22 * DPR, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.font = `bold ${11 * DPR}px sans-serif`; ctx.textAlign = 'center';
        ctx.fillStyle = '#5fd4ff';
        ctx.fillText('LB: DRAW', gpCursorX, gpCursorY + 28 * DPR);
      }
    }
  }

  function drawWizard(x, y, color, flash = 0, shielded = false) {
    ctx.save(); ctx.translate(x, y);
    if (flash > 0) { ctx.shadowColor = '#fff'; ctx.shadowBlur = 30 * DPR * flash; }
    else { ctx.shadowColor = color; ctx.shadowBlur = 18 * DPR; }
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, 22 * DPR, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.arc(0, 0, 8 * DPR, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    if (shielded) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3 * DPR; ctx.shadowColor = '#fff'; ctx.shadowBlur = 12 * DPR;
      ctx.beginPath(); ctx.arc(0, 0, 34 * DPR, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  // === Main loop ===
  function frame(now) {
    update(now);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => {});
    });
  }

  // Init HUD
  document.getElementById('player-hp').style.width = '100%';
  document.getElementById('ai-hp').style.width = '100%';
  document.getElementById('wave-display').style.opacity = '0';
  document.getElementById('score').style.display = 'none';
  applyPreferences();
})();
