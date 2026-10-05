'use strict';

(function() {
  var data = window.TOUR_DATA;
  var status = document.getElementById('status');
  var floorSelect = document.getElementById('floor');
  var sceneSelect = document.getElementById('scene');
  var plan = document.getElementById('plan');
  var scenePicker = document.getElementById('scene-picker');
  var sceneMenu = document.getElementById('scene-menu');
  var activeOption = 0;
  var searchText = '';
  var searchTimer;
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

  function syncControls() {
    document.querySelectorAll('header .floor-tabs button').forEach(function(button) {
      button.setAttribute('aria-pressed', String(button.dataset.floor === floorSelect.value));
    });
    if (!scenePicker) { return; }
    var selected = sceneSelect.options[sceneSelect.selectedIndex];
    document.getElementById('scene-value').textContent = selected ? selected.textContent : 'Выберите помещение';
    sceneMenu.replaceChildren();
    Array.prototype.forEach.call(sceneSelect.options, function(option, index) {
      var item = document.createElement('div');
      item.id = 'scene-option-' + option.value;
      item.className = 'scene-option';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.selected));
      item.dataset.index = index;
      item.textContent = option.textContent;
      sceneMenu.appendChild(item);
    });
    activeOption = Math.max(0, sceneSelect.selectedIndex);
    if (!sceneMenu.hidden) { highlightOption(); }
  }

  function highlightOption() {
    var items = sceneMenu.children;
    Array.prototype.forEach.call(items, function(item, index) {
      item.classList.toggle('is-active', index === activeOption);
    });
    if (items[activeOption]) {
      scenePicker.setAttribute('aria-activedescendant', items[activeOption].id);
      items[activeOption].scrollIntoView({ block: 'nearest' });
    }
  }

  function closeSceneMenu() {
    if (!scenePicker) { return; }
    sceneMenu.hidden = true;
    scenePicker.setAttribute('aria-expanded', 'false');
    scenePicker.removeAttribute('aria-activedescendant');
    searchText = '';
    window.clearTimeout(searchTimer);
  }

  function openSceneMenu() {
    sceneMenu.hidden = false;
    scenePicker.setAttribute('aria-expanded', 'true');
    activeOption = Math.max(0, sceneSelect.selectedIndex);
    highlightOption();
  }

  function chooseOption(index) {
    if (!sceneSelect.options[index]) { return; }
    sceneSelect.selectedIndex = index;
    closeSceneMenu();
    sceneSelect.dispatchEvent(new Event('change'));
    scenePicker.focus({ preventScroll: true });
  }

  if (scenePicker) {
    scenePicker.addEventListener('click', function() {
      if (sceneMenu.hidden) { openSceneMenu(); } else { closeSceneMenu(); }
    });
    sceneMenu.addEventListener('click', function(event) {
      var option = event.target.closest('[role="option"]');
      if (option) { chooseOption(Number(option.dataset.index)); }
    });
    scenePicker.addEventListener('keydown', function(event) {
      var key = event.key;
      if (key === 'Escape') { closeSceneMenu(); event.preventDefault(); return; }
      if (key === 'Tab') { closeSceneMenu(); return; }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(key) !== -1) {
        event.preventDefault();
        var wasClosed = sceneMenu.hidden;
        if (wasClosed) { openSceneMenu(); }
        if (key === 'Home') { activeOption = 0; }
        else if (key === 'End') { activeOption = sceneSelect.options.length - 1; }
        else if (!wasClosed) { activeOption += key === 'ArrowDown' ? 1 : -1; }
        activeOption = Math.max(0, Math.min(sceneSelect.options.length - 1, activeOption));
        highlightOption();
      } else if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        if (sceneMenu.hidden) { openSceneMenu(); } else { chooseOption(activeOption); }
      } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        if (sceneMenu.hidden) { openSceneMenu(); }
        searchText += key.toLocaleLowerCase('ru');
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(function() { searchText = ''; }, 700);
        var options = Array.prototype.slice.call(sceneSelect.options);
        var found = options.findIndex(function(option) {
          return option.textContent.toLocaleLowerCase('ru').indexOf(searchText) === 0 ||
            option.textContent.replace(/^\d+ · /, '').toLocaleLowerCase('ru').indexOf(searchText) === 0;
        });
        if (found !== -1) { activeOption = found; highlightOption(); }
      }
    });
    document.addEventListener('pointerdown', function(event) {
      if (!event.target.closest('.scene-control')) { closeSceneMenu(); }
    });
    document.addEventListener('focusin', function(event) {
      if (!event.target.closest('.scene-control')) { closeSceneMenu(); }
    });
  }

  document.querySelectorAll('header .floor-tabs button').forEach(function(button) {
    button.addEventListener('click', function() {
      closeSceneMenu();
      if (floorSelect.value !== button.dataset.floor) {
        floorSelect.value = button.dataset.floor;
        floorSelect.dispatchEvent(new Event('change'));
      }
    });
  });

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
    syncControls();
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
    scale.textContent = fullPlan ? 'Помещения' : 'Весь план';
    scale.setAttribute('aria-label', fullPlan ? 'Показать помещения крупно' : 'Показать весь план');
    scale.setAttribute('aria-pressed', String(fullPlan));
  }

  floorSelect.addEventListener('change', function() {
    var first = data.scenes.find(function(config) { return config.floor === Number(floorSelect.value); });
    select(first.id, false);
  });
  sceneSelect.addEventListener('change', function() { select(Number(sceneSelect.value), false); });
  document.getElementById('show-plan').addEventListener('click', function() {
    closeSceneMenu();
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
