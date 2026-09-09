import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG } from '../src/config.js';
import { PointerGrabber } from '../src/pointer.js';
import {
  DESTRUCTION_PHASES,
  PHASE_THRESHOLDS,
  getDestructionPhase,
  getBodyCategory,
  getStripCount,
  getDebrisCount,
  DestructionManager,
} from '../src/destruction.js';

function createMockSprite() {
  const geom = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial();
  const sprite = new THREE.Mesh(geom, mat);
  sprite.userData = {
    texture: new THREE.Texture(),
    material: mat,
  };
  return sprite;
}

test('phase identification correctly classifies progress across all destruction phases', () => {
  assert.equal(getDestructionPhase(0.0), DESTRUCTION_PHASES.APPROACH);
  assert.equal(getDestructionPhase(0.05), DESTRUCTION_PHASES.APPROACH);
  assert.equal(getDestructionPhase(0.149), DESTRUCTION_PHASES.APPROACH);

  assert.equal(getDestructionPhase(0.15), DESTRUCTION_PHASES.TIDAL_STRETCH);
  assert.equal(getDestructionPhase(0.25), DESTRUCTION_PHASES.TIDAL_STRETCH);
  assert.equal(getDestructionPhase(0.349), DESTRUCTION_PHASES.TIDAL_STRETCH);

  assert.equal(getDestructionPhase(0.35), DESTRUCTION_PHASES.SHEAR);
  assert.equal(getDestructionPhase(0.50), DESTRUCTION_PHASES.SHEAR);
  assert.equal(getDestructionPhase(0.649), DESTRUCTION_PHASES.SHEAR);

  assert.equal(getDestructionPhase(0.65), DESTRUCTION_PHASES.FRAGMENT);
  assert.equal(getDestructionPhase(0.75), DESTRUCTION_PHASES.FRAGMENT);
  assert.equal(getDestructionPhase(0.879), DESTRUCTION_PHASES.FRAGMENT);

  assert.equal(getDestructionPhase(0.88), DESTRUCTION_PHASES.FINAL_INTAKE);
  assert.equal(getDestructionPhase(0.95), DESTRUCTION_PHASES.FINAL_INTAKE);
  assert.equal(getDestructionPhase(0.999), DESTRUCTION_PHASES.FINAL_INTAKE);

  assert.equal(getDestructionPhase(1.0), DESTRUCTION_PHASES.CAPTURED);
  assert.equal(getDestructionPhase(1.1), DESTRUCTION_PHASES.CAPTURED);

  assert.equal(PHASE_THRESHOLDS.APPROACH_END, 0.15);
  assert.equal(PHASE_THRESHOLDS.TIDAL_STRETCH_END, 0.35);
  assert.equal(PHASE_THRESHOLDS.SHEAR_END, 0.65);
  assert.equal(PHASE_THRESHOLDS.FRAGMENT_END, 0.88);
  assert.equal(PHASE_THRESHOLDS.FINAL_INTAKE_END, 1.0);
});

test('DestructionManager updates body phase and visual properties across progress lifecycle', () => {
  const bodiesGroup = new THREE.Group();
  const manager = new DestructionManager(bodiesGroup);
  const center = { x: 500, y: 500 };

  const body = {
    id: 'signal',
    x: 400,
    y: 500,
    width: 200,
    height: 150,
    angle: 0,
    scale: 1,
    opacity: 1,
    status: 'CAPTURING',
    captureProgress: 0.05,
    sprite: createMockSprite(),
  };

  // Phase 1: APPROACH (< 0.15)
  manager.updateBody(body, center);
  assert.equal(body.destructionPhase, DESTRUCTION_PHASES.APPROACH);
  assert.equal(body.destructionUngrabbable, false);
  assert.equal(body.sprite.visible, true);

  // Phase 2: TIDAL_STRETCH (0.15 <= p < 0.35)
  body.captureProgress = 0.25;
  manager.updateBody(body, center);
  assert.equal(body.destructionPhase, DESTRUCTION_PHASES.TIDAL_STRETCH);
  assert.equal(body.destructionUngrabbable, false);
  assert.equal(body.sprite.visible, true);
  assert.ok(body.sprite.scale.x > body.width, 'Should stretch along infall axis');
  assert.ok(body.sprite.scale.y < body.height, 'Should compress across perpendicular axis');

  // Phase 3: SHEAR (0.35 <= p < 0.65)
  body.captureProgress = 0.45;
  body.grabbed = true;
  manager.updateBody(body, center);
  assert.equal(body.destructionPhase, DESTRUCTION_PHASES.SHEAR);
  assert.equal(body.destructionUngrabbable, true);
  assert.equal(body.grabbed, false, 'Grab should be released upon entering SHEAR');
  assert.equal(body.sprite.visible, false, 'Base sprite should be hidden during SHEAR');
  assert.ok(manager.activeDestructions.has(body), 'Active destruction record should exist');
  const record = manager.activeDestructions.get(body);
  assert.equal(record.strips.length, 5, 'Large card should have 5 strips');
  assert.equal(record.debris.length, 8, 'Debris count should be 8');
  assert.ok(record.strips.every((s) => s.mesh.visible));

  // Phase 4: FRAGMENT (0.65 <= p < 0.88)
  body.captureProgress = 0.75;
  manager.updateBody(body, center);
  assert.equal(body.destructionPhase, DESTRUCTION_PHASES.FRAGMENT);
  assert.equal(body.destructionUngrabbable, true);
  assert.equal(body.sprite.visible, false);

  // Phase 5: FINAL_INTAKE (0.88 <= p < 1.0)
  body.captureProgress = 0.95;
  manager.updateBody(body, center);
  assert.equal(body.destructionPhase, DESTRUCTION_PHASES.FINAL_INTAKE);
  assert.equal(body.destructionUngrabbable, true);
  assert.equal(body.sprite.visible, false);
  assert.ok(record.strips[0].mesh.material.opacity < 0.5, 'Filaments should fade out toward intake');

  // Phase 6: CAPTURED (p >= 1.0)
  body.captureProgress = 1.0;
  manager.updateBody(body, center);
  assert.equal(body.destructionPhase, DESTRUCTION_PHASES.CAPTURED);
  assert.equal(manager.activeDestructions.has(body), false, 'Record should be removed on capture');
  assert.equal(bodiesGroup.children.length, 0, 'All strips and debris should be cleanly removed on capture');
});

test('fragment counts by body category remain strictly within bounds (2 to 6)', () => {
  const largeCards = ['signal', 'question', 'map', 'measure', 'fragment'];
  for (const id of largeCards) {
    const body = { id, element: { classList: { contains: (cls) => cls === 'object-card' } } };
    assert.equal(getBodyCategory(body), 'LARGE_CARD');
    const count = getStripCount(body);
    assert.ok(count >= 4 && count <= 6, `Large card ${id} count ${count} must be between 4 and 6`);
  }

  const headlineFragments = ['headline-1', 'headline-2', 'hero-lede'];
  for (const id of headlineFragments) {
    const body = { id };
    assert.equal(getBodyCategory(body), 'HEADLINE');
    const count = getStripCount(body);
    assert.ok(count >= 3 && count <= 5, `Headline fragment ${id} count ${count} must be between 3 and 5`);
  }

  const smallElements = [
    'header-meta',
    'eyebrow',
    'visual-caption',
    'site-nav',
    'action-note',
    'satellite-one',
    'satellite-two',
  ];
  for (const id of smallElements) {
    const body = { id };
    assert.equal(getBodyCategory(body), 'SMALL_ELEMENT');
    const count = getStripCount(body);
    assert.ok(count >= 2 && count <= 3, `Small element ${id} count ${count} must be between 2 and 3`);
  }

  // Verify all 15 candidate IDs are within overall bounds [2, 6]
  const allCandidates = [...largeCards, ...headlineFragments, ...smallElements];
  for (const id of allCandidates) {
    const count = getStripCount({ id });
    assert.ok(count >= 2 && count <= 6, `Element ${id} count ${count} must be in [2, 6]`);
    const debris = getDebrisCount({ id });
    assert.ok(debris >= 6 && debris <= 10, `Element ${id} debris count ${debris} must be in [6, 10]`);
  }
});

test('pointer pick filters out bodies at or beyond destruction threshold (progress >= 0.35)', () => {
  const normalBody = {
    x: 100,
    y: 100,
    width: 80,
    height: 60,
    angle: 0,
    status: 'ACTIVE',
    captureProgress: 0,
    destructionUngrabbable: false,
  };

  const earlyCapturingBody = {
    x: 100,
    y: 100,
    width: 80,
    height: 60,
    angle: 0,
    status: 'CAPTURING',
    captureProgress: 0.20,
    destructionUngrabbable: false,
  };

  const shearBody = {
    x: 100,
    y: 100,
    width: 80,
    height: 60,
    angle: 0,
    status: 'CAPTURING',
    captureProgress: 0.35,
    destructionUngrabbable: true,
  };

  const advancedBody = {
    x: 100,
    y: 100,
    width: 80,
    height: 60,
    angle: 0,
    status: 'CAPTURING',
    captureProgress: 0.70,
    destructionUngrabbable: true,
  };

  const ungrabbableOnlyBody = {
    x: 100,
    y: 100,
    width: 80,
    height: 60,
    angle: 0,
    status: 'ACTIVE',
    captureProgress: 0.10,
    destructionUngrabbable: true,
  };

  const mockCanvas = {
    addEventListener: () => {},
    removeEventListener: () => {},
    setPointerCapture: () => {},
  };

  // Normal active body should be pickable
  const grabber1 = new PointerGrabber(mockCanvas, { getBodies: () => [normalBody] });
  assert.equal(grabber1.pick(100, 100), normalBody);

  // Early capturing body (< 0.35) should still be pickable
  const grabber2 = new PointerGrabber(mockCanvas, { getBodies: () => [earlyCapturingBody] });
  assert.equal(grabber2.pick(100, 100), earlyCapturingBody);

  // Body at threshold 0.35 must be filtered out
  const grabber3 = new PointerGrabber(mockCanvas, { getBodies: () => [shearBody] });
  assert.equal(grabber3.pick(100, 100), null);

  // Advanced body (progress 0.70) must be filtered out
  const grabber4 = new PointerGrabber(mockCanvas, { getBodies: () => [advancedBody] });
  assert.equal(grabber4.pick(100, 100), null);

  // Body with destructionUngrabbable = true must be filtered out regardless of progress
  const grabber5 = new PointerGrabber(mockCanvas, { getBodies: () => [ungrabbableOnlyBody] });
  assert.equal(grabber5.pick(100, 100), null);
});

test('safe disposal and reset cleanup leave zero leftover fragments or memory leaks', () => {
  const bodiesGroup = new THREE.Group();
  const manager = new DestructionManager(bodiesGroup);
  const center = { x: 400, y: 300 };

  const bodyA = {
    id: 'signal',
    x: 350,
    y: 300,
    width: 120,
    height: 90,
    angle: 0,
    status: 'CAPTURING',
    captureProgress: 0.45, // SHEAR
    sprite: createMockSprite(),
  };

  const bodyB = {
    id: 'headline-1',
    x: 450,
    y: 300,
    width: 140,
    height: 40,
    angle: 0,
    status: 'CAPTURING',
    captureProgress: 0.72, // FRAGMENT
    sprite: createMockSprite(),
  };

  // Run update to create strips and debris in bodiesGroup
  manager.updateBody(bodyA, center);
  manager.updateBody(bodyB, center);

  const initialStripsA = getStripCount(bodyA);
  const initialDebrisA = getDebrisCount(bodyA);
  const initialStripsB = getStripCount(bodyB);
  const initialDebrisB = getDebrisCount(bodyB);
  const expectedTotalMeshes = initialStripsA + initialDebrisA + initialStripsB + initialDebrisB;

  assert.equal(bodiesGroup.children.length, expectedTotalMeshes);
  assert.equal(manager.activeDestructions.size, 2);

  // Verify UVs on bodyA strips correctly partition parent texture from 1.0 down to 0.0
  const recordA = manager.activeDestructions.get(bodyA);
  for (let i = 0; i < recordA.strips.length; i += 1) {
    const strip = recordA.strips[i];
    const uvs = strip.mesh.geometry.attributes.uv;
    const v1Expected = 1 - i / recordA.strips.length;
    const v0Expected = 1 - (i + 1) / recordA.strips.length;
    assert.ok(Math.abs(uvs.getY(0) - v1Expected) < 1e-5);
    assert.ok(Math.abs(uvs.getY(1) - v1Expected) < 1e-5);
    assert.ok(Math.abs(uvs.getY(2) - v0Expected) < 1e-5);
    assert.ok(Math.abs(uvs.getY(3) - v0Expected) < 1e-5);
  }

  // Single body capture disposal
  manager.onCapture(bodyA);
  assert.equal(manager.activeDestructions.has(bodyA), false);
  assert.equal(bodiesGroup.children.length, initialStripsB + initialDebrisB);

  // Full reset cleanup
  manager.reset([bodyA, bodyB]);
  assert.equal(bodiesGroup.children.length, 0, 'Must have zero leftover fragment meshes in bodiesGroup');
  assert.equal(manager.activeDestructions.size, 0, 'Active destructions map must be empty');
  assert.equal(bodyA.destructionUngrabbable, false);
  assert.equal(bodyB.destructionUngrabbable, false);
  assert.equal(bodyA.sprite.visible, true);
  assert.equal(bodyB.sprite.visible, true);

  // Multiple consecutive destruction and reset cycles to verify leak-free reusability
  for (let cycle = 0; cycle < 3; cycle += 1) {
    bodyA.captureProgress = 0.5;
    bodyB.captureProgress = 0.8;
    manager.updateBody(bodyA, center);
    manager.updateBody(bodyB, center);
    assert.equal(bodiesGroup.children.length, expectedTotalMeshes);

    manager.reset([bodyA, bodyB]);
    assert.equal(bodiesGroup.children.length, 0, `Cycle ${cycle} reset must leave zero leftover fragments`);
    assert.equal(manager.activeDestructions.size, 0);
  }
});

test('physics simulation constants and configuration remain strictly unchanged', () => {
  assert.equal(CONFIG.gravityConstant, 1_350_000, 'gravityConstant must remain 1,350,000');
  assert.equal(CONFIG.captureRadius, 54, 'captureRadius must remain 54');
  assert.equal(CONFIG.captureDelay, 3.2, 'captureDelay must remain 3.2');
  assert.equal(CONFIG.captureDuration, 1.15, 'captureDuration must remain 1.15');
  assert.equal(CONFIG.fixedStep, 1 / 60, 'fixedStep must remain 1/60');
  assert.equal(CONFIG.maxFrameDelta, 0.05, 'maxFrameDelta must remain 0.05');
  assert.equal(CONFIG.maxAccumulator, 0.25, 'maxAccumulator must remain 0.25');
  assert.equal(CONFIG.softening, 72, 'softening must remain 72');
  assert.equal(CONFIG.maxSpeed, 840, 'maxSpeed must remain 840');
  assert.equal(CONFIG.restitution, 0.74, 'restitution must remain 0.74');
  assert.equal(CONFIG.transitionMs, 720, 'transitionMs must remain 720');
  assert.equal(CONFIG.resetMs, 420, 'resetMs must remain 420');
  assert.equal(CONFIG.defaultStrength, 1, 'defaultStrength must remain 1');
  assert.equal(CONFIG.minStrength, 0.45, 'minStrength must remain 0.45');
  assert.equal(CONFIG.maxStrength, 1.6, 'maxStrength must remain 1.6');
});
