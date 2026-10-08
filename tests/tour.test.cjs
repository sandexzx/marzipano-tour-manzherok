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
  7:[5,8,9], 8:[7], 9:[10,11,12], 10:[9], 11:[9], 12:[19,9],
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
test('numbered plan dimensions match the viewer and every point fits the detail crop', () => {
  const crop = Array.from(data.planCrop);
  assert.deepEqual(crop, [270, 190, 1320, 1320]);
  for (const floor of data.floors) {
    for (const suffix of ['', '-detail']) {
      const png = fs.readFileSync(path.join(root, `assets/plan-${floor.id}${suffix}.png`));
      assert.equal(png.subarray(1, 4).toString(), 'PNG');
      assert.equal(png.readUInt32BE(16), suffix ? crop[2] - crop[0] : floor.width);
      assert.equal(png.readUInt32BE(20), suffix ? crop[3] - crop[1] : floor.height);
    }
  }
  for (const scene of data.scenes) {
    assert.ok(scene.planX > crop[0] && scene.planX < crop[2], `Point ${scene.id} X`);
    assert.ok(scene.planY > crop[1] && scene.planY < crop[3], `Point ${scene.id} Y`);
  }
  const point = id => data.scenes.find(scene => scene.id === id);
  assert.deepEqual([point(16).planX, point(16).planY], [1226, 1079]);
  assert.deepEqual([point(17).planX, point(17).planY], [1226, 367]);
  assert.deepEqual([point(18).planX, point(18).planY], [1009, 324]);
});
test('routes match the supplied directed itinerary with provisional terminal returns', () => {
  for (const scene of data.scenes) {
    assert.deepEqual(Array.from(scene.links, l => l.to), routes[scene.id], `Scene ${scene.id}`);
    for (const link of scene.links) {
      const target = data.scenes.find(s => s.id === link.to);
      assert.ok(target);
      assert.ok(Number.isFinite(link.yaw));
      const adjustedPitch = ['12:19', '13:22', '19:12', '22:13', '22:23']
        .includes(`${scene.id}:${link.to}`);
      const expectedPitch = adjustedPitch ? 0.55 :
        (scene.floor === target.floor ? 0.45 : 0.28);
      assert.equal(link.pitch, expectedPitch);
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
