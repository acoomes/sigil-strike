const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// page.waitForTimeout was removed in Puppeteer ≥21 — plain setTimeout instead
const waitForTimeout = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Test configuration ───────────────────────────────────────────────────────
const VIEWPORTS = [
  { label: 'phone-portrait',   width: 390,  height: 844,  type: 'mobile'   },
  { label: 'tablet-portrait',  width: 768,  height: 1024, type: 'tablet'   },
  { label: 'tablet-landscape', width: 1024, height: 768,  type: 'tablet'   },
  { label: 'desktop-hd',      width: 1920, height: 1080, type: 'desktop'  },
];

const RESULTS_DIR = path.join(__dirname, 'test_results');
const LANDING_HTML = path.join(__dirname, 'index.html');
const GAME_HTML    = path.join(__dirname, 'game', 'index.html');

// ─── Helpers ─────────────────────────────────────────────────────────────────
function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${label}] ${msg}`);
}

// Collect errors per-page, filter known harmless file:// CORS noise
function makeErrorFilter(label) {
  const errors = [];
  return {
    errors,
    handler(msg) {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Skip known harmless file:// / PWA / service-worker noise
        const skipped = [
          'CORS',
          'net::ERR_FILE_NOT_FOUND',
          'net::ERR_FAILED',
          'favicon',
          'sw.js',
          'manifest.webmanifest',
          'webkit.org',
          'Failed to load resource',
          'Could not load resource',
          'service worker',
        ];
        if (!skipped.some(s => text.includes(s))) {
          errors.push(text);
        }
      }
    },
    check(label) {
      if (errors.length > 0) {
        throw new Error(`Browser console errors:\n  ${errors.join('\n  ')}`);
      }
      log(label, '✓ Zero browser errors');
    }
  };
}

// ─── Landing page checks ───────────────────────────────────────────────────────
async function checkLandingControls(page, viewport) {
  const result = await page.evaluate(() => {
    return {
      hero:        !!document.querySelector('header.hero'),
      playSection: !!document.querySelector('#play'),
      iframe:      !!document.querySelector('iframe[src*="game/index.html"]'),
      iframeRect: (() => {
        const el = document.querySelector('iframe');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      })(),
      features:    !!document.querySelector('.features'),
      buySection: !!document.querySelector('#buy'),
      footer:     !!document.querySelector('footer'),
      overflowX:  !!(document.documentElement.scrollWidth > document.documentElement.clientWidth),
    };
  });

  const missing = Object.entries(result)
    .filter(([k, v]) => (v === false || v === null) && k !== 'overflowX')
    .map(([k]) => k);
  if (missing.length > 0) throw new Error(`Missing landing page elements: ${missing.join(', ')}`);
  if (result.overflowX) throw new Error('Page has horizontal overflow');

  log(viewport.label, `✓ Landing page controls OK (iframe: ${result.iframeRect.w}x${result.iframeRect.h})`);
  return result;
}

// ─── Game canvas checks ────────────────────────────────────────────────────────
async function checkGameCanvas(page, viewport) {
  const result = await page.evaluate(() => {
    const canvas = document.querySelector('canvas#game');
    if (!canvas) return { found: false };
    const r = canvas.getBoundingClientRect();
    return {
      found: true,
      w: Math.round(r.width),
      h: Math.round(r.height),
      visible: r.width > 0 && r.height > 0,
      // Canvas element offset dimensions
      offsetW: canvas.offsetWidth,
      offsetH: canvas.offsetHeight,
    };
  });

  if (!result.found) throw new Error('Canvas #game element not found in DOM');
  if (!result.visible) throw new Error(`Canvas has zero dimensions: ${result.w}x${result.h}`);
  if (result.w < 50 || result.h < 50) throw new Error(`Canvas suspiciously small: ${result.w}x${result.h}`);

  log(viewport.label, `✓ Game canvas visible and correctly sized: ${result.w}x${result.h}`);
  return result;
}

async function checkGameControls(page, viewport) {
  const result = await page.evaluate(() => {
    return {
      menuScreen:  !!document.querySelector('#menu-screen'),
      btnClassic:   !!document.querySelector('#btn-classic'),
      btnSurvival:  !!document.querySelector('#btn-survival'),
      hudTop:       !!document.querySelector('#hud-top'),
      footer:       !!document.querySelector('#footer'),
      overflowX:    !!(document.documentElement.scrollWidth > document.documentElement.clientWidth),
    };
  });

  const missing = Object.entries(result)
    .filter(([k, v]) => (v === false || v === null) && k !== 'overflowX')
    .map(([k]) => k);
  if (missing.length > 0) throw new Error(`Missing game UI elements: ${missing.join(', ')}`);
  if (result.overflowX) throw new Error('Game has horizontal overflow');

  log(viewport.label, '✓ Game UI controls present');
  return result;
}

// ─── Per-viewport test ────────────────────────────────────────────────────────
async function testViewport(browser, vp) {
  log(vp.label, `Testing ${vp.width}x${vp.height} (${vp.type})`);

  // ── Landing page ──────────────────────────────────────────────────────────
  {
    const ef = makeErrorFilter(vp.label);
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height });
    page.on('console', ef.handler);
    page.on('pageerror', err => ef.errors.push(err.message));

    try {
      await page.goto(`file://${LANDING_HTML}`, { waitUntil: 'domcontentloaded' });
      await waitForTimeout(1500);

      await checkLandingControls(page, vp);
      ef.check(vp.label);
    } finally {
      await page.close();
    }
  }

  // ── Game (direct) ──────────────────────────────────────────────────────────
  {
    const ef = makeErrorFilter(vp.label + '-game');
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height });
    page.on('console', ef.handler);
    page.on('pageerror', err => ef.errors.push(err.message));

    try {
      await page.goto(`file://${GAME_HTML}`, { waitUntil: 'domcontentloaded' });
      await waitForTimeout(2000);

      await checkGameCanvas(page, vp);
      await checkGameControls(page, vp);
      ef.check(vp.label + '-game');
    } finally {
      await page.close();
    }
  }
}

// ─── Live resize test ──────────────────────────────────────────────────────────
async function testLiveResize(browser) {
  log('live-resize', 'Testing live window resize sequence...');

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });

  const sequence = [
    { label: '→tablet-portrait',   width: 768,  height: 1024 },
    { label: '→tablet-landscape',  width: 1024, height: 768  },
    { label: '→desktop-hd',        width: 1920, height: 1080 },
    { label: '→phone-portrait',    width: 390,  height: 844  },
  ];

  try {
    await page.goto(`file://${LANDING_HTML}`, { waitUntil: 'domcontentloaded' });
    await waitForTimeout(1000);

    for (const r of sequence) {
      const ef = makeErrorFilter('live-resize');
      page.on('console', ef.handler);
      page.on('pageerror', err => ef.errors.push(err.message));

      await page.setViewport({ width: r.width, height: r.height });
      await waitForTimeout(600);

      const ok = await page.evaluate(() => {
        const iframe = document.querySelector('iframe[src*="game/index.html"]');
        if (!iframe) return false;
        const rect = iframe.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      if (!ok) throw new Error(`Resize to ${r.label} broke iframe layout`);
      ef.check(`live-resize ${r.label}`);
      log('live-resize', `  ✓ ${r.label} (${r.width}x${r.height}) — iframe OK, no errors`);
    }

    log('live-resize', '✓ Live resize test passed');

  } finally {
    await page.close();
  }
}

// ─── Orientation change test ──────────────────────────────────────────────────
async function testOrientationChange(browser) {
  log('orientation', 'Testing orientation change (portrait ↔ landscape)...');

  // Portrait
  {
    const ef = makeErrorFilter('orientation');
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844 });
    page.on('console', ef.handler);
    page.on('pageerror', err => ef.errors.push(err.message));

    try {
      await page.goto(`file://${LANDING_HTML}`, { waitUntil: 'domcontentloaded' });
      await waitForTimeout(1500);

      const ok = await page.evaluate(() => {
        const iframe = document.querySelector('iframe[src*="game/index.html"]');
        if (!iframe) return false;
        const r = iframe.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (!ok) throw new Error('Portrait: iframe not visible');
      ef.check('orientation-portrait');
      log('orientation', '  ✓ Portrait — iframe visible, no errors');

    } finally {
      await page.close();
    }
  }

  // Landscape (flip width/height)
  {
    const ef = makeErrorFilter('orientation-landscape');
    const page = await browser.newPage();
    await page.setViewport({ width: 844, height: 390 });
    page.on('console', ef.handler);
    page.on('pageerror', err => ef.errors.push(err.message));

    try {
      await page.goto(`file://${LANDING_HTML}`, { waitUntil: 'domcontentloaded' });
      await waitForTimeout(1500);

      const ok = await page.evaluate(() => {
        const iframe = document.querySelector('iframe[src*="game/index.html"]');
        if (!iframe) return false;
        const r = iframe.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (!ok) throw new Error('Landscape: iframe not visible');
      ef.check('orientation-landscape');
      log('orientation', '  ✓ Landscape — iframe visible, no errors');

    } finally {
      await page.close();
    }
  }

  log('orientation', '✓ Orientation change test passed');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  SIGIL STRIKE — Responsive Regression Test Suite');
  console.log('═══════════════════════════════════════════════════════\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const results = { passed: [], failed: [] };

  try {
    for (const vp of VIEWPORTS) {
      try {
        await testViewport(browser, vp);
        results.passed.push(vp.label);
      } catch (err) {
        results.failed.push({ test: vp.label, error: err.message });
        log(vp.label, `✗ FAILED: ${err.message.split('\n')[0]}`);
      }
    }

    try {
      await testLiveResize(browser);
      results.passed.push('live-resize');
    } catch (err) {
      results.failed.push({ test: 'live-resize', error: err.message });
      log('live-resize', `✗ FAILED: ${err.message.split('\n')[0]}`);
    }

    try {
      await testOrientationChange(browser);
      results.passed.push('orientation');
    } catch (err) {
      results.failed.push({ test: 'orientation', error: err.message });
      log('orientation', `✗ FAILED: ${err.message.split('\n')[0]}`);
    }

  } finally {
    await browser.close();
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  RESULTS');
  console.log('═══════════════════════════════════════════════════════');

  if (results.passed.length > 0) {
    console.log('\n  PASSED:');
    results.passed.forEach(v => console.log(`    ✓ ${v}`));
  }
  if (results.failed.length > 0) {
    console.log('\n  FAILED:');
    results.failed.forEach(({ test, error }) => {
      console.log(`    ✗ ${test}`);
      console.log(`      └─ ${error.split('\n')[0]}`);
    });
  }

  const total = results.passed.length + results.failed.length;
  const allPassed = results.failed.length === 0;
  console.log(`\n  ${results.passed.length}/${total} tests passed\n`);

  // Save JSON report
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const report = {
    timestamp: new Date().toISOString(),
    summary: { total, passed: results.passed.length, failed: results.failed.length },
    passed: results.passed,
    failed: results.failed,
  };
  fs.writeFileSync(
    path.join(RESULTS_DIR, `report-${Date.now()}.json`),
    JSON.stringify(report, null, 2)
  );

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
