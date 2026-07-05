/* ============================================================
   gift-engine/ParticleSystem.js   [NEW FILE]
   GPU-instanced particle burst (sparkles/confetti/glow trail).
   Uses an object pool so repeated bursts don't allocate garbage
   (req #7 performance: object pooling).
   ============================================================ */
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const POOL_SIZE = 400;

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(POOL_SIZE * 3);
    this.velocities = new Float32Array(POOL_SIZE * 3);
    this.life = new Float32Array(POOL_SIZE).fill(0);
    this.maxLife = new Float32Array(POOL_SIZE).fill(0);
    this.colors = new Float32Array(POOL_SIZE * 3);

    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));

    this.material = new THREE.PointsMaterial({
      size: 0.12,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.scene.add(this.points);
    this.cursor = 0;
  }

  burst({ origin = [0, 0, 0], count = 60, color = 0xffc857, spread = 2.2, speed = 1.6 } = {}) {
    const c = new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % POOL_SIZE;

      this.positions[i * 3 + 0] = origin[0];
      this.positions[i * 3 + 1] = origin[1];
      this.positions[i * 3 + 2] = origin[2];

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      this.velocities[i * 3 + 0] = Math.sin(phi) * Math.cos(theta) * speed * spread * Math.random();
      this.velocities[i * 3 + 1] = Math.cos(phi) * speed * spread * Math.random() + 0.6;
      this.velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed * spread * Math.random();

      this.colors[i * 3 + 0] = c.r;
      this.colors[i * 3 + 1] = c.g;
      this.colors[i * 3 + 2] = c.b;

      this.maxLife[i] = 0.9 + Math.random() * 0.6;
      this.life[i] = this.maxLife[i];
    }
    this.geometry.attributes.color.needsUpdate = true;
  }

  update(dt) {
    for (let i = 0; i < POOL_SIZE; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.positions[i * 3 + 0] += this.velocities[i * 3 + 0] * dt;
      this.positions[i * 3 + 1] += (this.velocities[i * 3 + 1] - 1.2 * dt) * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
      if (this.life[i] <= 0) {
        this.positions[i * 3 + 1] = -9999; // park offscreen, reused by pool
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}