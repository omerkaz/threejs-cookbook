/**
 * Lissajous Orbits — orbs riding closed parametric curves. Each trail
 * is the full curve sampled once into a LineLoop; the orb just evaluates
 * the same parametric function at the current time. Zero per-frame allocs.
 */
import * as THREE from "three";
import type { RecipeMeta, SceneContext } from "../../engine/types";

const TRAIL_SAMPLES = 360;

interface Ratio {
  a: number;
  b: number;
  wobble: number;
}

function ratioFor(variant: string): Ratio {
  switch (variant) {
    case "fivefour":
      return { a: 5, b: 4, wobble: 0 };
    case "chaos":
      return { a: 7, b: 5, wobble: 1 };
    default:
      return { a: 3, b: 2, wobble: 0 };
  }
}

function evaluate(t: number, i: number, count: number, r: Ratio, out: THREE.Vector3): void {
  const phase = (i / count) * Math.PI * 2;
  const s = 3.1;
  out.set(
    Math.sin(r.a * t + phase) * s,
    Math.sin(r.b * t + phase * 0.5) * s * 0.62,
    r.wobble ? Math.sin((r.a + r.b) * 0.5 * t + phase) * 1.4 : 0,
  );
}

const lissajousOrbits: RecipeMeta = {
  slug: "lissajous-orbits",
  title: "Lissajous Orbits",
  category: "animation",
  description:
    "Parametric motion: x and y are sine waves with different integer frequencies, and the frequency ratio decides the figure. Trails are LineLoops sampled once — the orbs simply re-evaluate the curve.",
  tags: ["parametric", "lineloop", "motion"],
  variants: [
    { id: "threetwo", label: "Ratio 3:2" },
    { id: "fivefour", label: "Ratio 5:4" },
    { id: "chaos", label: "Ratio 7:5 + Z" },
  ],
  props: [
    { key: "speed", label: "Speed", min: 0, max: 2, step: 0.05, default: 0.45 },
    { key: "orbs", label: "Orbs", min: 1, max: 8, step: 1, default: 4, rebuild: true },
    { key: "orbSize", label: "Orb size", min: 0.05, max: 0.3, step: 0.01, default: 0.14 },
  ],

  create({ scene, camera, variant, props }: SceneContext) {
    camera.position.set(0, 0, 9);
    camera.lookAt(0, 0, 0);

    const ratio = ratioFor(variant);
    const count = props.orbs;
    const cursor = new THREE.Vector3();
    const orbGeometry = new THREE.SphereGeometry(1, 24, 24);
    const orbs: { mesh: THREE.Mesh; index: number }[] = [];

    for (let i = 0; i < count; i++) {
      const color = new THREE.Color().setHSL(0.55 + (i / Math.max(count, 1)) * 0.35, 0.7, 0.65);

      // Trail: sample the full closed curve once.
      const positions = new Float32Array(TRAIL_SAMPLES * 3);
      for (let s = 0; s < TRAIL_SAMPLES; s++) {
        evaluate((s / TRAIL_SAMPLES) * Math.PI * 2, i, count, ratio, cursor);
        cursor.toArray(positions, s * 3);
      }
      const trailGeometry = new THREE.BufferGeometry();
      trailGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      scene.add(
        new THREE.LineLoop(
          trailGeometry,
          new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.28 }),
        ),
      );

      const mesh = new THREE.Mesh(orbGeometry, new THREE.MeshBasicMaterial({ color }));
      mesh.scale.setScalar(props.orbSize);
      scene.add(mesh);
      orbs.push({ mesh, index: i });
    }

    let speed = props.speed;
    let orbCount = props.orbs;

    return {
      update(elapsed: number) {
        const t = elapsed * speed;
        for (const { mesh, index } of orbs) {
          evaluate(t, index, orbCount, ratio, cursor);
          mesh.position.copy(cursor);
        }
      },
      applyProps(next) {
        if (next.orbs !== orbCount) {
          orbCount = next.orbs;
          return false;
        }
        speed = next.speed;
        for (const { mesh } of orbs) mesh.scale.setScalar(next.orbSize);
        return true;
      },
    };
  },
};

export default lissajousOrbits;
