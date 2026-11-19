// Sunset Bay — water module (v7, written fresh from SPEC)
// Sea west (x < -280) and south (z > 280) of the city, with a drivable
// speedboat moored at the Marina Bay pier.
(function () {
  var SB = window.SB = window.SB || {};

  var SEA_X = -280, SEA_Z = 280;          // shoreline
  var DOCK = { x: -278, z: 40 };          // land end of the pier
  var PIER = { x0: -296, z0: 36, x1: -278, z1: 44 };
  var BOAT_HOME = { x: -292, z: 50, yaw: Math.PI / 2 };

  var keys = {};
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", function (e) { keys[e.key.toLowerCase()] = true; });
    window.addEventListener("keyup", function (e) { keys[e.key.toLowerCase()] = false; });
  }

  function quad(x0, z0, x1, z1, y, cr, cg, cb) {
    var pos = new Float32Array([
      x0, y, z0, x1, y, z0, x1, y, z1,
      x0, y, z0, x1, y, z1, x0, y, z1
    ]);
    var col = new Float32Array(18);
    var v;
    for (v = 0; v < 6; v++) { col[v * 3] = cr; col[v * 3 + 1] = cg; col[v * 3 + 2] = cb; }
    return SB.GL.mesh(pos, col);
  }

  function inWater(x, z) {
    return x < SEA_X + 2 || z > SEA_Z - 2;
  }

  var Water = {
    boat: { x: BOAT_HOME.x, z: BOAT_HOME.z, yaw: BOAT_HOME.yaw, speed: 0 },
    _seaMeshes: null,
    _pierMesh: null,
    _boatMesh: null,
    _time: 0,

    init: function () {
      this.boat = { x: BOAT_HOME.x, z: BOAT_HOME.z, yaw: BOAT_HOME.yaw, speed: 0 };
      this._seaMeshes = null;
      this._pierMesh = null;
      this._boatMesh = null;
      this._time = 0;
    },

    // Board the speedboat when the player stands close to it.
    boardBoat: function () {
      var p = SB.G && SB.G.player;
      if (!p || p.inCar || p.inBoat) return false;
      var dx = p.x - this.boat.x, dz = p.z - this.boat.z;
      if (dx * dx + dz * dz > 49) return false; // within 7 units
      p.inBoat = true;
      p.inCar = false;
      p.car = null;
      if (SB.HUD) SB.HUD.showMessage("Speedboat — W gas, S rem, A/D belok, E turun");
      return true;
    },

    // Step off the boat onto the pier / shore.
    leaveBoat: function () {
      var p = SB.G && SB.G.player;
      if (!p || !p.inBoat) return false;
      p.inBoat = false;
      this.boat.speed = 0;
      // Drop the player on the pier if close, else on the nearest shore.
      if (Math.abs(this.boat.z - 40) < 30 && this.boat.x > -310) {
        p.x = DOCK.x; p.z = DOCK.z;
      } else if (this.boat.x < SEA_X) {
        p.x = SEA_X + 4; p.z = Math.max(-276, Math.min(276, this.boat.z));
      } else {
        p.x = Math.max(-276, Math.min(276, this.boat.x)); p.z = SEA_Z - 4;
      }
      p.speed = 0;
      return true;
    },

    update: function (dt) {
      this._time += dt;
      var p = SB.G && SB.G.player;
      if (!p || !p.inBoat) return;
      var b = this.boat;
      // Throttle / brake.
      if (keys["w"] || keys["arrowup"]) b.speed += 14 * dt;
      else if (keys["s"] || keys["arrowdown"]) b.speed -= 18 * dt;
      else b.speed -= Math.sign(b.speed) * 6 * dt;
      if (b.speed > 26) b.speed = 26;
      if (b.speed < -6) b.speed = -6;
      if (Math.abs(b.speed) < 0.2 && !keys["w"] && !keys["s"]) b.speed = 0;
      // Steering scales with speed.
      var steer = 0;
      if (keys["a"] || keys["arrowleft"]) steer += 1;
      if (keys["d"] || keys["arrowright"]) steer -= 1;
      b.yaw += steer * 1.5 * dt * Math.min(1, Math.abs(b.speed) / 8);
      var nx = b.x + Math.sin(b.yaw) * b.speed * dt;
      var nz = b.z + Math.cos(b.yaw) * b.speed * dt;
      // Stay in the water: reject moves that beach the boat on land.
      if (inWater(nx, nz)) { b.x = nx; b.z = nz; }
      else { b.speed *= 0.4; }
      // Soft bounds so the boat cannot sail forever.
      if (b.x < -680) { b.x = -680; b.speed *= 0.5; }
      if (b.x > SEA_X + 2 && b.z < SEA_Z - 2) { b.x = SEA_X + 2; b.speed *= 0.5; }
      if (b.z > 680) { b.z = 680; b.speed *= 0.5; }
      p.x = b.x; p.z = b.z; p.yaw = b.yaw; p.speed = b.speed;
    },

    draw: function () {
      if (!SB.GL || !SB.GL.draw) return;
      if (!this._seaMeshes) {
        this._seaMeshes = [
          quad(-700, -700, SEA_X - 2, 700, 0.25, 0.05, 0.32, 0.55),
          quad(SEA_X - 2, SEA_Z + 2, 700, 700, 0.25, 0.05, 0.32, 0.55),
          quad(-700, SEA_Z + 2, SEA_X - 2, 700, 0.25, 0.05, 0.32, 0.55)
        ];
      }
      var I = SB.Math3.mat4Identity();
      var i;
      for (i = 0; i < this._seaMeshes.length; i++) SB.GL.draw(this._seaMeshes[i], I);
      // Wooden pier from the Marina Bay shore out to the boat.
      if (!this._pierMesh) {
        this._pierMesh = quad(PIER.x0, PIER.z0, PIER.x1, PIER.z1, 0.6, 0.45, 0.32, 0.18);
      }
      SB.GL.draw(this._pierMesh, I);
      // Speedboat, bobbing gently.
      if (SB.Meshes && SB.Meshes.boat) {
        if (!this._boatMesh) this._boatMesh = SB.Meshes.boat();
        var bob = Math.sin(this._time * 1.6) * 0.12;
        var m = SB.Math3.mat4Mul(
          // Lambung kapal mulai y=0.1; alas 0.1 menaruhnya pas di air (y=0.25).
          SB.Math3.mat4Translate(this.boat.x, 0.1 + bob, this.boat.z),
          SB.Math3.mat4RotateY(this.boat.yaw)
        );
        SB.GL.draw(this._boatMesh, m);
      }
    }
  };

  SB.Water = Water;
})();
