/**
 * Wireframe Terrain — a plane displaced on the CPU with fractal value
 * noise that scrolls over time. The position attribute mutates in place;
 * the solid variant recomputes vertex normals each frame for lighting.
 */
import * as THREE from "three";
import { fbm2 } from "../../engine/noise";
import type { RecipeMeta, SceneContext } from "../../engine/types";

const SIZE = 15;
const SEGMENTS = 88;

const wireframeTerrain: RecipeMeta = {
  slug: "wireframe-terrain",
  title: "Wireframe Terrain",
  category: "geometry",
  description:
    "CPU displacement with fractal Brownian motion: four octaves of value noise scrolled over time. One geometry serves a glowing wireframe, a lit solid, and a layered ridge treatment.",
  tags: ["fbm", "displacement", "attribute-update"],
  variants: [
    { id: "wire", label: "Wireframe" },
    { id: "solid", label: "Solid" },
    { id: "ridge", label: "Ridge" },
  ],
  props: [
    { key: "amplitude", label: "Amplitude", min: 0, max: 3, step: 0.1, default: 1.5 },
    { key: "scale", label: "Noise scale", min: 0.1, max: 1, step: 0.05, default: 0.35 },
    { key: "speed", label: "Scroll speed", min: 0, max: 2, step: 0.05, default: 0.4 },
  ],

  create({ scene, camera, variant, props }: SceneContext) {
    camera.position.set(0, 4.2, 8.5);
    camera.lookAt(0, -0.5, 0);

    const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
    geometry.rotateX(-Math.PI / 2);
    const attr = geometry.getAttribute("position") as THREE.BufferAttribute;

    let surface: THREE.Object3D;
    const needsNormals = variant === "solid";

    if (variant === "solid") {
      const material = new THREE.MeshStandardMaterial({
        color: 0x4a6a5a,
        flatShading: true,
        roughness: 0.85,
      });
      surface = new THREE.Mesh(geometry, material);
      scene.add(new THREE.AmbientLight(0xffffff, 0.2));
      const sun = new THREE.DirectionalLight(0xffe8c8, 1.8);
      sun.position.set(3, 6, 2);
      scene.add(sun);
    } else if (variant === "ridge") {
      const group = new THREE.Group();
      group.add(
        new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({ color: 0x0d1210 }),
        ),
      );
      const wire = new THREE.Mesh(
        geometry.clone(),
        new THREE.MeshBasicMaterial({ color: 0x7fd0aa, wireframe: true }),
      );
      wire.position.y = 0.02;
      group.add(wire);
      surface = group;
    } else {
      surface = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: 0x7fd0aa, wireframe: true }),
      );
    }
    scene.add(surface);

    // Ridge keeps a cloned geometry in sync with the displaced original.
    const mirrors: THREE.BufferAttribute[] = [];
    surface.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry && mesh.geometry !== geometry) {
        mirrors.push(mesh.geometry.getAttribute("position") as THREE.BufferAttribute);
      }
    });

    let params = { ...props };

    function displace(time: number): void {
      const { amplitude, scale, speed } = params;
      for (let i = 0; i < attr.count; i++) {
        const x = attr.getX(i);
        const z = attr.getZ(i);
        const h = fbm2(x * scale + time * speed, z * scale) - 0.5;
        attr.setY(i, h * amplitude * 2);
      }
      attr.needsUpdate = true;
      for (const mirror of mirrors) {
        (mirror.array as Float32Array).set(attr.array as Float32Array);
        mirror.needsUpdate = true;
      }
      if (needsNormals) geometry.computeVertexNormals();
    }

    displace(0);

    return {
      update(elapsed: number) {
        displace(elapsed);
      },
      applyProps(next) {
        params = { ...next };
        return true;
      },
    };
  },
};

export default wireframeTerrain;
