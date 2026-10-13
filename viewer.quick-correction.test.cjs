const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(__dirname, 'viewer.html')).href);
    await page.evaluate(() => {
      const video = document.getElementById('video');
      let time = 0;
      Object.defineProperty(video, 'currentTime', {
        configurable: true,
        get: () => time,
        set: value => { time = value; },
      });
      Object.defineProperty(video, 'duration', { configurable: true, get: () => 120 });
    });
    await page.keyboard.press('j');
    assert.equal(await page.locator('#quickCorrectionToggle').getAttribute('aria-pressed'), 'true');

    async function mark(time, key) {
      await page.evaluate(value => { document.getElementById('video').currentTime = value; }, time);
      await page.keyboard.press(key);
    }
    await mark(10, '1');
    await mark(20, '1');
    await mark(30, '3');
    await mark(35, '3');
    assert.deepEqual(await page.evaluate(() => currentPayload().marks.map(({ time, type }) => [time, type])),
      [[20, 'serve'], [35, 'end']]);
    assert.deepEqual(await page.evaluate(() => currentPayload().scenes.map(({ start, end }) => [start, end])),
      [[20, 35]]);

    await mark(40, '1');
    await mark(50, '3');
    await mark(45, '1');
    assert.deepEqual(await page.evaluate(() => currentPayload().scenes.map(({ start, end }) => [start, end])),
      [[20, 35], [45, 50]]);

    await page.keyboard.press('j');
    assert.equal(await page.locator('#quickCorrectionToggle').getAttribute('aria-pressed'), 'false');
    await mark(60, '1');
    await mark(62, '1');
    assert.deepEqual(await page.evaluate(() => currentPayload().marks.filter(item => item.type === 'serve').map(item => item.time)),
      [20, 45, 60, 62]);
    console.log('Quick correction viewer test passed');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
