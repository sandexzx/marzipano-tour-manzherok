// Browser smoke test using Chrome DevTools Protocol, without npm dependencies.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = await mkdtemp(path.join(tmpdir(), 'manzherok-chrome-'));
const port = Number(process.env.CDP_PORT || 9223);
const url = process.env.TOUR_URL || 'http://127.0.0.1:8082/';
const chrome = spawn(process.env.CHROME || 'google-chrome', [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });
let ws;
const delay = ms => new Promise(r => setTimeout(r, ms));
try {
  let tabs;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; }
    catch { await delay(100); }
  }
  assert.ok(tabs, 'Chrome failed to start');
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const task = pending.get(message.id);
      if (!task) return;
      pending.delete(message.id);
      clearTimeout(task.timer);
      message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') {
      errors.push(JSON.stringify(message.params.exceptionDetails));
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(JSON.stringify(message.params.args));
    } else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
      errors.push(`${message.params.response.status} ${message.params.response.url}`);
    }
  });
  function command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function waitFor(expression) {
    for (let n = 0; n < 150; n++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`Timed out: ${expression}`);
  }
  async function choose(id) {
    await evaluate(`(() => {
      const config = window.TOUR_DATA.scenes.find(s => s.id === ${id});
      const floor = document.getElementById('floor');
      if (Number(floor.value) !== config.floor) { floor.value = config.floor; floor.dispatchEvent(new Event('change')); }
      const scene = document.getElementById('scene');
      scene.value = ${id}; scene.dispatchEvent(new Event('change'));
    })()`);
    await waitFor(`document.getElementById('status').textContent === '' && Number(document.getElementById('scene').value) === ${id}`);
    await delay(450);
  }
  async function screenshot(name) {
    const shot = await command('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(root, name), Buffer.from(shot.data, 'base64'));
  }
  await command('Runtime.enable');
  await command('Network.enable');
  await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url });
  await waitFor(`window.TOUR_DATA && document.getElementById('status').textContent === ''`);
  await delay(450);
  await screenshot('smoke-desktop.png');
  await choose(1);
  const arrowPoint = await evaluate(`(() => {
    const arrow = document.querySelector('.travel-arrow[data-to="2"]');
    const rect = arrow.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...arrowPoint });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...arrowPoint });
  await waitFor(`document.getElementById('scene').value === '2' && document.getElementById('status').textContent === ''`);
  for (let id = 1; id <= 37; id++) {
    await choose(id);
    console.log(`Loaded panorama ${id}`);
  }
  // Click actual hotspot DOM buttons, including both staircases.
  for (const [from, to] of [[1, 2], [5, 7], [7, 9], [9, 10], [10, 9], [29, 30], [30, 31], [31, 30], [12, 9], [12, 19], [19, 12], [13, 22], [22, 13], [17, 18], [18, 17]]) {
    await choose(from);
    await evaluate(`(() => {
      const arrows = [...document.querySelectorAll('.travel-arrow[data-to="${to}"]')];
      const arrow = arrows.find(a => a.getClientRects().length && !a.closest('[style*="display: none"]'));
      if (!arrow) throw new Error('No active arrow ${from} -> ${to}');
      arrow.click();
    })()`);
    await waitFor(`Number(document.getElementById('scene').value) === ${to} && document.getElementById('status').textContent === ''`);
    await delay(450);
  }
  if (await evaluate(`Boolean(document.querySelector('.floor-tabs'))`)) {
    for (const floorId of [1, 2]) {
      await evaluate(`document.querySelector('.floor-tabs [data-floor="${floorId}"]').click()`);
      await waitFor(`document.getElementById('floor').value === '${floorId}' && document.querySelector('.floor-tabs [data-floor="${floorId}"]').getAttribute('aria-pressed') === 'true' && document.getElementById('status').textContent === ''`);
      await delay(450);
    }
  }
  // Stress interrupted fades with rapid scene and floor switching.
  await evaluate(`(() => {
    for (const id of [18, 27, 19, 35, 1, 15, 4, 26, 33]) {
      const config = window.TOUR_DATA.scenes.find(s => s.id === id);
      const floor = document.getElementById('floor');
      floor.value = config.floor; floor.dispatchEvent(new Event('change'));
      const scene = document.getElementById('scene');
      scene.value = id; scene.dispatchEvent(new Event('change'));
    }
  })()`);
  await waitFor(`document.getElementById('scene').value === '33' && document.getElementById('status').textContent === ''`);
  await delay(1000);
  if (await evaluate(`Boolean(document.getElementById('scene-picker'))`)) {
    await choose(1);
    await evaluate(`document.getElementById('scene-picker').focus(); document.getElementById('scene-picker').click()`);
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown' });
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' });
    await waitFor(`document.getElementById('scene').value === '2' && document.getElementById('status').textContent === ''`);
    assert.equal(await evaluate(`document.getElementById('scene-picker').getAttribute('aria-expanded')`), 'false');
    await evaluate(`document.getElementById('scene-picker').click()`);
    await delay(450);
    await screenshot('smoke-dropdown.png');
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End' });
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' });
    await waitFor(`document.getElementById('scene').value === '18' && document.getElementById('status').textContent === ''`);
    await choose(1);
    await evaluate(`document.getElementById('scene-picker').focus()`);
    for (const key of ['м', 'е', 'д']) {
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key });
    }
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' });
    await waitFor(`document.getElementById('scene').value === '6' && document.getElementById('status').textContent === ''`);
    await evaluate(`document.getElementById('scene-picker').click()`);
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    assert.ok(await evaluate(`document.getElementById('scene-menu').hidden`));
    await choose(33);
  }
  await evaluate(`document.getElementById('show-plan').click()`);
  await waitFor(`document.getElementById('plan-picture').complete && document.getElementById('plan-picture').naturalWidth > 0`);
  assert.equal(await evaluate(`document.querySelectorAll('.plan-marker').length`), 19);
  assert.equal(await evaluate(`document.querySelector('.plan-marker[aria-pressed="true"]').textContent`), '33');
  await screenshot('smoke-plan.png');
  await evaluate(`document.getElementById('plan-scale').click()`);
  await waitFor(`document.getElementById('plan-picture').complete && document.getElementById('plan-picture').naturalWidth === window.TOUR_DATA.floors.find(f => f.id === 2).width`);
  await evaluate(`[...document.querySelectorAll('.plan-marker')].find(b => b.textContent === '35').click()`);
  await waitFor(`!document.getElementById('plan').open && document.getElementById('scene').value === '35' && document.getElementById('status').textContent === ''`);
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await choose(await evaluate('window.TOUR_DATA.start'));
  assert.ok(await evaluate(`document.querySelector('header').getBoundingClientRect().right <= innerWidth`));
  assert.ok(await evaluate(`document.getElementById('scene').getBoundingClientRect().right <= innerWidth`));
  await screenshot('smoke-mobile.png');
  if (await evaluate(`Boolean(document.getElementById('scene-picker'))`)) {
    await evaluate(`document.getElementById('scene-picker').click()`);
    assert.ok(await evaluate(`document.getElementById('scene-menu').getBoundingClientRect().right <= innerWidth`));
    await delay(200);
    await screenshot('smoke-mobile-dropdown.png');
    await evaluate(`document.querySelector('#scene-menu [data-index="4"]').click()`);
    await waitFor(`document.getElementById('scene').value === '5' && document.getElementById('status').textContent === ''`);
    assert.ok(await evaluate(`document.getElementById('scene-menu').hidden`));
  }
  await evaluate(`document.getElementById('show-plan').click(); document.querySelector('#plan-floors [data-floor="1"]').click()`);
  await waitFor(`document.getElementById('plan-picture').complete && document.getElementById('plan-picture').naturalWidth > 0`);
  assert.equal(await evaluate(`document.querySelectorAll('.plan-marker').length`), 18);
  await evaluate(`document.getElementById('plan-scale').click()`);
  await waitFor(`document.getElementById('plan-picture').complete && document.getElementById('plan-picture').naturalWidth === window.TOUR_DATA.planCrop[2] - window.TOUR_DATA.planCrop[0]`);
  assert.equal(await evaluate(`document.querySelectorAll('.plan-marker').length`), 18);
  assert.ok(await evaluate(`(() => {
    const image = document.getElementById('plan-picture');
    const rect = image.getBoundingClientRect();
    return Math.abs(rect.width / rect.height - image.naturalWidth / image.naturalHeight) < 0.01;
  })()`), 'Plan must retain its aspect ratio');
  await screenshot('smoke-mobile-plan.png');
  if (await evaluate(`Boolean(document.getElementById('scene-picker'))`)) {
    assert.equal(await evaluate(`getComputedStyle(document.getElementById('plan')).backgroundColor`), await evaluate(`getComputedStyle(document.getElementById('scene-menu')).backgroundColor`));
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await waitFor(`!document.getElementById('plan').open`);
    for (const [width, height] of [[320, 740], [844, 390]]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
      assert.ok(await evaluate(`document.getElementById('scene-picker').getBoundingClientRect().right <= innerWidth`));
    }
  }
  // Confirm that the corrected hangar and service-room points work in detail view.
  for (const id of [17, 18]) {
    await evaluate(`document.getElementById('show-plan').click()`);
    await waitFor(`document.getElementById('plan-picture').complete && document.getElementById('plan-picture').naturalWidth === window.TOUR_DATA.planCrop[2] - window.TOUR_DATA.planCrop[0]`);
    await evaluate(`[...document.querySelectorAll('.plan-marker')].find(b => b.textContent === '${id}').click()`);
    await waitFor(`!document.getElementById('plan').open && document.getElementById('scene').value === '${id}' && document.getElementById('status').textContent === ''`);
  }
  assert.deepEqual(errors, [], errors.join('\n'));
  console.log('PASS: all 37 panoramas, links, staircases, plans and mobile layout; no browser errors.');
} finally {
  if (ws) ws.close();
  chrome.kill();
  await new Promise(resolve => { if (chrome.exitCode !== null) resolve(); else chrome.once('exit', resolve); });
  await rm(profile, { recursive: true, force: true });
}
