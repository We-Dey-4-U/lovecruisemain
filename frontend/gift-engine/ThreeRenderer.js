/* ============================================================
   gift-engine/ThreeRenderer.js   [NEW FILE]
   Fullscreen transparent WebGL canvas layered above the
   livestream video. Pointer events disabled so it never blocks
   taps on the stream/comments/gift sheet underneath.
   ============================================================ */
/* ============================================================
   gift-engine/ThreeRenderer.js
   ============================================================ */
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { ParticleSystem } from "./ParticleSystem.js";

export class ThreeRenderer {

    constructor(containerEl) {

        this.container = containerEl;

        this.reducedMotion =
            window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        this.scene = new THREE.Scene();

        this.scene.fog = new THREE.FogExp2(
            0x000000,
            0.015
        );

        this.camera = new THREE.PerspectiveCamera(
            50,
            1,
            0.1,
            200
        );

        this.camera.position.set(0, 0, 8);
        this.camera.lookAt(0, 0, 0);

        this.cameraHome = this.camera.position.clone();

        this.renderer = new THREE.WebGLRenderer({

            alpha: true,
            antialias: true,
            powerPreference: "high-performance"

        });

        this.renderer.setClearColor(0x000000, 0);

        this.renderer.outputColorSpace =
            THREE.SRGBColorSpace;

        this.renderer.toneMapping =
            THREE.ACESFilmicToneMapping;

        this.renderer.toneMappingExposure = 1.2;

        this.renderer.shadowMap.enabled = true;

        this.renderer.shadowMap.type =
            THREE.PCFSoftShadowMap;

        this.renderer.domElement.style.cssText = `
            position:fixed;
            inset:0;
            width:100%;
            height:100%;
            pointer-events:none;
            z-index:15;
        `;

        this.container.appendChild(
            this.renderer.domElement
        );

        this.ambient =
            new THREE.AmbientLight(
                0xffffff,
                0.75
            );

        this.key =
            new THREE.DirectionalLight(
                0xffffff,
                1.8
            );

        this.key.position.set(5, 8, 6);
        this.key.castShadow = true;

        this.fill =
            new THREE.PointLight(
                0xff88cc,
                0.6,
                40
            );

        this.fill.position.set(-5, -3, 5);

        this.scene.add(
            this.ambient,
            this.key,
            this.fill
        );

        this.particles = new ParticleSystem(
            this.scene
        );

        this.activeObjects = [];
        this.mixers = [];

        this.clock = new THREE.Clock();

        this._running = true;

        this._resize();

        this.resizeHandler =
            () => this._resize();

        window.addEventListener(
            "resize",
            this.resizeHandler
        );

        this._loop();

    }

    _resize() {

        const w = window.innerWidth;
        const h = window.innerHeight;

        this.renderer.setPixelRatio(
            Math.min(window.devicePixelRatio || 1, 2)
        );

        this.renderer.setSize(w, h);

        this.camera.aspect = w / h;

        this.camera.updateProjectionMatrix();

    }

    addObject(obj) {

        if (!obj)
            return null;

        this.scene.add(obj);

        this.activeObjects.push(obj);

        return obj;

    }

    removeObject(obj) {

        if (!obj)
            return;

        this.scene.remove(obj);

        this.activeObjects =
            this.activeObjects.filter(o => o !== obj);

        obj.geometry?.dispose?.();
        obj.material?.dispose?.();

    }

    panCameraTo(x, y, z, duration = 800) {

        if (this.reducedMotion)
            return Promise.resolve();

        return new Promise(resolve => {

            const start =
                this.camera.position.clone();

            const target =
                new THREE.Vector3(x, y, z);

            const startTime =
                performance.now();

            const animate = (time) => {

                const progress =
                    Math.min(
                        1,
                        (time - startTime) / duration
                    );

                const eased =
                    1 - Math.pow(1 - progress, 3);

                this.camera.position.lerpVectors(
                    start,
                    target,
                    eased
                );

                this.camera.lookAt(0, 0, 0);

                if (progress < 1) {

                    requestAnimationFrame(animate);

                } else {

                    resolve();

                }

            };

            requestAnimationFrame(animate);

        });

    }

    resetCamera(duration = 600) {

        return this.panCameraTo(

            this.cameraHome.x,
            this.cameraHome.y,
            this.cameraHome.z,
            duration

        );

    }

    _loop() {

        if (!this._running)
            return;

        requestAnimationFrame(
            () => this._loop()
        );

        const dt =
            Math.min(
                this.clock.getDelta(),
                0.05
            );

        this.mixers.forEach(
            mixer => mixer.update(dt)
        );

        this.particles.update(dt);

        this.renderer.render(
            this.scene,
            this.camera
        );

    }

    dispose() {

        this._running = false;

        window.removeEventListener(
            "resize",
            this.resizeHandler
        );

        this.activeObjects.forEach(obj => {

            this.scene.remove(obj);

        });

        this.activeObjects.length = 0;

        this.mixers.length = 0;

        this.particles.dispose();

        this.renderer.dispose();

        this.renderer.domElement.remove();

    }

}