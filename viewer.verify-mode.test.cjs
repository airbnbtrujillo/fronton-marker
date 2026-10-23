const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const round = value => Math.round(value * 100) / 100;

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
      let paused = true;
      Object.defineProperty(video, 'currentTime', { configurable: true, get: () => time, set: value => { time = value; } });
      Object.defineProperty(video, 'duration', { configurable: true, get: () => 200 });
      Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
      video.play = async () => { paused = false; };
      video.pause = () => { paused = true; };
    });
    const setTime = value => page.evaluate(time => { document.getElementById('video').currentTime = time; }, value);
    const timeNow = () => page.evaluate(() => document.getElementById('video').currentTime);
    const isPaused = () => page.evaluate(() => document.getElementById('video').paused);
    const pill = () => page.locator('#verifyPill').textContent();
    async function mark(time, key) {
      await setTime(time);
      await page.keyboard.press(key);
    }

    // Dos puntos: uno largo (saque 10 s, final 40 s) y uno corto (60 s a 63 s).
    await mark(10, '1');
    await mark(40, '3');
    await mark(60, '1');
    await mark(63, '3');

    // C empieza donde está parado el video (aquí, en el segundo punto); Mayús+C empieza desde el primero.
    await page.keyboard.press('c');
    assert.match(await pill(), /Punto 2\/2/);
    await page.keyboard.press('c');
    assert.equal(await page.evaluate(() => verifyMode), false);
    await setTime(0);

    // C: plan = inicio y final del punto largo, punto corto completo; velocidad x2.
    await page.keyboard.press('Shift+C');
    assert.equal(await page.evaluate(() => verifyMode), true);
    assert.deepEqual(await page.evaluate(() => verifyPlan.map(({ kind, from, to }) => [kind, from, to])).then(plan => plan.map(([kind, from, to]) => [kind, round(from), round(to)])),
      [['saque', 9.4, 13], ['final', 36, 41.5], ['completo', 59.4, 63.5 + 1]]);
    assert.equal(round(await timeNow()), 9.4);
    assert.equal(await page.evaluate(() => document.getElementById('video').playbackRate), 2);
    assert.match(await pill(), /Punto 1\/2 · SAQUE · x2/);
    assert.equal(await page.locator('#verifyToggle').getAttribute('aria-pressed'), 'true');

    // Al terminar los 3 s del saque salta solo al final del punto; luego al punto corto.
    await setTime(13.01);
    await page.waitForFunction(() => document.getElementById('video').currentTime === 36);
    assert.match(await pill(), /Punto 1\/2 · FINAL/);
    await setTime(41.6);
    await page.waitForFunction(() => Math.abs(document.getElementById('video').currentTime - 59.4) < 0.01);
    assert.match(await pill(), /Punto 2\/2 · PUNTO COMPLETO/);
    await setTime(64.6);
    await page.waitForFunction(() => verifyMode === false);
    assert.equal(await isPaused(), true);
    assert.equal(await page.evaluate(() => document.getElementById('video').playbackRate), 1);
    assert.equal(await page.locator('#verifyPill').isHidden(), true);

    // N en pleno final del primer punto: sale de la comprobación, activa la corrección rápida,
    // selecciona la marca de final y se detiene en ella tras reproducir los 3 s previos.
    await page.keyboard.press('c');
    await setTime(13.01);
    await page.waitForFunction(() => document.getElementById('video').currentTime === 36);
    await page.keyboard.press('n');
    await page.waitForFunction(() => verifyMode === false && quickCorrection === true);
    assert.equal(await page.locator('#quickCorrectionToggle').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.evaluate(() => { const m = marks.find(item => item.id === selectedMarkId); return [m.type, m.time]; }), ['end', 40]);
    assert.equal(await page.evaluate(() => editTarget), 'mark');
    assert.equal(round(await timeNow()), 37);
    assert.match(await page.locator('#saveStatus').textContent(), /Corrigiendo FINAL del punto 1/);
    await page.waitForFunction(() => document.getElementById('video').paused === false);
    await setTime(40.02);
    await page.waitForFunction(() => document.getElementById('video').paused === true);
    assert.equal(round(await timeNow()), 40);

    // Corregir: mover la marca de final con R (+1 s) y comprobar que la escena cambia.
    await page.keyboard.press('r');
    assert.deepEqual(await page.evaluate(() => currentPayload().scenes.map(({ start, end }) => [start, end])), [[10, 41], [60, 63]]);

    // C retoma la comprobación desde el punto corregido.
    await page.keyboard.press('c');
    assert.equal(await page.evaluate(() => verifyMode), true);
    assert.match(await pill(), /Punto 1\/2 · SAQUE/);

    // El resumen (M) y la comprobación no conviven.
    await page.keyboard.press('m');
    assert.deepEqual(await page.evaluate(() => [verifyMode, summaryMode]), [false, true]);
    await page.keyboard.press('m');
    await page.keyboard.press('j');                       // apaga la corrección rápida que dejó N

    // Contador de highlights contra lo dicho en la nota de voz.
    assert.equal(await page.locator('#highlightCount').textContent(), 'Highlights 0');
    await page.evaluate(() => { expectedHighlights = 3; render(); });
    assert.equal(await page.locator('#highlightCount').textContent(), 'Highlights 0 de 3');
    assert.equal(await page.locator('#highlightCount').evaluate(el => el.classList.contains('warn')), true);
    await setTime(20);
    await page.keyboard.press('h');
    assert.equal(await page.locator('#highlightCount').textContent(), 'Highlights 1 de 3');
    await page.evaluate(() => { expectedHighlights = 1; render(); });
    assert.equal(await page.locator('#highlightCount').evaluate(el => el.classList.contains('warn')), false);

    console.log('Verify-mode viewer test passed');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
