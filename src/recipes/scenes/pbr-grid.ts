/**
 * PBR Study Grid — the canonical roughness × metalness chart, live.
 * Rows sweep metalness, columns sweep roughness; every cell has its
 * own material, so hue and spacing update without a rebuild.
 */
import * as THREE from "three";
import type { RecipeMeta, SceneContext } from "../../engine/types";

const GRID = 5;

function cellGeometry(variant: string): THREE.BufferGeometry {
  switch (variant) {
    case "cubes":
      return new THREE.BoxGeometry(0.62, 0.62, 0.62);
    case "knots":
      return new THREE.TorusKnotGeometry(0.26, 0.1, 96, 16);
    default:
      return new THREE.SphereGeometry(0.4, 48, 48);
  }
}

const pbrGrid: RecipeMeta = {
  slug: "pbr-grid",
  title: "PBR Study Grid",
  category: "materials",
  description:
    "A 5×5 MeshStandardMaterial chart: metalness sweeps down the rows, roughness across the columns. Watch metals lose their white highlight as roughness climbs — that is energy conservation at work.",
  tags: ["pbr", "meshstandardmaterial", "reference"],
  variants: [
    { id: "spheres", label: "Spheres" },
    { id: "cubes", label: "Cubes" },
    { id: "knots", label: "Knots" },
  ],
  props: [
    { key: "spin", label: "Spin", min: 0, max: 1.5, step: 0.05, default: 0.25 },
    { key: "gap", label: "Spacing", min: 0.9, max: 1.6, step: 0.05, default: 1.15 },
    { key: "hue", label: "Hue", min: 0, max: 1, step: 0.02, default: 0.58 },
  ],

  create({ scene, camera, variant, props }: SceneContext) {
    camera.position.set(0, 0, 8.5);
    camera.lookAt(0, 0, 0);

    const group = new THREE.Group();
    scene.add(group);

    const geometry = cellGeometry(variant);
    const cells: { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial; row: number; col: number }[] = [];

    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const material = new THREE.MeshStandardMaterial({
          roughness: col / (GRID - 1),
          metalness: row / (GRID - 1),
        });
        material.color.setHSL(props.hue, 0.45, 0.6);
        const mesh = new THREE.Mesh(geometry, material);
        group.add(mesh);
        cells.push({ mesh, material, row, col });
      }
    }

    function layout(gap: number): void {
      const offset = ((GRID - 1) * gap) / 2;
      for (const { mesh, row, col } of cells) {
        mesh.position.set(col * gap - offset, offset - row * gap, 0);
      }
    }
    layout(props.gap);

    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(4, 6, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x88a8ff, 1);
    rim.position.set(-5, -3, -2);
    scene.add(rim);

    let spin = props.spin;

    return {
      update(elapsed: number) {
        for (const { mesh } of cells) {
          mesh.rotation.y = elapsed * spin;
          mesh.rotation.x = elapsed * spin * 0.5;
        }
      },
      applyProps(next) {
        layout(next.gap);
        for (const { material } of cells) {
          material.color.setHSL(next.hue, 0.45, 0.6);
        }
        spin = next.spin;
        return true;
      },
    };
  },
};

export default pbrGrid;
