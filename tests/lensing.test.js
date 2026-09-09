import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  LensingPipeline,
  LensingShaderMaterial,
  LENSING_VERTEX_SHADER,
  LENSING_FRAGMENT_SHADER,
} from '../src/lensing.js';
import { SNAPSHOT_TIMEOUT_MS, snapshotPageBackground, createFallbackBackgroundCanvas } from '../src/conversion.js';
import { GravityScene } from '../src/scene.js';

test('LensingShaderMaterial initializes with all required uniforms and shaders', () => {
  const material = new LensingShaderMaterial();
  assert.ok(material);
  assert.equal(typeof material.vertexShader, 'string');
  assert.equal(typeof material.fragmentShader, 'string');
  assert.ok(material.vertexShader.includes('vUv = uv'));
  assert.ok(material.fragmentShader.includes('uEinsteinRadiusSq'));
  assert.ok(material.fragmentShader.includes('uHorizonRadius'));
  assert.ok(material.fragmentShader.includes('smoothstep(uMaxDistortionRadius, uCriticalRadius, r)'));
  assert.ok(material.fragmentShader.includes('mix(0.85, 1.0, smoothstep(uHorizonRadius, uCriticalRadius, r))'));
  assert.equal((material.fragmentShader.match(/#include <colorspace_fragment>/g) || []).length, 3);

  const uniforms = material.uniforms;
  assert.ok('tDiffuse' in uniforms);
  assert.ok('uSingularityCenter' in uniforms);
  assert.ok('uAspectRatio' in uniforms);
  assert.ok('uStrength' in uniforms);
  assert.ok('uEinsteinRadiusSq' in uniforms);
  assert.ok('uSoftening' in uniforms);
  assert.ok('uMaxDistortionRadius' in uniforms);
  assert.ok('uCriticalRadius' in uniforms);
  assert.ok('uHorizonRadius' in uniforms);

  assert.equal(uniforms.uStrength.value, 0.0);
  assert.ok(Number.isFinite(uniforms.uEinsteinRadiusSq.value));
  assert.ok(Number.isFinite(uniforms.uSoftening.value));
  assert.ok(Number.isFinite(uniforms.uMaxDistortionRadius.value));
  assert.ok(Number.isFinite(uniforms.uCriticalRadius.value));
  assert.ok(Number.isFinite(uniforms.uHorizonRadius.value));

  material.dispose();
});

test('LensingPipeline initializes renderTarget, quad geometry, and camera correctly', () => {
  const pipeline = new LensingPipeline(null, 1000, 500);

  assert.ok(pipeline.renderTarget);
  assert.equal(pipeline.renderTarget.texture.minFilter, THREE.LinearFilter);
  assert.equal(pipeline.renderTarget.texture.magFilter, THREE.LinearFilter);
  assert.equal(pipeline.renderTarget.texture.wrapS, THREE.ClampToEdgeWrapping);
  assert.equal(pipeline.renderTarget.texture.wrapT, THREE.ClampToEdgeWrapping);

  assert.ok(pipeline.camera instanceof THREE.OrthographicCamera);
  assert.equal(pipeline.camera.left, -1);
  assert.equal(pipeline.camera.right, 1);
  assert.equal(pipeline.camera.top, 1);
  assert.equal(pipeline.camera.bottom, -1);

  assert.ok(pipeline.quad);
  assert.ok(pipeline.material instanceof LensingShaderMaterial);
  assert.equal(pipeline.material.uniforms.tDiffuse.value, pipeline.renderTarget.texture);
  assert.equal(pipeline.material.uniforms.uAspectRatio.value, 2.0);

  pipeline.dispose();
});

test('LensingPipeline dynamically syncs singularity center with WebGL UV origin inversion', () => {
  const pipeline = new LensingPipeline(null, 1000, 800);

  // DOM coordinate (300, 200) in a 1000x800 viewport
  // In DOM: (0, 0) is top-left
  // In WebGL UV: (0, 0) is bottom-left -> x = 300/1000 = 0.3, y = 1.0 - 200/800 = 0.75
  pipeline.setCenter({ x: 300, y: 200 }, 1000, 800);
  const centerUV = pipeline.material.uniforms.uSingularityCenter.value;
  assert.ok(Math.abs(centerUV.x - 0.3) < 0.0001);
  assert.ok(Math.abs(centerUV.y - 0.75) < 0.0001);

  // Center point
  pipeline.setCenter({ x: 500, y: 400 });
  assert.ok(Math.abs(centerUV.x - 0.5) < 0.0001);
  assert.ok(Math.abs(centerUV.y - 0.5) < 0.0001);

  pipeline.dispose();
});

test('LensingPipeline strength ramp clamps properly', () => {
  const pipeline = new LensingPipeline(null, 800, 600);

  pipeline.setStrength(0.0);
  assert.equal(pipeline.material.uniforms.uStrength.value, 0.0);

  pipeline.setStrength(0.65);
  assert.equal(pipeline.material.uniforms.uStrength.value, 0.65);

  pipeline.setStrength(1.0);
  assert.equal(pipeline.material.uniforms.uStrength.value, 1.0);

  // Clamped bounds
  pipeline.setStrength(-0.5);
  assert.equal(pipeline.material.uniforms.uStrength.value, 0.0);

  pipeline.setStrength(1.8);
  assert.equal(pipeline.material.uniforms.uStrength.value, 1.0);

  pipeline.dispose();
});

test('LensingPipeline setSize updates resolution and height-dependent uniforms', () => {
  const pipeline = new LensingPipeline(null, 800, 600);

  pipeline.setSize(1200, 800, 1);
  assert.equal(pipeline.material.uniforms.uAspectRatio.value, 1.5);
  assert.ok(Math.abs(pipeline.material.uniforms.uHorizonRadius.value - 34.0 / 800) < 0.0001);
  assert.ok(Math.abs(pipeline.material.uniforms.uCriticalRadius.value - 48.0 / 800) < 0.0001);
  assert.ok(Math.abs(pipeline.material.uniforms.uMaxDistortionRadius.value - 440.0 / 800) < 0.0001);
  assert.ok(Math.abs(pipeline.material.uniforms.uSoftening.value - 22.0 / 800) < 0.0001);
  assert.ok(Math.abs(pipeline.material.uniforms.uEinsteinRadiusSq.value - Math.pow(95.0 / 800, 2)) < 0.0001);

  pipeline.dispose();
});

test('LensingPipeline clean disposal cleans up all WebGL resources', () => {
  const pipeline = new LensingPipeline(null, 800, 600);
  assert.doesNotThrow(() => pipeline.dispose());
});

test('snapshotPageBackground and createFallbackBackgroundCanvas generate valid textures and fallbacks', async () => {
  const fallback = createFallbackBackgroundCanvas(800, 600);
  assert.ok(fallback);
  assert.equal(fallback.width, 800);
  assert.equal(fallback.height, 600);

  const snapshot = await snapshotPageBackground(1000, 700);
  assert.ok(snapshot);
  assert.equal(snapshot.width, 1000);
  assert.equal(snapshot.height, 700);
  assert.ok(snapshot.texture instanceof THREE.CanvasTexture);
  assert.equal(snapshot.texture.colorSpace, THREE.SRGBColorSpace);
  assert.equal(snapshot.texture.flipY, false);
  assert.equal(snapshot.texture.minFilter, THREE.LinearFilter);
  assert.equal(snapshot.texture.magFilter, THREE.LinearFilter);
  assert.equal(snapshot.source, 'FALLBACK');
  assert.equal(SNAPSHOT_TIMEOUT_MS, 900);
});

test('GravityScene initializes with LensingPipeline and handles background & lensing strength', () => {
  const mockCanvas = {
    dataset: {},
    style: {},
  };

  const mockRenderer = {
    autoClear: true,
    setPixelRatio: () => {},
    setClearColor: () => {},
    setSize: () => {},
    render: () => {},
    setRenderTarget: () => {},
    clear: () => {},
    dispose: () => {},
  };

  const scene = new GravityScene(mockCanvas, { renderer: mockRenderer });
  assert.ok(scene.lensingPipeline instanceof LensingPipeline);
  assert.equal(scene.lensingStrength, 0);
  assert.equal(scene.isLensingActive(), false);

  // Set lensing strength
  scene.setLensingStrength(0.5);
  assert.equal(scene.lensingStrength, 0.5);
  assert.equal(scene.lensingPipeline.material.uniforms.uStrength.value, 0.5);
  assert.equal(scene.isLensingActive(), true);

  // Background management
  const mockSnapshot = {
    canvas: { width: 800, height: 600 },
    width: 800,
    height: 600,
    source: 'REAL_SNAPSHOT',
  };
  scene.setBackground(mockSnapshot);
  assert.ok(scene.backgroundMesh);
  assert.equal(scene.backgroundMesh.renderOrder, 0);
  assert.equal(scene.backgroundMesh.position.z, -5);
  assert.equal(scene.backgroundMesh.material.side, THREE.DoubleSide);
  assert.equal(mockCanvas.dataset.backgroundSource, 'REAL_SNAPSHOT');

  scene.clearBackground();
  assert.equal(scene.backgroundMesh, null);
  assert.equal(mockCanvas.dataset.backgroundSource, undefined);

  // Render method does not throw when lensing active or inactive
  scene.setLensingStrength(1.0);
  assert.doesNotThrow(() => scene.render());

  scene.setLensingStrength(0.0);
  assert.doesNotThrow(() => scene.render());

  scene.dispose();
});
