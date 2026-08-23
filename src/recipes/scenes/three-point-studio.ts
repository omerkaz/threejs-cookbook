/**
 * Three-Point Studio — the film-school lighting rig in WebGL: a warm
 * key, a cool fill, and a rim light from behind. Each intensity is a
 * live prop, so you can feel what each light contributes by zeroing it.
 */
import * as THREE from "three";
import type { RecipeMeta, SceneContext } from "../../engine/types";

function subjectGeometry(variant: string): THREE.BufferGeometry {
  switch (variant) {
    case "sphere":
      return new THREE.SphereGeometry(2, 64, 64);
    case "capsule":
      return new THREE.CapsuleGeometry(1.2, 1.6, 12, 32);
    default:
      return new THREE.TorusKnotGeometry(1.4, 0.42, 220, 32);
  }
}

const threePointStudio: RecipeMeta = {
  slug: "three-point-studio",
  title: "Three-Point Studio",
  category: "lighting",
  description:
    "Key, fill, and rim — the classic portrait rig. Zero the fill to see hard noir shadows; zero the key and the rim silhouette remains. Colors are baked into the lights, not the material.",
  tags: ["lights", "key-fill-rim", "studio"],
  variants: [
    { id: "knot", label: "Torus Knot" },
    { id: "sphere", label: "Sphere" },
    { id: "capsule", label: "Capsule" },
  ],
  props: [
    { key: "key", label: "Key light", min: 0, max: 6, step: 0.1, default: 2.6 },
    { key: "fill", label: "Fill light", min: 0, max: 4, step: 0.1, default: 0.9 },
    { key: "rim", label: "Rim light", min: 0, max: 6, step: 0.1, default: 2.2 },
    { key: "spin", label: "Turntable", min: 0, max: 1.5, step: 0.05, default: 0.25 },
  ],

  create({ scene, camera, variant, props }: SceneContext) {
    camera.position.set(0, 0.4, 7.5);
    camera.lookAt(0, 0, 0);

    const subject = new THREE.Mesh(
      subjectGeometry(variant),
      new THREE.MeshStandardMaterial({ color: 0xd8d8de, roughness: 0.35, metalness: 0.1 }),
    );
    scene.add(subject);

    const key = new THREE.DirectionalLight(0xfff1dc, props.key);
    key.position.set(4, 4, 4);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x7fa0ff, props.fill);
    fill.position.set(-5, 0.5, 3);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffb36b, props.rim);
    rim.position.set(-1, 3, -5);
    scene.add(rim);

    let spin = props.spin;

    return {
      update(elapsed: number) {
        subject.rotation.y = elapsed * spin;
      },
      applyProps(next) {
        key.intensity = next.key;
        fill.intensity = next.fill;
        rim.intensity = next.rim;
        spin = next.spin;
        return true;
      },
    };
  },
};

export default threePointStudio;
