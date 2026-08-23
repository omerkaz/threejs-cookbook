/**
 * Noise Waves — a subdivided plane displaced in the vertex shader with
 * GPU value noise. All props map straight onto uniforms, so tweaking
 * never rebuilds the scene. One material serves three draw styles.
 */
import * as THREE from "three";
import type { RecipeMeta, SceneContext } from "../../engine/types";

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  uniform float uFreq;
  varying float vHeight;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  void main() {
    vec2 p = position.xy * uFreq;
    float h = vnoise(p + uTime * 0.6) * 0.65 + vnoise(p * 2.0 - uTime * 0.4) * 0.35;
    vHeight = h;
    vec3 displaced = position + vec3(0.0, 0.0, h * uAmp);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
    gl_PointSize = 3.0;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uPoints;
  varying float vHeight;

  void main() {
    if (uPoints > 0.5) {
      // Round sprite: discard fragments outside the unit circle.
      vec2 c = gl_PointCoord - 0.5;
      if (dot(c, c) > 0.25) discard;
    }
    vec3 deep = vec3(0.08, 0.13, 0.28);
    vec3 crest = vec3(0.5, 0.82, 1.0);
    vec3 color = mix(deep, crest, smoothstep(0.1, 0.95, vHeight));
    gl_FragColor = vec4(color, 1.0);
  }
`;

const noiseWaves: RecipeMeta = {
  slug: "noise-waves",
  title: "Noise Waves",
  category: "shaders",
  description:
    "Vertex-shader displacement with inline GLSL value noise. Height feeds a deep-to-crest color ramp in the fragment stage. Solid, wireframe, and point variants share one ShaderMaterial.",
  tags: ["glsl", "shadermaterial", "displacement"],
  variants: [
    { id: "solid", label: "Solid" },
    { id: "wireframe", label: "Wireframe" },
    { id: "points", label: "Points" },
  ],
  props: [
    { key: "amplitude", label: "Amplitude", min: 0, max: 2.5, step: 0.05, default: 1.1 },
    { key: "frequency", label: "Frequency", min: 0.1, max: 2, step: 0.05, default: 0.55 },
    { key: "speed", label: "Speed", min: 0, max: 3, step: 0.1, default: 1 },
  ],

  create({ scene, camera, variant, props }: SceneContext) {
    camera.position.set(0, 4.4, 7.5);
    camera.lookAt(0, 0.4, 0);

    const uniforms = {
      uTime: { value: 0 },
      uAmp: { value: props.amplitude },
      uFreq: { value: props.frequency },
      uPoints: { value: variant === "points" ? 1 : 0 },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms,
      wireframe: variant === "wireframe",
      side: THREE.DoubleSide,
    });

    const geometry = new THREE.PlaneGeometry(12, 12, 140, 140);
    const surface =
      variant === "points"
        ? new THREE.Points(geometry, material)
        : new THREE.Mesh(geometry, material);
    surface.rotation.x = -Math.PI / 2.4;
    scene.add(surface);

    let speed = props.speed;

    return {
      update(_elapsed: number, dt: number) {
        uniforms.uTime.value += dt * speed;
      },
      applyProps(next) {
        uniforms.uAmp.value = next.amplitude;
        uniforms.uFreq.value = next.frequency;
        speed = next.speed;
        return true;
      },
    };
  },
};

export default noiseWaves;
