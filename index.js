'use strict';

(function() {
  var data = window.TOUR_DATA;
  var status = document.getElementById('status');
  var floorSelect = document.getElementById('floor');
  var sceneSelect = document.getElementById('scene');
  var plan = document.getElementById('plan');
  var entries = {};
  var current = null;
  var planFloor = 1;
  var fullPlan = false;
  var viewer;

  data.floors.forEach(function(floor) {
    floorSelect.add(new Option(floor.name, floor.id));
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = floor.name;
    button.dataset.floor = floor.id;
    button.addEventListener('click', function() { planFloor = floor.id; renderPlan(); });
    document.getElementById('plan-floors').appendChild(button);
  });

  try {
    viewer = new Marzipano.Viewer(document.getElementById('pano'));
    var geometry = new Marzipano.EquirectGeometry([{ width: 4096 }]);
    var limiter = Marzipano.RectilinearView.limit.traditional(2048, 100 * Math.PI / 180);
    data.scenes.forEach(function(config) {
      var scene = viewer.createScene({
        source: Marzipano.ImageUrlSource.fromString(config.file),
        geometry: geometry,
        view: new Marzipano.RectilinearView({ yaw: config.initialYaw, pitch: 0, fov: Math.PI / 2 }, limiter),
        pinFirstLevel: false
      });
      var entry = entries[config.id] = { config: config, scene: scene, loaded: false, failed: false };
      scene.layer().textureStore().addEventListener('textureLoad', function() {
        entry.loaded = true;
        entry.failed = false;
        if (current === entry) { status.textContent = ''; }
      });
      scene.layer().textureStore().addEventListener('textureError', function(tile, error) {
        entry.loaded = false;
        entry.failed = true;
        if (current === entry) { status.textContent = 'Не удалось загрузить панораму ' + config.id + '. Выберите её ещё раз для повтора.'; }
        console.error('Panorama ' + config.id, error);
      });
    });
    data.scenes.forEach(addArrows);
    select(data.start, false);
  } catch (error) {
    status.textContent = 'Не удалось запустить панораму. Проверьте поддержку WebGL в браузере.';
    console.error(error);
  }

  function populateScenes(floor) {
    sceneSelect.replaceChildren();
    data.scenes.filter(function(config) { return config.floor === floor; }).forEach(function(config) {
      sceneSelect.add(new Option(config.id + ' · ' + config.name, config.id));
    });
  }

  function select(id, preserveHeading) {
    var next = entries[id];
    if (!next) { return; }
    if (next === current && !next.failed) { return; }
    if (preserveHeading && current) {
      // Keep approximate world heading between differently rotated panorama exports.
      var previousView = current.scene.view();
      next.scene.view().setParameters({
        yaw: previousView.yaw() - current.config.northYaw + next.config.northYaw,
        pitch: previousView.pitch(),
        fov: previousView.fov()
      });
    } else {
      next.scene.view().setParameters({ yaw: next.config.initialYaw, pitch: 0, fov: Math.PI / 2 });
    }
    current = next;
    floorSelect.value = next.config.floor;
    populateScenes(next.config.floor);
    sceneSelect.value = id;
    document.getElementById('location').textContent = next.config.floor + ' этаж · ' + id + ' · ' + next.config.name;
    status.textContent = next.loaded ? '' : 'Загрузка панорамы ' + id + '…';
    // Marzipano releases inactive textures after the fade; never clear pinned transition layers.
    Object.keys(entries).forEach(function(key) {
      if (entries[key] !== current) { entries[key].loaded = false; }
    });
    next.scene.switchTo({ transitionDuration: 300 });
  }

  function addArrows(config) {
    config.links.forEach(function(link) {
      var target = entries[link.to].config;
      var crossFloor = config.floor !== target.floor;
      var arrow = document.createElement('button');
      arrow.type = 'button';
      arrow.className = 'travel-arrow' + (crossFloor ? ' stairs-arrow' : '');
      arrow.dataset.to = link.to;
      arrow.title = 'Перейти: ' + link.to + ' · ' + target.name + (crossFloor ? ' (' + target.floor + ' этаж)' : '');
      arrow.setAttribute('aria-label', arrow.title);
      arrow.innerHTML = '<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="53"/><path d="M30 69 L60 39 L90 69"/></svg><span>' + link.to + (crossFloor ? ' · ' + target.floor + ' эт.' : '') + '</span>';
      arrow.addEventListener('click', function() { select(link.to, true); });
      entries[config.id].scene.hotspotContainer().createHotspot(arrow,
        { yaw: link.yaw, pitch: link.pitch },
        { perspective: { radius: 650, extraTransforms: 'rotateX(' + (Math.PI / 2 - link.pitch) + 'rad)' } }
      );
    });
  }

  function renderPlan() {
    var floor = data.floors.find(function(item) { return item.id === planFloor; });
    var crop = data.planCrop;
    var width = fullPlan ? floor.width : crop[2] - crop[0];
    var height = fullPlan ? floor.height : crop[3] - crop[1];
    var image = document.getElementById('plan-picture');
    image.src = 'assets/plan-' + planFloor + (fullPlan ? '' : '-detail') + '.png';
    image.alt = 'План ' + planFloor + ' этажа с точками обзора';
    image.width = width;
    image.height = height;
    document.getElementById('plan-image').style.setProperty('--plan-ratio', width + ' / ' + height);
    var markers = document.getElementById('markers');
    markers.replaceChildren();
    data.scenes.filter(function(config) { return config.floor === planFloor; }).forEach(function(config) {
      var x = config.planX - (fullPlan ? 0 : crop[0]);
      var y = config.planY - (fullPlan ? 0 : crop[1]);
      if (x < 0 || y < 0 || x > width || y > height) { return; }
      var marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'plan-marker';
      marker.textContent = config.id;
      marker.style.left = x / width * 100 + '%';
      marker.style.top = y / height * 100 + '%';
      marker.title = config.id + ' · ' + config.name;
      marker.setAttribute('aria-label', marker.title);
      marker.setAttribute('aria-pressed', String(current && current.config.id === config.id));
      marker.addEventListener('click', function() { select(config.id, false); plan.close(); });
      markers.appendChild(marker);
    });
    document.querySelectorAll('#plan-floors button').forEach(function(button) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.floor) === planFloor));
    });
    var scale = document.getElementById('plan-scale');
    scale.textContent = fullPlan ? 'Крупно: помещения' : 'Весь план';
    scale.setAttribute('aria-pressed', String(fullPlan));
  }

  floorSelect.addEventListener('change', function() {
    var first = data.scenes.find(function(config) { return config.floor === Number(floorSelect.value); });
    select(first.id, false);
  });
  sceneSelect.addEventListener('change', function() { select(Number(sceneSelect.value), false); });
  document.getElementById('show-plan').addEventListener('click', function() {
    planFloor = current ? current.config.floor : 1;
    renderPlan();
    plan.showModal();
  });
  document.getElementById('close-plan').addEventListener('click', function() { plan.close(); });
  document.getElementById('plan-scale').addEventListener('click', function() { fullPlan = !fullPlan; renderPlan(); });
  plan.addEventListener('click', function(event) {
    var rect = plan.getBoundingClientRect();
    if (event.target === plan && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) { plan.close(); }
  });
})();
