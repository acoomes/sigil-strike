
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function generate() {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  const assets = [
    { name: 'header_capsule', width: 460, height: 215 },
    { name: 'small_capsule', width: 231, height: 87 },
    { name: 'main_capsule', width: 616, height: 353 },
    { name: 'library_capsule', width: 600, height: 900 },
    { name: 'library_hero', width: 1920, height: 620 },
    { name: 'library_logo', width: 640, height: 360 }
  ];
  
  const outDir = path.join(__dirname, 'steam_assets');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, {recursive: true});

  for (const asset of assets) {
    await page.setViewport({ width: asset.width, height: asset.height });
    await page.setContent(`
      <html>
        <body style="margin:0; padding:0; background: linear-gradient(135deg, #2b00ff, #110033); display: flex; align-items: center; justify-content: center; color: white; font-family: sans-serif; height: 100vh;">
          <div style="text-align: center;">
            <h1 style="font-size: ${asset.width / 10}px; margin: 0; text-shadow: 0 0 20px cyan, 0 0 40px cyan;">SIGIL STRIKE</h1>
            <div style="width: ${asset.width / 4}px; height: ${asset.width / 4}px; border: ${asset.width / 100}px solid cyan; border-radius: 50%; margin: 20px auto; box-shadow: 0 0 30px cyan, inset 0 0 30px cyan;"></div>
          </div>
        </body>
      </html>
    `);
    await page.screenshot({ path: path.join(outDir, asset.name + '.png') });
  }

  // Generate screenshots from the actual game
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto('file://' + path.join(__dirname, 'index.html'));
  
  // Wait for game to initialize
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(outDir, 'screenshot_1.png') });
  
  // Simulate some gameplay action
  await page.mouse.move(500, 500);
  await page.mouse.down();
  await page.mouse.move(600, 600, {steps: 10});
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: path.join(outDir, 'screenshot_2.png') });
  
  await page.mouse.down();
  await page.mouse.move(700, 400, {steps: 10});
  await page.mouse.move(500, 400, {steps: 10});
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 200));
  await page.screenshot({ path: path.join(outDir, 'screenshot_3.png') });

  await browser.close();
}
generate();
