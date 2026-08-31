const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const puppeteer = require('puppeteer');

const projectRoot = path.resolve(__dirname, '..');
const port = 4173;
const baseUrl = `http://127.0.0.1:${port}`;

async function waitForServer(process, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`Static server exited early with code ${process.exitCode}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Static server did not start');
}

async function run() {
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
    cwd: projectRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let browser;
  try {
    await waitForServer(server);
    browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    const pageErrors = [];
    const failedResources = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (resourceResponse) => {
      if (resourceResponse.url().startsWith(`${baseUrl}/game/`) && !resourceResponse.ok()) {
        failedResources.push(`${resourceResponse.status()} ${resourceResponse.url()}`);
      }
    });

    const response = await page.goto(`${baseUrl}/game/`, { waitUntil: 'networkidle0' });
    assert.equal(response.status(), 200, 'game page should load successfully');
    assert.equal(await page.title(), 'SIGIL STRIKE');

    const canvas = await page.$('#game');
    assert.ok(canvas, 'game canvas should exist');
    const canvasSize = await canvas.evaluate((element) => ({
      width: element.width,
      height: element.height,
    }));
    assert.ok(canvasSize.width > 0 && canvasSize.height > 0, 'game canvas should be initialized');

    await page.click('#btn-classic');
    await page.waitForFunction(() => document.querySelector('#menu-screen').classList.contains('hidden'));
    const hudVisible = await page.$eval('#hud-top', (element) => getComputedStyle(element).display !== 'none');
    assert.ok(hudVisible, 'game HUD should be visible after starting classic mode');

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => !document.querySelector('#visibility-pause-screen').classList.contains('hidden'));
    const pausedSnapshot = await page.evaluate(() => ({
      hp: document.querySelector('#player-hp').style.width,
      mana: document.querySelector('#player-mp').style.width,
    }));
    await new Promise((resolve) => setTimeout(resolve, 3_200));
    const hiddenSnapshot = await page.evaluate(() => ({
      hp: document.querySelector('#player-hp').style.width,
      mana: document.querySelector('#player-mp').style.width,
    }));
    assert.deepEqual(hiddenSnapshot, pausedSnapshot, 'combat resources should not change while the page is hidden');

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    });
    await page.click('#btn-resume-visibility');
    await page.waitForFunction(() => document.querySelector('#visibility-pause-screen').classList.contains('hidden'));
    await page.waitForFunction((pausedHp) => document.querySelector('#player-hp').style.width !== pausedHp, {}, pausedSnapshot.hp);

    const checkpointKey = 'sigil_strike_survival_checkpoint_v1';
    await page.evaluate((key) => localStorage.setItem(key, '{"version":1,"wave":"bad"}'), checkpointKey);
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), checkpointKey), null, 'invalid checkpoints should be discarded');
    assert.ok(await page.$eval('#survival-recovery-screen', (element) => element.classList.contains('hidden')), 'invalid checkpoints should not offer recovery');

    await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      wave: 4,
      lives: 2,
      gold: 75,
      upgrades: { maxHp: 1, manaRegen: 2, spellDmg: 1, shieldDur: 0, startMana: 1, armor: 0 },
      score: 4321,
      timeAlive: 98.5,
    })), checkpointKey);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !document.querySelector('#survival-recovery-screen').classList.contains('hidden'));
    assert.match(await page.$eval('#survival-recovery-summary', (element) => element.textContent), /WAVE 4 CLEARED.*2 LIVES.*75/, 'recovery prompt should summarize the checkpoint');
    await page.click('#btn-resume-survival');
    await page.waitForFunction(() => !document.querySelector('#waveclear-screen').classList.contains('hidden'));
    assert.match(await page.$eval('#wave-display', (element) => element.textContent), /WAVE 4.*◆ 75/, 'resumed run should restore wave and gold');
    assert.equal(await page.$eval('#score-val', (element) => element.textContent), '4321', 'resumed run should restore score');

    await page.reload({ waitUntil: 'networkidle0' });
    await page.click('#btn-discard-survival');
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), checkpointKey), null, 'discard should remove the checkpoint');
    assert.ok(await page.$eval('#menu-screen', (element) => !element.classList.contains('hidden')), 'discard should leave the main menu available');
    assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join('; ')}`);
    assert.deepEqual(failedResources, [], `failed resources: ${failedResources.join('; ')}`);

    console.log('Gameplay regression check passed.');
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
