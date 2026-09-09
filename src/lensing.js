import * as THREE from 'three';
import { clamp } from './config.js';

export const LENSING_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const LENSING_FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D tDiffuse;
uniform vec2 uSingularityCenter;
uniform float uAspectRatio;
uniform float uStrength;
uniform float uEinsteinRadiusSq;
uniform float uSoftening;
uniform float uMaxDistortionRadius;
uniform float uCriticalRadius;
uniform float uHorizonRadius;

varying vec2 vUv;

void main() {
  if (uStrength <= 0.0001) {
    gl_FragColor = texture2D(tDiffuse, vUv);
    return;
  }

  // Calculate normalized UV distance to singularity center
  vec2 delta = (vUv - uSingularityCenter) * vec2(uAspectRatio, 1.0);
  float r = length(delta);

  // Event horizon check: inside event horizon, returns pitch black
  if (r < uHorizonRadius) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec2 dir = (r > 1e-5) ? (delta / r) : vec2(0.0, 1.0);

  // Relativistic gravitational deflection formula:
  // light rays bend around the singularity with deflection ~
  // uStrength * (uEinsteinRadiusSq / (r + uSoftening)) * smoothstep(uMaxDistortionRadius, uCriticalRadius, r)
  float falloff = smoothstep(uMaxDistortionRadius, uCriticalRadius, r);
  float deflection = uStrength * (uEinsteinRadiusSq / (r + uSoftening)) * falloff;

  // Subtle chromatic dispersion: sample red and blue channels with small offset (+/-1.2%) near critical curve
  float dispersionMask = exp(-pow((r - uCriticalRadius) / max(0.001, uCriticalRadius * 0.8), 2.0));
  float dispersion = 0.012 * uStrength * dispersionMask;

  float defR = deflection * (1.0 + dispersion);
  float defG = deflection;
  float defB = deflection * (1.0 - dispersion);

  // Map deflected delta back to UV space (dividing by aspect ratio for x)
  vec2 uvR = uSingularityCenter + (delta - dir * defR) / vec2(uAspectRatio, 1.0);
  vec2 uvG = uSingularityCenter + (delta - dir * defG) / vec2(uAspectRatio, 1.0);
  vec2 uvB = uSingularityCenter + (delta - dir * defB) / vec2(uAspectRatio, 1.0);

  // Clamp UVs to avoid edge bleed outside viewport
  uvR = clamp(uvR, vec2(0.001), vec2(0.999));
  uvG = clamp(uvG, vec2(0.001), vec2(0.999));
  uvB = clamp(uvB, vec2(0.001), vec2(0.999));

  vec4 colR = texture2D(tDiffuse, uvR);
  vec4 colG = texture2D(tDiffuse, uvG);
  vec4 colB = texture2D(tDiffuse, uvB);

  // Horizon edge anti-aliasing (smooth transition from event horizon black to lensed scene)
  float horizonEdge = smoothstep(uHorizonRadius, uHorizonRadius + 0.002, r);
  vec3 lensedColor = vec3(colR.r, colG.g, colB.b);
  vec3 finalColor = mix(vec3(0.0), lensedColor, horizonEdge);

  gl_FragColor = vec4(finalColor, colG.a);
}
`;

export class LensingShaderMaterial extends THREE.ShaderMaterial {
  constructor(options = {}) {
    const uniforms = {
      tDiffuse: { value: null },
      uSingularityCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uAspectRatio: { value: 1.0 },
      uStrength: { value: 0.0 },
      uEinsteinRadiusSq: { value: 0.01 },
      uSoftening: { value: 0.02 },
      uMaxDistortionRadius: { value: 0.5 },
      uCriticalRadius: { value: 0.05 },
      uHorizonRadius: { value: 0.038 },
      ...(options.uniforms || {}),
    };
    super({
      vertexShader: LENSING_VERTEX_SHADER,
      fragmentShader: LENSING_FRAGMENT_SHADER,
      uniforms,
      depthTest: false,
      depthWrite: false,
      ...options,
    });
  }
}

export class LensingPipeline {
  constructor(renderer, width = 800, height = 600) {
    this.renderer = renderer;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);

    const pixelRatio = typeof window !== 'undefined'
      ? Math.min(2, Math.max(1, window.devicePixelRatio || 1))
      : 1;

    this.renderTarget = new THREE.WebGLRenderTarget(
      Math.max(1, Math.round(this.width * pixelRatio)),
      Math.max(1, Math.round(this.height * pixelRatio)),
      {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
      }
    );
    this.renderTarget.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.renderTarget.texture.wrapT = THREE.ClampToEdgeWrapping;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.geometry = new THREE.PlaneGeometry(2, 2);

    this.material = new LensingShaderMaterial();
    this.material.uniforms.tDiffuse.value = this.renderTarget.texture;

    this.quad = new THREE.Mesh(this.geometry, this.material);
    this.scene.add(this.quad);

    this.setSize(this.width, this.height, pixelRatio);
  }

  setSize(width, height, pixelRatio) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const pr = pixelRatio || (typeof window !== 'undefined'
      ? Math.min(2, Math.max(1, window.devicePixelRatio || 1))
      : 1);

    this.renderTarget.setSize(
      Math.max(1, Math.round(this.width * pr)),
      Math.max(1, Math.round(this.height * pr))
    );

    const uniforms = this.material.uniforms;
    uniforms.uAspectRatio.value = this.width / this.height;
    uniforms.uEinsteinRadiusSq.value = Math.pow(95.0 / this.height, 2);
    uniforms.uSoftening.value = 22.0 / this.height;
    uniforms.uMaxDistortionRadius.value = 440.0 / this.height;
    uniforms.uCriticalRadius.value = 48.0 / this.height;
    uniforms.uHorizonRadius.value = 34.0 / this.height;
  }

  setCenter(point, width, height) {
    const w = width || this.width || 1;
    const h = height || this.height || 1;
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      this.material.uniforms.uSingularityCenter.value.set(
        point.x / w,
        1.0 - (point.y / h)
      );
    }
  }

  setStrength(strength) {
    this.material.uniforms.uStrength.value = clamp(strength, 0, 1);
  }

  render(renderer) {
    const r = renderer || this.renderer;
    if (r) {
      r.render(this.scene, this.camera);
    }
  }

  dispose() {
    this.renderTarget.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
