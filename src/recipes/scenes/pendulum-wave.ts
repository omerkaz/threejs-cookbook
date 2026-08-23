/**
 * Pendulum Wave — the science-museum classic. Every pendulum swings at
 * a slightly different frequency, so the row drifts through travelling
 * waves, chaos, and perfect unison on a fixed cycle.
 */
import * as THREE from "three";
import type { RecipeMeta, SceneContext } from "../../engine/types";

const CYCLE = 24; // seconds until all pendulums realign

const pendulumWave: RecipeMeta = {
  slug: "pendulum-wave",
  title: "Pendulum Wave",
  category: "animation",
  description:
    "Each pendulum completes an integer number of swings per cycle — one more than its neighbour. Phase differences accumulate into travelling waves that resolve back to unison every cycle.",
  tags: ["phase", "group-transform", "physics"],
  variants: [
    { id: "spheres", label: "Spheres" },
    { id: "bars", label: "Bars" },
  ],
  props: [
    { key: "speed", label: "Speed", min: 0.1, max: 3, step: 0.05, default: 1 },
    { key: "swing", label: "Swing", min: 0.1, max: 0.9, step: 0.02, default: 0.55 },
    { key: "count", label: "Pendulums", min: 7, max: 25, step: 1, default: 15, rebuild: true },
  ],

  create({ scene, camera, variant, props }: SceneContext) {
    camera.position.set(0, -0.4, 9);
    camera.lookAt(0, -0.4, 0);

    const count = props.count;
    const topY = 2.8;
    const width = 8.4;

    // Support beam
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.8, 0.08, 0.08),
      new THREE.MeshBasicMaterial({ color: 0x3a3a42 }),
    );
    beam.position.y = topY;
    scene.add(beam);

    const rodGeometry = new THREE.CylinderGeometry(0.012, 0.012, 1, 6);
    const bobGeometry =
      variant === "bars"
        ? new THREE.BoxGeometry(0.34, 0.14, 0.14)
        : new THREE.SphereGeometry(0.16, 32, 32);

    const pendulums: { pivot: THREE.Group; omega: number }[] = [];

    for (let i = 0; i < count; i++) {
      const length = 3.6 - (i / count) * 1.4;
      const pivot = new THREE.Group();
      pivot.position.set((i / (count - 1) - 0.5) * width, topY, 0);
      scene.add(pivot);

      const rod = new THREE.Mesh(
        rodGeometry,
        new THREE.MeshBasicMaterial({ color: 0x55555e }),
      );
      rod.scale.y = length;
      rod.position.y = -length / 2;
      pivot.add(rod);

      const bob = new THREE.Mesh(
        bobGeometry,
        new THREE.MeshBasicMaterial({
          color: new THREE.Color().setHSL(0.52 + (i / count) * 0.3, 0.6, 0.62),
        }),
      );
      bob.position.y = -length;
      pivot.add(bob);

      // i-th pendulum makes (baseSwings + i) full swings per CYCLE.
      const omega = ((30 + i) * Math.PI * 2) / CYCLE;
      pendulums.push({ pivot, omega });
    }

    let speed = props.speed;
    let swing = props.swing;
    let pendulumCount = props.count;

    return {
      update(elapsed: number) {
        const t = elapsed * speed;
        for (const { pivot, omega } of pendulums) {
          pivot.rotation.z = Math.sin(omega * t) * swing;
        }
      },
      applyProps(next) {
        if (next.count !== pendulumCount) {
          pendulumCount = next.count;
          return false;
        }
        speed = next.speed;
        swing = next.swing;
        return true;
      },
    };
  },
};

export default pendulumWave;
