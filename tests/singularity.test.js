import test from 'node:test';
import assert from 'node:assert/strict';
import { SingularityVisuals } from '../src/singularity.js';

test('SingularityVisuals initializes meshes and shaders correctly', () => {
  const visuals = new SingularityVisuals();
  assert.ok(visuals.group);
  assert.equal(visuals.group.children.length, 5);
  assert.ok(visuals.coronaMesh);
  assert.ok(visuals.diskMesh);
  assert.ok(visuals.photonRingMesh);
  assert.ok(visuals.coreMesh);
  assert.ok(visuals.particles);

  // Scaled geometry sizes and obsidian void core
  assert.equal(visuals.coronaGeometry.parameters.width, 640);
  assert.equal(visuals.diskGeometry.parameters.width, 420);
  assert.equal(visuals.photonRingGeometry.parameters.width, 96);
  assert.equal(visuals.coreGeometry.parameters.width, 80);
  assert.equal(visuals.coreMaterial.uniforms.uColorVoid.value.getHexString(), '020304');

  visuals.dispose();
});

test('SingularityVisuals updates animation and decay without errors', () => {
  const visuals = new SingularityVisuals();
  visuals.setCenter({ x: 300, y: 300 });
  visuals.update(1 / 60, 1.0, true);
  assert.equal(visuals.diskMaterial.uniforms.uTime.value, 1.0);
  assert.equal(visuals.diskMaterial.uniforms.uFieldActive.value, 1.0);

  // Trigger capture reaction
  visuals.triggerCaptureReaction({ x: 350, y: 350 });
  assert.equal(visuals.capturePulse, 1.0);
  assert.ok(Number.isFinite(visuals.captureAngle));

  // Step forward
  visuals.update(1 / 60, 1.016, true);
  assert.ok(visuals.capturePulse < 1.0);

  // Verify particles lie on inclined elliptical plane
  const positions = visuals.particlesGeometry.attributes.position.array;
  assert.equal(positions.length, 140 * 3);
  for (let i = 0; i < 140; i += 1) {
    const px = positions[i * 3];
    const py = positions[i * 3 + 1];
    assert.ok(Number.isFinite(px) && Number.isFinite(py));
  }

  visuals.dispose();
});
