/**
 * Fresnel Orb — rim lighting from first principles: the fresnel term is
 * one minus the dot of the view direction and the surface normal, raised
 * to a power. Variants layer bands and a breathing pulse on top.
 */
import * as THREE from "three";
import type { RecipeMeta, SceneContext } from "../../engine/types";

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uPulse;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;

  void main() {
    float scale = 1.0 + uPulse * 0.08 * sin(uTime * 2.2);
    vec3 p = position * scale;
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-(modelViewMatrix * vec4(p, 1.0)).xyz);
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uPower;
  uniform float uGlow;
  uniform float uBands;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;

  void main() {
    float fresnel = pow(1.0 - clamp(dot(vNormal, vView), 0.0, 1.0), uPower);
    vec3 base = vec3(0.05, 0.07, 0.16);
    vec3 rim = vec3(0.45, 0.75, 1.0);
    float bands = uBands * 0.5 * (0.5 + 0.5 * sin(vPos.y * 14.0 - uTime * 1.6));
    vec3 color = base + rim * (fresnel * uGlow) + rim * bands * fresnel;
    gl_FragColor = vec4(color, 1.0);
  }
`;

const fresnelOrb: RecipeMeta = {
  slug: "fresnel-orb",
  title: "Fresnel Orb",
  category: "shaders",
  description:
    "The fresnel rim term written by hand: pow(1 − N·V, power). Bands modulate it with a scrolling sine over the sphere's height; Pulse breathes the vertex positions. Everything is uniform-driven.",
  tags: ["glsl", "fresnel", "rim-light"],
  variants: [
    { id: "fresnel", label: "Fresnel" },
    { id: "bands", label: "Bands" },
    { id: "pulse", label: "Pulse" },
  ],
  props: [
    { key: "power", label: "Rim power", min: 0.5, max: 6, step: 0.1, default: 2.4 },
    { key: "glow", label: "Glow", min: 0.2, max: 3, step: 0.1, default: 1.3 },
    { key: "speed", label: "Spin", min: 0, max: 2, step: 0.05, default: 0.35 },
  ],

  create({ scene, camera, variant, props }: SceneContext) {
    camera.position.set(0, 0, 7);
    camera.lookAt(0, 0, 0);

    const uniforms = {
      uTime: { value: 0 },
      uPower: { value: props.power },
      uGlow: { value: props.glow },
      uBands: { value: variant === "bands" ? 1 : 0 },
      uPulse: { value: variant === "pulse" ? 1 : 0 },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms,
    });

    const orb = new THREE.Mesh(new THREE.SphereGeometry(2.3, 96, 96), material);
    scene.add(orb);

    let speed = props.speed;

    return {
      update(elapsed: number, dt: number) {
        uniforms.uTime.value += dt;
        orb.rotation.y = elapsed * speed;
        orb.rotation.x = Math.sin(elapsed * 0.3) * 0.15;
      },
      applyProps(next) {
        uniforms.uPower.value = next.power;
        uniforms.uGlow.value = next.glow;
        speed = next.speed;
        return true;
      },
    };
  },
};

export default fresnelOrb;
