'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'tour.js'), 'utf8'), context);
const data = context.window.TOUR_DATA;
const routes = {
  1:[2], 2:[1,3,4,5], 3:[2], 4:[2], 5:[2,6,7,13], 6:[5],
  7:[5,8,9], 8:[7], 9:[10,11,12], 10:[9], 11:[9], 12:[19],
  13:[14,16,22], 14:[15,13], 15:[14], 16:[17,13], 17:[18,16], 18:[17],
  19:[20,12], 20:[19,21], 21:[20], 22:[13,23], 23:[25,22,24], 24:[23],
  25:[23,26,29,28], 26:[27,25], 27:[26], 28:[25], 29:[25,30,32,33],
  30:[31,29], 31:[30], 32:[29], 33:[29,35,34], 34:[33],
  35:[36,33], 36:[37,35], 37:[36]
};
test('37 sequential scenes, valid positions and local assets', () => {
  assert.equal(data.scenes.length, 37);
  data.scenes.forEach((scene, index) => {
    assert.equal(scene.id, index + 1);
    assert.ok(fs.existsSync(path.join(root, scene.file)), scene.file);
    assert.equal(scene.floor, scene.id <= 18 ? 1 : 2);
    assert.ok(Number.isFinite(scene.northYaw));
    assert.ok(Number.isFinite(scene.initialYaw));
    const floor = data.floors.find(f => f.id === scene.floor);
    assert.ok(scene.planX > 0 && scene.planX < floor.width);
    assert.ok(scene.planY > 0 && scene.planY < floor.height);
  });
  for (const floor of data.floors) {
    for (const suffix of ['', '-detail']) {
      assert.ok(fs.existsSync(path.join(root, `assets/plan-${floor.id}${suffix}.png`)));
    }
  }
});
test('routes match the supplied directed itinerary with documented terminal returns', () => {
  for (const scene of data.scenes) {
    assert.deepEqual(Array.from(scene.links, l => l.to), routes[scene.id], `Scene ${scene.id}`);
    for (const link of scene.links) {
      const target = data.scenes.find(s => s.id === link.to);
      assert.ok(target);
      assert.ok(Number.isFinite(link.yaw));
      assert.equal(link.pitch, scene.floor === target.floor ? 0.45 : 0.28);
    }
  }
});
test('all 37 scenes reachable from the entrance; only specified floor crossings', () => {
  const seen = new Set();
  const pending = [data.start];
  while (pending.length) {
    const id = pending.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...data.scenes.find(s => s.id === id).links.map(l => l.to));
  }
  assert.equal(seen.size, 37);
  const crossings = [];
  for (const scene of data.scenes) for (const link of scene.links) {
    if (scene.floor !== data.scenes.find(s => s.id === link.to).floor) crossings.push(`${scene.id}:${link.to}`);
  }
  assert.deepEqual(crossings.sort(), ['12:19', '13:22', '19:12', '22:13']);
});
