/**
 * Starfield Warp — stars streamed toward the camera by mutating the
 * position attribute every frame and wrapping depth. The classic
 * "hyperspace" feel comes purely from sizeAttenuation + speed.
 */
import * as THREE from "three";
import type { RecipeMeta, SceneContext } from "../../engine/types";

const COUNT = 2400;
const DEPTH = 60;

const starfieldWarp: RecipeMeta = {
  slug: "starfield-warp",
  title: "Starfield Warp",
  category: "particles",
  description:
    "2,400 stars wrapped in a scrolling depth window. Positions mutate in place each frame — the geometry is allocated once and the attribute is flagged for re-upload, which keeps the GC silent.",
  tags: ["points", "attribute-update", "motion"],
  variants: [
    { id: "warp", label: "Warp" },
    { id: "drift", label: "Drift" },
  ],
  props: [
    { key: "speed", label: "Speed", min: 0, max: 3, step: 0.1, default: 1.2 },
    { key: "size", label: "Star size", min: 0.02, max: 0.2, step: 0.01, default: 0.07 },
    { key: "spread", label: "Spread", min: 4, max: 16, step: 0.5, default: 9, rebuild: true },
  ],

  create({ scene, camera, variant, props }: SceneContext) {
    camera.position.set(0, 0, 0.1);
    camera.lookAt(0, 0, -1);

    const positions = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * props.spread;
      positions[i * 3 + 1] = (Math.random() - 0.5) * props.spread;
      positions[i * 3 + 2] = -Math.random() * DEPTH;
    }

    const geometry = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(positions, 3);
    geometry.setAttribute("position", attr);

    const material = new THREE.PointsMaterial({
      color: 0xdde4f5,
      size: props.size,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    let speed = props.speed;
    let spread = props.spread;
    const lateral = variant === "drift" ? 0.35 : 0;
    const forward = variant === "drift" ? 1.4 : 9;

    return {
      update(elapsed: number, dt: number) {
        const arr = attr.array as Float32Array;
        for (let i = 0; i < COUNT; i++) {
          arr[i * 3 + 2] += forward * speed * dt;
          if (lateral > 0) {
            arr[i * 3] += Math.sin(elapsed * 0.6 + i) * lateral * dt;
          }
          if (arr[i * 3 + 2] > 1) {
            arr[i * 3] = (Math.random() - 0.5) * spread;
            arr[i * 3 + 1] = (Math.random() - 0.5) * spread;
            arr[i * 3 + 2] = -DEPTH;
          }
        }
        attr.needsUpdate = true;
      },
      applyProps(next) {
        if (next.spread !== spread) {
          spread = next.spread;
          return false;
        }
        speed = next.speed;
        material.size = next.size;
        return true;
      },
    };
  },
};

export default starfieldWarp;
