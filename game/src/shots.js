// Sunset Bay — Screenshot staging (v8, written fresh from SPEC-v8)
// window.SB.Shots: { stage }
// Stages camera/state for the 4 dossier screenshots (?shot=<name>).
(function () {
  'use strict';
  var SB = window.SB = window.SB || {};

  function showTitle() {
    var t = document.getElementById('title');
    if (t) t.style.display = 'flex';
    var h = document.getElementById('hud');
    if (h) h.style.display = 'none';
  }
  function hideTitle() {
    var t = document.getElementById('title');
    if (t) t.style.display = 'none';
    var h = document.getElementById('hud');
    if (h) h.style.display = 'block';
  }

  function putInCar() {
    var g = SB.G;
    if (!g || !g.player) return;
    var car = null;
    if (SB.Vehicles && SB.Vehicles.cars) {
      for (var i = 0; i < SB.Vehicles.cars.length; i++) {
        if (SB.Vehicles.cars[i].parked) { car = SB.Vehicles.cars[i]; break; }
      }
      if (!car && SB.Vehicles.cars.length) car = SB.Vehicles.cars[0];
    }
    if (car) {
      g.player.inCar = true;
      g.player.car = car;
      g.player.x = car.x; g.player.z = car.z;
      g.player.yaw = car.yaw || 0;
      g.player.speed = 14;
    }
  }

  function spawnPoliceNear(n) {
    var g = SB.G;
    if (!g || !g.player) return;
    g.police = g.police || [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      g.police.push({
        x: g.player.x + Math.cos(a) * 14,
        z: g.player.z + Math.sin(a) * 14,
        hp: 100, yaw: a
      });
    }
  }

  var Shots = {
    stage: function (name) {
      var g = SB.G;
      if (!g) return;
      hideTitle();
      if (SB.HUD && SB.HUD.mapOpen) SB.HUD.toggleMap();
      if (name === 'start') {
        // Title screen, dusk, city behind.
        showTitle();
        g.clock = 18.0;
        g.wanted = 0;
        g.mission = 0; g.missionStage = 0;
        if (g.player) { g.player.x = 0; g.player.z = 0; g.player.yaw = 0.6; g.player.inCar = false; g.player.car = null; }
        return;
      }
      if (name === 'play') {
        // Gameplay chase: wanted >= 2 + police visible + minimap + active mission.
        g.clock = 18.5;
        g.mission = 0; g.missionStage = 0;
        g.wanted = 2;
        putInCar();
        spawnPoliceNear(3);
        if (SB.HUD) { SB.HUD.update(); SB.HUD.draw(); }
        return;
      }
      if (name === 'foot') {
        // On foot, daytime, on land near the marina pier.
        g.clock = 10.0;
        g.wanted = 0;
        g.police = [];
        g.mission = 1; g.missionStage = 0;
        if (g.player) {
          g.player.inCar = false; g.player.car = null;
          g.player.x = -160; g.player.z = 110; g.player.yaw = 1.2; g.player.speed = 0;
        }
        if (SB.HUD) { SB.HUD.update(); SB.HUD.draw(); }
        return;
      }
      if (name === 'end') {
        // Fullscreen map at night.
        g.clock = 22.0;
        g.wanted = 0;
        g.mission = 2; g.missionStage = 0;
        if (g.player) { g.player.inCar = false; g.player.car = null; g.player.x = 40; g.player.z = -60; }
        if (SB.HUD && !SB.HUD.mapOpen) SB.HUD.toggleMap();
        if (SB.HUD) SB.HUD.update();
        return;
      }
      // unknown shot name: plain gameplay
      g.mission = 0; g.missionStage = 0;
      if (SB.HUD) SB.HUD.update();
    }
  };

  SB.Shots = Shots;
})();
