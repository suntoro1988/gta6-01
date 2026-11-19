// Sunset Bay — Shots (ditulis fresh untuk v7, dari SPEC)
// SB.Shots.stage(name): atur kamera/posisi untuk 4 shot staging:
// "start" (title), "play" (gameplay jalan), "foot" (jalan kaki),
// "end" (peta / malam). Dipakai saat URL mengandung ?shot=<name>.
(function () {
  'use strict';
  var SB = window.SB = window.SB || {};

  function setPlayer(x, z, yaw) {
    var G = SB.G;
    if (!G || !G.player) return;
    var p = G.player;
    p.x = x; p.z = z; p.yaw = yaw;
    p.inCar = false; p.car = null; p.speed = 0; p.hp = 100;
    p.inBoat = false; // flag kapal ada di player (G.inBoat top-level tidak dipakai)
    G.inBoat = false;
  }

  // Mobil parkir terdekat dari titik (x,z) — tanpa batas radius 12
  // (nearestParked gagal bila tidak ada mobil parkir di dekat titik).
  function nearestParkedAnywhere(x, z) {
    if (!SB.Vehicles || !SB.Vehicles.cars) return null;
    var best = null, bestD = Infinity;
    for (var i = 0; i < SB.Vehicles.cars.length; i++) {
      var c = SB.Vehicles.cars[i];
      if (!c.parked) continue;
      var d = (c.x - x) * (c.x - x) + (c.z - z) * (c.z - z);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  SB.Shots = {
    // mode kamera yang dibaca loop render di SB.Main:
    // 'orbit' | 'chase' | 'follow' | 'high'
    cam: { mode: 'chase' },

    stage: function (name) {
      var G = SB.G;
      if (!G) return;
      if (name === 'start') {
        // Shot title: kota saat senja, kamera orbit, title screen tampil.
        G.clock = 18.0;
        G.wanted = 0;
        setPlayer(0, 40, 0);
        SB.Shots.cam = { mode: 'orbit' };
        return;
      }
      if (name === 'play') {
        // Gameplay berkendara: siang sore, pemain di dalam mobil di jalan.
        G.clock = 17.5;
        G.wanted = 1;
        var car = nearestParkedAnywhere(20, 40);
        if (car) {
          // Berdiri di samping mobil parkir itu lalu naik — jadi shot
          // benar-benar menampilkan pemain di dalam mobil, bukan jalan kaki.
          setPlayer(car.x + 3, car.z + 2, car.yaw);
          if (SB.Vehicles.enterCar) SB.Vehicles.enterCar(car);
          G.player.speed = 12;
        } else {
          setPlayer(20, 40, Math.PI);
        }
        SB.Shots.cam = { mode: 'chase' };
        return;
      }
      if (name === 'foot') {
        // Jalan kaki di trotoar, pagi terang.
        G.clock = 10.0;
        G.wanted = 0;
        setPlayer(-30, 60, Math.PI / 2);
        SB.Shots.cam = { mode: 'follow' };
        return;
      }
      if (name === 'end') {
        // Malam + peta fullscreen terbuka.
        G.clock = 21.5;
        G.wanted = 2;
        setPlayer(0, -20, 0);
        SB.Shots.cam = { mode: 'high' };
        if (SB.HUD && SB.HUD.openMap) SB.HUD.openMap();
        return;
      }
      // Nama tak dikenal: fallback gameplay berkendara.
      SB.Shots.cam = { mode: 'chase' };
    }
  };
})();
