/**
 * Galaxy Spiral — additive point-cloud galaxy built from a single
 * BufferGeometry. Radius drives both the arm twist and a warm-to-cool
 * color ramp; AdditiveBlending makes overlapping points glow.
 */
import * as THREE from "three";
import type { RecipeMeta, SceneContext } from "../../engine/types";

const COUNT = 6000;
const INNER = new THREE.Color("#ffb36b");
const OUTER = new THREE.Color("#6b8cff");

function buildPositions(variant: string, branches: number, twist: number) {
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const color = new THREE.Color();

  for (let i = 0; i < COUNT; i++) {
    const radius = Math.pow(Math.random(), 0.6) * 4.2;
    let x = 0;
    let y = 0;
    let z = 0;

    if (variant === "shell") {
      // Uniform points on a sphere surface with a little radial jitter.
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const r = 3.4 + (Math.random() - 0.5) * 0.5;
      const s = Math.sqrt(1 - u * u);
      x = r * s * Math.cos(theta);
      y = r * u;
      z = r * s * Math.sin(theta);
    } else if (variant === "ring") {
      const angle = Math.random() * Math.PI * 2;
      const r = 3 + (Math.random() - 0.5) * 1.1;
      x = Math.cos(angle) * r;
      y = (Math.random() - 0.5) * 0.35;
      z = Math.sin(angle) * r;
    } else {
      // Spiral arms: branch angle + twist proportional to radius.
      const branch = ((i % branches) / branches) * Math.PI * 2;
      const angle = branch + radius * twist;
      const spread = Math.pow(Math.random(), 3) * 0.7;
      const sign = () => (Math.random() < 0.5 ? -1 : 1);
      x = Math.cos(angle) * radius + spread * sign();
      y = spread * sign() * 0.4;
      z = Math.sin(angle) * radius + spread * sign();
    }

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const t = Math.min(Math.hypot(x, z) / 4.2, 1);
    color.copy(INNER).lerp(OUTER, t);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  return { positions, colors };
}

const galaxySpiral: RecipeMeta = {
  slug: "galaxy-spiral",
  title: "Galaxy Spiral",
  category: "particles",
  description:
    "A 6,000-point galaxy from one BufferGeometry. Arm twist is a function of radius, colors ramp from core to rim, and AdditiveBlending does the glow — no textures, no post-processing.",
  tags: ["points", "buffergeometry", "additive"],
  variants: [
    { id: "spiral", label: "Spiral" },
    { id: "ring", label: "Ring" },
    { id: "shell", label: "Shell" },
  ],
  props: [
    { key: "spin", label: "Spin", min: 0, max: 1.5, step: 0.05, default: 0.3 },
    { key: "size", label: "Point size", min: 0.02, max: 0.14, step: 0.005, default: 0.055 },
    { key: "twist", label: "Twist", min: 0, max: 2, step: 0.1, default: 0.9, rebuild: true },
    { key: "branches", label: "Branches", min: 2, max: 8, step: 1, default: 4, rebuild: true },
  ],

  create({ scene, camera, variant, props }: SceneContext) {
    camera.position.set(0, 3.2, 7);
    camera.lookAt(0, 0, 0);

    const { positions, colors } = buildPositions(variant, props.branches, props.twist);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: props.size,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    let spin = props.spin;
    let twist = props.twist;
    let branches = props.branches;

    return {
      update(elapsed: number) {
        points.rotation.y = elapsed * spin;
      },
      applyProps(next) {
        if (next.twist !== twist || next.branches !== branches) {
          twist = next.twist;
          branches = next.branches;
          return false; // positions depend on these — rebuild
        }
        spin = next.spin;
        material.size = next.size;
        return true;
      },
    };
  },
};

export default galaxySpiral;
