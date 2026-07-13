/* ============================================================
   gift-engine/ModelLoader.js
   ------------------------------------------------------------
   Loads and caches GLB models.

   Features
   ✓ Lazy loading
   ✓ Automatic caching
   ✓ Clone on request
   ✓ Safe fallback (returns null)
   ✓ Never throws to caller
   ============================================================ */

/* ============================================================
   gift-engine/ModelLoader.js   [NEW FILE]
   ------------------------------------------------------------
   Loads and caches GLTF/GLB models using Three.js GLTFLoader.
   If a model fails to load, null is returned so the animation
   engine falls back to procedural geometry without crashing.
   ============================================================ */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

const loader = new GLTFLoader();
const cache = new Map();

export const ModelLoader = {

    async load(url) {

        if (!url)
            return null;

        if (cache.has(url))
            return cache.get(url);

        try {

            const gltf = await new Promise((resolve, reject) => {

                loader.load(
                    url,
                    resolve,
                    undefined,
                    reject
                );

            });

            cache.set(url, gltf);

            return gltf;

        } catch (err) {

            console.warn(
                "[ModelLoader] Failed to load:",
                url,
                err
            );

            cache.set(url, null);

            return null;

        }

    },

    async clone(url) {

        const gltf = await this.load(url);

        if (!gltf)
            return null;

        return gltf.scene.clone(true);

    },

    has(url) {

        return cache.has(url);

    },

    clear(url) {

        if (url) {

            cache.delete(url);

            return;

        }

        cache.clear();

    }

};