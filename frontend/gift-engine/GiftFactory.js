/* ============================================================
   gift-engine/GiftFactory.js   [NEW FILE]
   Builds the 3D mesh for a gift. Ships with procedural placeholder
   shapes (no binary .glb assets included in this patch) so the
   engine works out of the box. To use real 3D models later: drop
   .glb files into /assets/models/ and extend buildMesh() to use
   GLTFLoader keyed off cfg.modelUrl — no other engine file changes
   needed (req #14, Future Expansion).
   ============================================================ */
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { AssetLoader } from "./AssetLoader.js";

function heartGeometry() {
    const shape = new THREE.Shape();

    shape.moveTo(0, 0.4);
    shape.bezierCurveTo(0, 0.9, -0.9, 0.9, -0.9, 0.3);
    shape.bezierCurveTo(-0.9, -0.3, 0, -0.6, 0, -1.1);
    shape.bezierCurveTo(0, -0.6, 0.9, -0.3, 0.9, 0.3);
    shape.bezierCurveTo(0.9, 0.9, 0, 0.9, 0, 0.4);

    return new THREE.ExtrudeGeometry(shape, {
        depth: 0.25,
        bevelEnabled: true,
        bevelSize: 0.05,
        bevelThickness: 0.05
    });
}

function buildGeometry(shape) {

    switch (shape) {

        case "heart":
            return heartGeometry();

        case "star":
            return new THREE.IcosahedronGeometry(0.7);

        case "ring":
            return new THREE.TorusGeometry(0.7, 0.22, 16, 48);

        case "diamond":
            return new THREE.OctahedronGeometry(0.8);

        case "box":
            return new THREE.BoxGeometry(1,1,1);

        case "cone":
            return new THREE.ConeGeometry(0.6,1.4,24);

        case "flower":
            return new THREE.TorusKnotGeometry(0.45,0.16,64,8);

        default:
            return new THREE.SphereGeometry(0.7,24,24);

    }

}

function applyShadows(object){

    object.traverse(child=>{

        if(child.isMesh){

            child.castShadow=true;
            child.receiveShadow=true;

        }

    });

}

function applyMaterial(object,cfg){

    object.traverse(child=>{

        if(!child.isMesh) return;

        child.material=new THREE.MeshPhysicalMaterial({

            color:cfg.color,

            metalness:
                cfg.tier==="legendary"
                ?0.95
                :cfg.tier==="premium"
                ?0.75
                :0.35,

            roughness:0.22,

            transmission:0,

            clearcoat:1,

            clearcoatRoughness:0.05,

            emissive:new THREE.Color(cfg.color),

            emissiveIntensity:
                cfg.tier==="legendary"
                ?1.2
                :cfg.tier==="premium"
                ?0.6
                :0.2

        });

    });

}




async function buildFromModel(cfg) {

    if (!cfg.modelUrl)
        return null;

    const gltf = await AssetLoader.loadModel(cfg.modelUrl);

    if (!gltf)
        return null;

    const model = gltf.scene.clone(true);

    applyMaterial(model, cfg);
    applyShadows(model);

    model.scale.setScalar(
        cfg.scale ||
        (
            cfg.tier === "legendary"
                ? 1.5
                : cfg.tier === "premium"
                ? 1.15
                : 0.75
        )
    );

    return model;

}

async function buildFromTexture(cfg) {

    if (!cfg.textureUrl)
        return null;

    const texture = await AssetLoader.loadTexture(cfg.textureUrl);

    if (!texture)
        return null;

    const material = new THREE.SpriteMaterial({

        map: texture,

        transparent: true,

        depthWrite: false,

        color: cfg.color

    });

    const sprite = new THREE.Sprite(material);

    sprite.scale.set(
        cfg.spriteScale || 2,
        cfg.spriteScale || 2,
        1
    );

    return sprite;

}

function buildProcedural(cfg) {

    const geometry = buildGeometry(cfg.shape);

    const material = new THREE.MeshPhysicalMaterial({

        color: cfg.color,

        metalness:
            cfg.tier === "legendary"
                ? 0.95
                : cfg.tier === "premium"
                ? 0.75
                : 0.3,

        roughness: 0.2,

        clearcoat: 1,

        clearcoatRoughness: 0.05,

        emissive: cfg.color,

        emissiveIntensity:
            cfg.tier === "legendary"
                ? 1.2
                : cfg.tier === "premium"
                ? 0.6
                : 0.15

    });

    const mesh = new THREE.Mesh(
        geometry,
        material
    );

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    mesh.scale.setScalar(

        cfg.scale ||

        (
            cfg.tier === "legendary"
                ? 1.35
                : cfg.tier === "premium"
                ? 1
                : 0.6
        )

    );

    return mesh;

}




export const GiftFactory = {

    async buildMesh(cfg) {

        // =====================================================
        // 1. Try GLB Model
        // =====================================================

        try {

            const model = await buildFromModel(cfg);

            if (model)
                return model;

        } catch (err) {

            console.warn(
                "[GiftFactory] Model fallback:",
                err
            );

        }

        // =====================================================
        // 2. Try PNG Sprite
        // =====================================================

        try {

            const sprite = await buildFromTexture(cfg);

            if (sprite)
                return sprite;

        } catch (err) {

            console.warn(
                "[GiftFactory] Texture fallback:",
                err
            );

        }

        // =====================================================
        // 3. Procedural Geometry
        // =====================================================

        return buildProcedural(cfg);

    },

    async preload(cfgList = []) {

        for (const cfg of cfgList) {

            if (cfg.modelUrl)
                AssetLoader.loadModel(cfg.modelUrl);

            if (cfg.textureUrl)
                AssetLoader.loadTexture(cfg.textureUrl);

            if (cfg.sound)
                AssetLoader.loadAudio(cfg.sound);

        }

    },

    clone(object) {

        if (!object)
            return null;

        return object.clone(true);

    },

    dispose(object) {

        if (!object)
            return;

        object.traverse(child => {

            if (child.geometry)
                child.geometry.dispose();

            if (child.material) {

                if (Array.isArray(child.material)) {

                    child.material.forEach(mat => mat.dispose());

                } else {

                    child.material.dispose();

                }

            }

        });

    }

};