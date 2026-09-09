import * as THREE from 'three';

const PARTICLE_COUNT = 140;

const CORONA_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CORONA_FRAGMENT_SHADER = `
precision highp float;

uniform float uTime;
uniform float uFieldActive;
uniform float uCapturePulse;
uniform vec3 uColorCoral;
uniform vec3 uColorAccent;
uniform vec3 uColorBlue;
uniform vec3 uColorBg;

varying vec2 vUv;

void main() {
  vec2 p = (vUv - 0.5) * 640.0;
  float r = length(p);
  if (r < 34.0 || r > 315.0) {
    discard;
  }

  float theta = atan(p.y, p.x);

  // Subtle breathing pulse in the outer corona (period ~4.8s)
  float breath = 0.5 + 0.5 * sin(uTime * 1.3);
  float breathScale = 1.0 + 0.05 * breath;

  // Lensing deflection caustic ring around shadow boundary (r ~ 42 to 90px)
  float lensCaustic1 = exp(-pow((r - 46.0) / 14.0, 2.0)) * 0.38;
  float lensCaustic2 = exp(-pow((r - 78.0) / 26.0, 2.0)) * 0.18;

  // Radial falloff of ambient corona
  float coronaDist = r / breathScale;
  float corona = exp(-(coronaDist - 36.0) * 0.018);
  corona = smoothstep(34.2, 44.0, r) * corona * smoothstep(310.0, 90.0, r);

  // Gravitational metric curvature ripples (spacetime contour lines)
  float ripples = sin(r * 0.09 - uTime * 0.6 + sin(theta * 3.0) * 0.8) * 0.5 + 0.5;
  ripples = smoothstep(0.4, 0.85, ripples) * 0.12 * smoothstep(240.0, 50.0, r);

  float totalEnergy = corona * 0.45 + lensCaustic1 + lensCaustic2 + ripples;
  totalEnergy += uCapturePulse * 0.55 * exp(-pow((r - 54.0) / 32.0, 2.0));

  // Color blending: slate blue outer haze, warm terracotta mid, warm sand near ring
  vec3 color = mix(uColorBg, uColorBlue, smoothstep(270.0, 100.0, r));
  color = mix(color, uColorCoral, smoothstep(115.0, 46.0, r));
  color = mix(color, uColorAccent, clamp(lensCaustic1 * 2.2, 0.0, 1.0));

  float alpha = clamp(totalEnergy * (0.55 + 0.45 * uFieldActive), 0.0, 0.78);
  gl_FragColor = vec4(color, alpha);
}
`;

const DISK_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DISK_FRAGMENT_SHADER = `
precision highp float;

uniform float uTime;
uniform float uFieldActive;
uniform float uCapturePulse;
uniform float uCaptureAngle;
uniform vec3 uColorVoid;
uniform vec3 uColorCoral;
uniform vec3 uColorAccent;
uniform vec3 uColorInk;
uniform vec3 uColorHot;

varying vec2 vUv;

void main() {
  vec2 p = (vUv - 0.5) * 420.0;

  // Elliptical coordinate transformation (tilt angle ~ -18 deg, compression ~ 0.62)
  float cos18 = 0.9510565; // cos(18 deg)
  float sin18 = 0.3090170; // sin(18 deg)
  // Rotate coordinates by +18 deg to align with disk coordinate axes
  vec2 pRot = vec2(p.x * cos18 - p.y * sin18, p.x * sin18 + p.y * cos18);

  // Minor axis compression
  float aspect = 0.62;
  vec2 pDisk = vec2(pRot.x, pRot.y / aspect);
  float r = length(pDisk);
  float rCirc = length(p);

  // Absorption by central horizon and outer accretion boundary
  if (rCirc < 34.5 || r < 35.5 || r > 196.0) {
    discard;
  }

  float theta = atan(pDisk.y, pDisk.x);

  // Keplerian differential rotation along elliptical contours
  float normR = max(r, 36.0) / 36.0;
  float omega = 3.2 / pow(normR, 1.35);
  float spinTime = uTime * (0.65 + 0.35 * uFieldActive);
  float flowAngle = theta + omega * spinTime;

  // Logarithmic spiral shear (matter spiraling inward)
  float spiral = flowAngle + 2.8 * log(normR);

  // Multi-frequency procedural stream filaments along elliptical contours
  float f1 = sin(spiral * 4.0 + sin(r * 0.10 - uTime * 1.4));
  float f2 = sin(spiral * 8.0 - r * 0.16 + uTime * 2.1);
  float f3 = sin(spiral * 14.0 + r * 0.28 - uTime * 3.2);
  float filaments = 0.52 * f1 + 0.32 * f2 + 0.16 * f3;
  filaments = smoothstep(-0.30, 0.82, filaments);

  // Radial density profile: inner edge flares brightly at r ~ 36px, extending out to ~185-200px
  float innerRamp = smoothstep(35.5, 38.5, r);
  float outerRamp = smoothstep(195.0, 50.0, r);
  float density = innerRamp * outerRamp;

  // Pronounced relativistic Doppler beaming: approaching side (lower-left quadrant) noticeably brighter/hotter
  float doppler = 1.0 + 0.52 * cos(theta - 2.85);

  // Capture flare / thermal shockwave expanding outward
  float waveFront = 36.0 + (1.0 - uCapturePulse) * 120.0;
  float shockwave = exp(-pow((r - waveFront) / 16.0, 2.0)) * uCapturePulse * 1.8;

  // Localized capture stream flare near capture angle
  float angleDiff = abs(mod(theta - uCaptureAngle + 3.14159265, 6.2831853) - 3.14159265);
  float streamFlare = exp(-pow(angleDiff / 0.52, 2.0)) * exp(-pow((r - 55.0) / 28.0, 2.0)) * uCapturePulse * 1.6;

  // Temperature gradient mapping (inner hottest pale cream/gold, mid coral, outer deep charcoal)
  float temp = (1.0 - smoothstep(36.0, 140.0, r)) * 1.35 + filaments * 0.35 + (shockwave + streamFlare) * 0.6;
  temp = clamp(temp * doppler, 0.0, 1.8);

  vec3 color;
  if (temp > 1.0) {
    color = mix(uColorAccent, uColorHot, clamp(temp - 1.0, 0.0, 1.0));
  } else if (temp > 0.6) {
    color = mix(uColorCoral, uColorAccent, (temp - 0.6) / 0.4);
  } else if (temp > 0.25) {
    color = mix(uColorVoid, uColorCoral, (temp - 0.25) / 0.35);
  } else {
    color = mix(uColorVoid * 0.5, uColorCoral * 0.3, temp / 0.25);
  }

  // Add pale incandescent highlight to crisp filament crests
  float crest = smoothstep(0.60, 0.95, filaments) * innerRamp * smoothstep(110.0, 36.0, r);
  color = mix(color, uColorInk, crest * 0.75 * doppler);

  // Overall alpha calculation
  float alpha = density * (0.35 + 0.65 * filaments) * doppler;
  alpha += shockwave * 0.6 + streamFlare * 0.7;
  alpha = clamp(alpha * (0.75 + 0.25 * uFieldActive), 0.0, 0.94);

  gl_FragColor = vec4(color, alpha);
}
`;

const PHOTON_RING_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const PHOTON_RING_FRAGMENT_SHADER = `
precision highp float;

uniform float uTime;
uniform float uCapturePulse;
uniform vec3 uColorCoral;
uniform vec3 uColorAccent;
uniform vec3 uColorInk;

varying vec2 vUv;

void main() {
  vec2 p = (vUv - 0.5) * 96.0;
  float r = length(p);
  if (r < 34.4 || r > 46.0) {
    discard;
  }
  float theta = atan(p.y, p.x);

  // Brilliant ultra-thin photon ring hugging r ≈ 35.5 - 38.0px
  float ring = exp(-pow((r - 36.3) / 1.10, 2.0));
  float halo = exp(-pow((r - 37.2) / 3.4, 2.0)) * 0.45;

  // High-energy micro-shimmer and turbulent phase jitter
  float shimmer1 = sin(theta * 14.0 + uTime * 9.0);
  float shimmer2 = cos(theta * 23.0 - uTime * 13.0);
  float microShimmer = 0.86 + 0.14 * (shimmer1 * 0.6 + shimmer2 * 0.4);

  // Doppler bias on the photon ring
  float doppler = 1.0 + 0.35 * cos(theta - 2.85);

  float intensity = (ring * 1.35 + halo) * microShimmer * doppler;

  // Crisp caustic surge during capture
  float surge = exp(-pow((r - 36.5) / 1.8, 2.0)) * uCapturePulse * 2.8;
  intensity += surge;

  vec3 color = mix(uColorAccent, uColorInk, clamp(ring * 1.25, 0.0, 1.0));
  color = mix(uColorCoral, color, clamp(ring * 1.8, 0.0, 1.0));
  if (uCapturePulse > 0.03) {
    color = mix(color, vec3(1.0, 0.98, 0.94), clamp(uCapturePulse * (ring + surge * 0.5), 0.0, 1.0));
  }

  float alpha = clamp(intensity, 0.0, 0.98);
  gl_FragColor = vec4(color, alpha);
}
`;

const CORE_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CORE_FRAGMENT_SHADER = `
precision highp float;

uniform vec3 uColorVoid;
varying vec2 vUv;

void main() {
  vec2 p = (vUv - 0.5) * 80.0;
  float r = length(p);
  if (r > 35.5) {
    discard;
  }
  // Subpixel razor-sharp obsidian absorption boundary at r ≈ 35px
  float edgeAlpha = smoothstep(35.2, 34.4, r);
  gl_FragColor = vec4(uColorVoid, edgeAlpha);
}
`;

const PARTICLES_VERTEX_SHADER = `
uniform float uPixelRatio;
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;

varying float vAlpha;
varying vec3 vColor;

void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const PARTICLES_FRAGMENT_SHADER = `
precision highp float;

varying float vAlpha;
varying vec3 vColor;

void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  if (dist > 0.5) {
    discard;
  }
  // Soft glowing particle with radiant incandescent center
  float glow = smoothstep(0.5, 0.08, dist);
  float core = smoothstep(0.25, 0.0, dist) * 0.5;
  gl_FragColor = vec4(vColor + core, clamp((glow + core) * vAlpha, 0.0, 1.0));
}
`;

export class SingularityVisuals {
  constructor() {
    this.group = new THREE.Group();
    this.group.renderOrder = 2;
    this.center = { x: 0, y: 0 };
    this.capturePulse = 0;
    this.captureAngle = 0;

    // Palette colors
    const colorBg = new THREE.Color(0x101214);
    const colorVoid = new THREE.Color(0x020304);
    const colorCoral = new THREE.Color(0xe4876c);
    const colorAccent = new THREE.Color(0xdbb58c);
    const colorBlue = new THREE.Color(0x7b9296);
    const colorInk = new THREE.Color(0xf0e8d9);
    const colorHot = new THREE.Color(0xfff8ee);

    const pixelRatio = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;

    // 1. Corona & Lensing Halo (~640px plane)
    this.coronaGeometry = new THREE.PlaneGeometry(640, 640);
    this.coronaMaterial = new THREE.ShaderMaterial({
      vertexShader: CORONA_VERTEX_SHADER,
      fragmentShader: CORONA_FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uFieldActive: { value: 0 },
        uCapturePulse: { value: 0 },
        uColorCoral: { value: colorCoral },
        uColorAccent: { value: colorAccent },
        uColorBlue: { value: colorBlue },
        uColorBg: { value: colorBg },
      },
    });
    this.coronaMesh = new THREE.Mesh(this.coronaGeometry, this.coronaMaterial);
    this.coronaMesh.renderOrder = 2.1;
    this.coronaMesh.position.z = -0.04;
    this.group.add(this.coronaMesh);

    // 2. Accretion Disk (~420px plane, extending to r ~ 185-200px)
    this.diskGeometry = new THREE.PlaneGeometry(420, 420);
    this.diskMaterial = new THREE.ShaderMaterial({
      vertexShader: DISK_VERTEX_SHADER,
      fragmentShader: DISK_FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uFieldActive: { value: 0 },
        uCapturePulse: { value: 0 },
        uCaptureAngle: { value: 0 },
        uColorVoid: { value: colorVoid },
        uColorCoral: { value: colorCoral },
        uColorAccent: { value: colorAccent },
        uColorInk: { value: colorInk },
        uColorHot: { value: colorHot },
      },
    });
    this.diskMesh = new THREE.Mesh(this.diskGeometry, this.diskMaterial);
    this.diskMesh.renderOrder = 2.2;
    this.diskMesh.position.z = -0.02;
    this.group.add(this.diskMesh);

    // 3. Photon Ring Caustic (hugging r ≈ 35.5 - 38.0px)
    this.photonRingGeometry = new THREE.PlaneGeometry(96, 96);
    this.photonRingMaterial = new THREE.ShaderMaterial({
      vertexShader: PHOTON_RING_VERTEX_SHADER,
      fragmentShader: PHOTON_RING_FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uCapturePulse: { value: 0 },
        uColorCoral: { value: colorCoral },
        uColorAccent: { value: colorAccent },
        uColorInk: { value: colorInk },
      },
    });
    this.photonRingMesh = new THREE.Mesh(this.photonRingGeometry, this.photonRingMaterial);
    this.photonRingMesh.renderOrder = 2.3;
    this.photonRingMesh.position.z = -0.01;
    this.group.add(this.photonRingMesh);

    // 4. Event Horizon Core (radius ~35px, diameter ~70px, obsidian #020304)
    this.coreGeometry = new THREE.PlaneGeometry(80, 80);
    this.coreMaterial = new THREE.ShaderMaterial({
      vertexShader: CORE_VERTEX_SHADER,
      fragmentShader: CORE_FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uColorVoid: { value: colorVoid },
      },
    });
    this.coreMesh = new THREE.Mesh(this.coreGeometry, this.coreMaterial);
    this.coreMesh.renderOrder = 2.4;
    this.coreMesh.position.z = 0.02;
    this.group.add(this.coreMesh);

    // 5. Restrained Animated Matter Particles
    this.particlePositions = new Float32Array(PARTICLE_COUNT * 3);
    this.particleColors = new Float32Array(PARTICLE_COUNT * 3);
    this.particleSizes = new Float32Array(PARTICLE_COUNT);
    this.particleAlphas = new Float32Array(PARTICLE_COUNT);

    this.particleR = new Float32Array(PARTICLE_COUNT);
    this.particleTheta = new Float32Array(PARTICLE_COUNT);
    this.particleBaseSpeed = new Float32Array(PARTICLE_COUNT);
    this.particleDriftRate = new Float32Array(PARTICLE_COUNT);
    this.particleBaseSize = new Float32Array(PARTICLE_COUNT);
    this.particlePhase = new Float32Array(PARTICLE_COUNT);

    const paletteColors = [
      colorAccent, // 45% gold
      colorCoral,  // 30% coral
      colorInk,    // 15% cream
      colorBlue,   // 10% slate blue
    ];

    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      this.particleR[i] = 38.0 + Math.pow(Math.random(), 1.25) * 150.0;
      this.particleTheta[i] = Math.random() * Math.PI * 2;
      this.particleBaseSpeed[i] = 0.85 + Math.random() * 0.35;
      this.particleDriftRate[i] = 3.2 + Math.random() * 6.5;
      this.particleBaseSize[i] = 2.0 + Math.random() * 2.6;
      this.particlePhase[i] = Math.random() * Math.PI * 2;

      const pick = Math.random();
      const col = pick < 0.45 ? paletteColors[0] : pick < 0.75 ? paletteColors[1] : pick < 0.9 ? paletteColors[2] : paletteColors[3];
      this.particleColors[i * 3] = col.r;
      this.particleColors[i * 3 + 1] = col.g;
      this.particleColors[i * 3 + 2] = col.b;
    }

    this.particlesGeometry = new THREE.BufferGeometry();
    this.particlesGeometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    this.particlesGeometry.setAttribute('aColor', new THREE.BufferAttribute(this.particleColors, 3));
    this.particlesGeometry.setAttribute('aSize', new THREE.BufferAttribute(this.particleSizes, 1));
    this.particlesGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.particleAlphas, 1));

    this.particlesMaterial = new THREE.ShaderMaterial({
      vertexShader: PARTICLES_VERTEX_SHADER,
      fragmentShader: PARTICLES_FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPixelRatio: { value: pixelRatio },
      },
    });

    this.particles = new THREE.Points(this.particlesGeometry, this.particlesMaterial);
    this.particles.renderOrder = 2.5;
    this.particles.position.z = 0.04;
    this.group.add(this.particles);
  }

  setCenter(point) {
    this.center.x = point.x;
    this.center.y = point.y;
  }

  triggerCaptureReaction(body) {
    this.capturePulse = 1.0;
    if (body && Number.isFinite(body.x) && Number.isFinite(body.y)) {
      this.captureAngle = Math.atan2(body.y - this.center.y, body.x - this.center.x);
      // Spawn rapid infalling spark trail directing ~18-20 particles along incoming angle
      let redirected = 0;
      for (let i = 0; i < PARTICLE_COUNT && redirected < 19; i += 1) {
        if (this.particleR[i] > 65.0) {
          this.particleR[i] = 55.0 + Math.random() * 40.0;
          this.particleTheta[i] = this.captureAngle + (Math.random() - 0.5) * 0.35;
          this.particleDriftRate[i] = 22.0 + Math.random() * 16.0;
          redirected += 1;
        }
      }
    }
  }

  feedCapture(body) {
    this.triggerCaptureReaction(body);
  }

  update(dt, time, isFieldActive = true) {
    const fieldFactor = isFieldActive ? 1.0 : 0.4;

    // Decay capture pulse
    if (this.capturePulse > 0.0) {
      this.capturePulse = Math.max(0, this.capturePulse - dt * 1.55);
    }

    // Update uniforms
    this.coronaMaterial.uniforms.uTime.value = time;
    this.coronaMaterial.uniforms.uFieldActive.value = fieldFactor;
    this.coronaMaterial.uniforms.uCapturePulse.value = this.capturePulse;

    this.diskMaterial.uniforms.uTime.value = time;
    this.diskMaterial.uniforms.uFieldActive.value = fieldFactor;
    this.diskMaterial.uniforms.uCapturePulse.value = this.capturePulse;
    this.diskMaterial.uniforms.uCaptureAngle.value = this.captureAngle;

    this.photonRingMaterial.uniforms.uTime.value = time;
    this.photonRingMaterial.uniforms.uCapturePulse.value = this.capturePulse;

    // Update matter spark particles in CPU (Zero GC)
    const speedMult = isFieldActive ? 1.0 : 0.65;
    const cos18 = 0.9510565;  // cos(18 deg)
    const sin18 = 0.3090170;  // sin(18 deg)

    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      let r = this.particleR[i];
      let theta = this.particleTheta[i];

      // Keplerian differential orbital speed along accretion disk
      const normR = Math.max(r, 36.0) / 36.0;
      const angularSpeed = (2.6 / Math.pow(normR, 1.25)) * this.particleBaseSpeed[i] * speedMult;
      theta += angularSpeed * dt;

      // Inward gravitational drift, accelerating near event horizon
      const drift = this.particleDriftRate[i] * (1.0 + 45.0 / (r + 15.0)) * dt * speedMult;
      r -= drift;

      // Horizon crossing and recycling into outer disk
      if (r < 35.8) {
        r = 145.0 + Math.random() * 45.0;
        theta = Math.random() * Math.PI * 2;
        this.particleDriftRate[i] = 3.2 + Math.random() * 6.5;
      }

      this.particleR[i] = r;
      this.particleTheta[i] = theta;

      // Relativistic Doppler bias matching disk approaching quadrant
      const doppler = 1.0 + 0.38 * Math.cos(theta - 2.85);

      // Micro-shimmer
      const shimmer = 0.82 + 0.18 * Math.sin(time * 4.0 + this.particlePhase[i]);

      // Radial fading hugging disk inner edge (~36px) to outer boundary (~190px)
      const innerAlpha = Math.min(1.0, Math.max(0.0, (r - 35.8) / 4.5));
      const outerAlpha = Math.min(1.0, Math.max(0.0, (192.0 - r) / 30.0));
      let alpha = innerAlpha * outerAlpha * shimmer * doppler * (isFieldActive ? 0.95 : 0.65);

      let sizeBoost = 0;
      if (this.capturePulse > 0.01) {
        alpha = Math.min(1.0, alpha + this.capturePulse * 0.5);
        sizeBoost = this.capturePulse * 1.8;
      }

      // Orbit particles along the inclined elliptical plane:
      // disk plane (xDisk, yDisk = r * sin * 0.62) rotated by -18 deg
      const xDisk = Math.cos(theta) * r;
      const yDisk = Math.sin(theta) * r * 0.62;
      this.particlePositions[i * 3] = xDisk * cos18 + yDisk * sin18;
      this.particlePositions[i * 3 + 1] = -xDisk * sin18 + yDisk * cos18;
      this.particlePositions[i * 3 + 2] = 0.04;

      this.particleAlphas[i] = alpha;
      this.particleSizes[i] = this.particleBaseSize[i] + sizeBoost;
    }

    this.particlesGeometry.attributes.position.needsUpdate = true;
    this.particlesGeometry.attributes.aAlpha.needsUpdate = true;
    this.particlesGeometry.attributes.aSize.needsUpdate = true;
  }

  resize(pixelRatio) {
    if (this.particlesMaterial && pixelRatio) {
      this.particlesMaterial.uniforms.uPixelRatio.value = pixelRatio;
    }
  }

  dispose() {
    this.coronaGeometry.dispose();
    this.coronaMaterial.dispose();
    this.diskGeometry.dispose();
    this.diskMaterial.dispose();
    this.photonRingGeometry.dispose();
    this.photonRingMaterial.dispose();
    this.coreGeometry.dispose();
    this.coreMaterial.dispose();
    this.particlesGeometry.dispose();
    this.particlesMaterial.dispose();
  }
}
