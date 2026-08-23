/**
 * Polyhedra Lab — flat-shaded platonic solids under a two-light rig.
 * Detail is the polyhedron subdivision level; roughness and metalness
 * write straight onto the material, so only Detail forces a rebuild.
 */
import * as THREE from "three";
import type { RecipeMeta, SceneContext } from "../../engine/types";

function buildGeometry(variant: string, detail: number): THREE.BufferGeometry {
  switch (variant) {
    case "dodeca":
      return new THREE.DodecahedronGeometry(2.4, detail);
    case "octa":
      return new THREE.OctahedronGeometry(2.6, detail);
    case "knot":
      return new THREE.TorusKnotGeometry(1.6, 0.5, 64 + detail * 64, 12 + detail * 8);
    default:
      return new THREE.IcosahedronGeometry(2.5, detail);
  }
}

const polyhedraLab: RecipeMeta = {
  slug: "polyhedra-lab",
  title: "Polyhedra Lab",
  category: "geometry",
  description:
    "Platonic solids with flatShading, which duplicates vertices per face so every facet catches light on its own. Subdivision detail shows how the same primitive walks toward a sphere.",
  tags: ["primitives", "flat-shading", "subdivision"],
  variants: [
    { id: "icosa", label: "Icosahedron" },
    { id: "dodeca", label: "Dodecahedron" },
    { id: "octa", label: "Octahedron" },
    { id: "knot", label: "Torus Knot" },
  ],
  props: [
    { key: "spin", label: "Spin", min: 0, max: 1.5, step: 0.05, default: 0.35 },
    { key: "roughness", label: "Roughness", min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: "metalness", label: "Metalness", min: 0, max: 1, step: 0.05, default: 0.25 },
    { key: "detail", label: "Detail", min: 0, max: 3, step: 1, default: 0, rebuild: true },
  ],

  create({ scene, camera, variant, props }: SceneContext) {
    camera.position.set(0, 0.6, 8);
    camera.lookAt(0, 0, 0);

    const material = new THREE.MeshStandardMaterial({
      color: 0xb8c4d8,
      flatShading: true,
      roughness: props.roughness,
      metalness: props.metalness,
    });

    const mesh = new THREE.Mesh(buildGeometry(variant, props.detail), material);
    scene.add(mesh);

    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    const key = new THREE.DirectionalLight(0xfff2e0, 2.2);
    key.position.set(4, 5, 3);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x7fa0ff, 0.9);
    fill.position.set(-5, -2, 4);
    scene.add(fill);

    let spin = props.spin;
    let detail = props.detail;

    return {
      update(elapsed: number) {
        mesh.rotation.y = elapsed * spin;
        mesh.rotation.x = elapsed * spin * 0.45;
      },
      applyProps(next) {
        if (next.detail !== detail) {
          detail = next.detail;
          return false;
        }
        spin = next.spin;
        material.roughness = next.roughness;
        material.metalness = next.metalness;
        return true;
      },
    };
  },
};

export default polyhedraLab;
