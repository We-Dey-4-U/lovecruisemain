/* ============================================================
   gift-engine/ThreeRenderer.js   [NEW FILE]
   Fullscreen transparent WebGL canvas layered above the
   livestream video. Pointer events disabled so it never blocks
   taps on the stream/comments/gift sheet underneath.
   ============================================================ */
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { ParticleSystem } from "./ParticleSystem.js";

export class ThreeRenderer {
  constructor(containerEl) {
    this.container = containerEl;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.camera.position.set(0, 0, 8);
    this.cameraHome = this.camera.position.clone();

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.style.cssText =
      "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:15;";
    this.container.appendChild(this.renderer.domElement);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.key = new THREE.PointLight(0xffffff, 1.2, 50);
    this.key.position.set(3, 4, 6);
    this.scene.add(this.ambient, this.key);

    this.particles = new ParticleSystem(this.scene);

    this._resize();
    window.addEventListener("resize", () => this._resize());

    this.activeObjects = [];
    this._clock = new THREE.Clock();
    this._running = true;
    this._loop();
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  addObject(obj) {
    this.scene.add(obj);
    this.activeObjects.push(obj);
    return obj;
  }

  removeObject(obj) {
    this.scene.remove(obj);
    this.activeObjects = this.activeObjects.filter((o) => o !== obj);
    obj.geometry?.dispose?.();
    obj.material?.dispose?.();
  }

  panCameraTo(x, y, z, duration = 800) {
    if (this.reducedMotion) return Promise.resolve();
    return new Promise((resolve) => {
      const start = this.camera.position.clone();
      const target = new THREE.Vector3(x, y, z);
      const t0 = performance.now();
      const step = (t) => {
        const p = Math.min(1, (t - t0) / duration);
        const ease = 1 - Math.pow(1 - p, 3);
        this.camera.position.lerpVectors(start, target, ease);
        this.camera.lookAt(0, 0, 0);
        if (p < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  resetCamera(duration = 600) {
    return this.panCameraTo(this.cameraHome.x, this.cameraHome.y, this.cameraHome.z, duration);
  }

  _loop() {
    if (!this._running) return;
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this._clock.getDelta(), 0.05);
    this.particles.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this._running = false;
    this.particles.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}