/* ============================================================
   gift-engine/ModelLoader.js
   ------------------------------------------------------------
   Loads and caches GLB/GLTF models.

   Features
   ✓ Lazy loading
   ✓ Automatic caching (by URL)
   ✓ Clone on request
   ✓ Draco compression support (falls back gracefully if a
     model isn't Draco-compressed — GLTFLoader auto-detects it
     per-model, so plain .glb files are unaffected)
   ✓ Safe fallback (returns null, never throws to caller)
   ============================================================ */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/DRACOLoader.js";

/* ============================================================
   DRACO SETUP
   One shared DRACOLoader instance, pointed at Google's hosted
   decoder (WASM, so no build step / bundling needed). GLTFLoader
   only invokes it when a model's KHR_draco_mesh_compression
   extension is present, so uncompressed .glb files load exactly
   as before — this is additive, not a behavior change for
   existing assets.
   ============================================================ */
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(
    "https://www.gstatic.com/draco/versioned/decoders/1.5.6/"
);
dracoLoader.setDecoderConfig({ type: "wasm" });

const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

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

    },

    /* =======================================================
       CLEANUP
       Releases the DRACOLoader's worker pool. Call this only
       on a full engine teardown (e.g. app-level unload), not
       per-gift or per-room — it's shared across every model.
       ======================================================= */
    disposeDracoWorkers() {

        try {

            dracoLoader.dispose();

        } catch (err) {

            console.warn(
                "[ModelLoader] DRACOLoader dispose failed:",
                err
            );

        }

    }

};