/* ============================================================
   gift-engine/AssetLoader.js
   ------------------------------------------------------------
   Central Asset Loader
   Supports:

   ✓ GLB Models (delegates to ModelLoader.js — single cache,
     single GLTFLoader/DRACOLoader instance, no duplication)
   ✓ Textures
   ✓ Audio
   ✓ Lazy Loading
   ✓ Caching
   ✓ Preloading
   ✓ Safe Fallbacks

   Every loader resolves to null instead of throwing so the
   livestream never crashes because of missing assets.
   ============================================================ */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { ModelLoader } from "./ModelLoader.js";

const textureCache = new Map();
const audioCache = new Map();

const textureLoader = new THREE.TextureLoader();

export const AssetLoader = {

    /* =======================================================
       MODEL LOADING
       Delegated entirely to ModelLoader.js so there is exactly
       ONE GLTFLoader/DRACOLoader instance and ONE model cache
       in the whole engine, instead of two competing ones.
    ======================================================= */

    async loadModel(url) {

        return ModelLoader.load(url);

    },

    /* =======================================================
       TEXTURE LOADING
    ======================================================= */

    async loadTexture(url) {

        if (!url) return null;

        if (textureCache.has(url))
            return textureCache.get(url);

        try {

            const texture = await new Promise((resolve, reject) => {

                textureLoader.load(
                    url,
                    resolve,
                    undefined,
                    reject
                );

            });

            texture.colorSpace = THREE.SRGBColorSpace;

            textureCache.set(url, texture);

            return texture;

        } catch (err) {

            console.warn(
                "[AssetLoader] Texture failed:",
                url,
                err
            );

            textureCache.set(url, null);

            return null;

        }

    },

    /* =======================================================
       AUDIO
    ======================================================= */

    async loadAudio(url) {

        if (!url)
            return null;

        if (audioCache.has(url))
            return audioCache.get(url);

        try {

            const audio = new Audio(url);

            audio.preload = "auto";

            await new Promise((resolve, reject) => {

                audio.addEventListener(
                    "canplaythrough",
                    resolve,
                    { once: true }
                );

                audio.addEventListener(
                    "error",
                    reject,
                    { once: true }
                );

                setTimeout(resolve, 1500);

            });

            audioCache.set(url, audio);

            return audio;

        } catch (err) {

            console.warn(
                "[AssetLoader] Audio failed:",
                url
            );

            audioCache.set(url, null);

            return null;

        }

    },

    /* =======================================================
       PRELOAD
    ======================================================= */

    preloadModels(list = []) {

        list
            .filter(Boolean)
            .forEach(path => ModelLoader.load(path));

    },

    preloadTextures(list = []) {

        list
            .filter(Boolean)
            .forEach(path => this.loadTexture(path));

    },

    preloadAudio(list = []) {

        list
            .filter(Boolean)
            .forEach(path => this.loadAudio(path));

    },

    preload(configs = []) {

        configs.forEach(cfg => {

            if (cfg.modelUrl)
                ModelLoader.load(cfg.modelUrl);

            if (cfg.textureUrl)
                this.loadTexture(cfg.textureUrl);

            if (cfg.sound)
                this.loadAudio(cfg.sound);

        });

    },

    /* =======================================================
       CACHE HELPERS
    ======================================================= */

    hasModel(url) {
        return ModelLoader.has(url);
    },

    hasTexture(url) {
        return textureCache.has(url);
    },

    hasAudio(url) {
        return audioCache.has(url);
    },

    clearCache() {

        textureCache.forEach(texture => {

            texture?.dispose?.();

        });

        ModelLoader.clear();
        textureCache.clear();
        audioCache.clear();

    }

};