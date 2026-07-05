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

function heartGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.4);
  shape.bezierCurveTo(0, 0.9, -0.9, 0.9, -0.9, 0.3);
  shape.bezierCurveTo(-0.9, -0.3, 0, -0.6, 0, -1.1);
  shape.bezierCurveTo(0, -0.6, 0.9, -0.3, 0.9, 0.3);
  shape.bezierCurveTo(0.9, 0.9, 0, 0.9, 0, 0.4);
  return new THREE.ExtrudeGeometry(shape, { depth: 0.25, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05 });
}

function buildGeometry(shape) {
  switch (shape) {
    case "heart": return heartGeometry();
    case "star": return new THREE.IcosahedronGeometry(0.7, 0);
    case "ring": return new THREE.TorusGeometry(0.7, 0.22, 16, 48);
    case "diamond": return new THREE.OctahedronGeometry(0.8, 0);
    case "box": return new THREE.BoxGeometry(1, 1, 1);
    case "cone": return new THREE.ConeGeometry(0.6, 1.4, 24);
    case "flower": return new THREE.TorusKnotGeometry(0.45, 0.16, 64, 8);
    default: return new THREE.SphereGeometry(0.7, 24, 24);
  }
}

export const GiftFactory = {
  buildMesh(cfg) {
    const geometry = buildGeometry(cfg.shape);
    const material = new THREE.MeshStandardMaterial({
      color: cfg.color,
      metalness: cfg.tier === "legendary" ? 0.9 : cfg.tier === "premium" ? 0.6 : 0.2,
      roughness: 0.25,
      emissive: cfg.color,
      emissiveIntensity: cfg.tier === "legendary" ? 0.55 : cfg.tier === "premium" ? 0.3 : 0.1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(cfg.tier === "legendary" ? 1.3 : cfg.tier === "premium" ? 1.0 : 0.6);
    return mesh;
  },
};