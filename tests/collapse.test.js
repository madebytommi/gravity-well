import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CollapseChoreographer,
  COLLAPSE_STAGES,
  COLLAPSE_THRESHOLDS,
  COLLAPSE_STAGE_TARGETS,
  calculateMicroStressOffset,
  calculateReleaseImpulse,
} from '../src/collapse.js';
import { GravitySimulation } from '../src/simulation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('index.html contains all 8 curated collapse candidates with correct stages', () => {
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf-8');

  // Verify all 8 elements with data-collapse and data-collapse-stage
  const collapseMatches = [...html.matchAll(/data-collapse="([^"]+)"\s+data-collapse-stage="([^"]+)"/g)];
  assert.equal(collapseMatches.length, 8, 'Must have exactly 8 collapse candidates in index.html');

  const candidates = Object.fromEntries(collapseMatches.map((m) => [m[1], m[2]]));

  // Stage B
  assert.equal(candidates['header-meta'], 'B');
  assert.equal(candidates['eyebrow'], 'B');
  assert.equal(candidates['visual-caption'], 'B');

  // Stage C
  assert.equal(candidates['site-nav'], 'C');
  assert.equal(candidates['hero-lede'], 'C');
  assert.equal(candidates['action-note'], 'C');

  // Stage D
  assert.equal(candidates['headline-1'], 'D');
  assert.equal(candidates['headline-2'], 'D');

  // Verify h1#page-title structure contains the two headline-part spans
  assert.ok(
    html.includes('<h1 id="page-title"><span class="headline-part" data-collapse="headline-1" data-collapse-stage="D">Where structure</span><br /><span class="headline-part" data-collapse="headline-2" data-collapse-stage="D"><em>gives in.</em></span></h1>'),
    'h1#page-title must be split into two headline-part spans'
  );
});

test('src/styles.css configures .headline-part as display: inline-block', () => {
  const css = fs.readFileSync(path.join(rootDir, 'src/styles.css'), 'utf-8');
  assert.ok(
    /\.headline-part\s*\{[^}]*display:\s*inline-block/i.test(css),
    '.headline-part must have display: inline-block in styles.css'
  );
});

test('src/conversion.js excludes [data-collapse] elements alongside [data-gravity]', () => {
  const conversionCode = fs.readFileSync(path.join(rootDir, 'src/conversion.js'), 'utf-8');
  assert.ok(
    conversionCode.includes('[data-gravity], [data-collapse]'),
    'snapshotPageBackground must query both [data-gravity] and [data-collapse]'
  );
});

test('CollapseChoreographer defines correct stage thresholds and targets', () => {
  assert.equal(COLLAPSE_THRESHOLDS.A, 0.0);
  assert.equal(COLLAPSE_THRESHOLDS.B, 0.9);
  assert.equal(COLLAPSE_THRESHOLDS.C, 2.0);
  assert.equal(COLLAPSE_THRESHOLDS.D, 3.2);

  assert.deepEqual(COLLAPSE_STAGE_TARGETS.B, ['header-meta', 'eyebrow', 'visual-caption']);
  assert.deepEqual(COLLAPSE_STAGE_TARGETS.C, ['site-nav', 'hero-lede', 'action-note']);
  assert.deepEqual(COLLAPSE_STAGE_TARGETS.D, ['headline-1', 'headline-2']);
});

test('calculateMicroStressOffset ramps smoothly to 0.5px toward center', () => {
  const originX = 100;
  const originY = 100;
  const center = { x: 500, y: 100 }; // Center is directly to the right (+x direction)

  // At elapsed = 0.0s, offset is 0
  const offset0 = calculateMicroStressOffset(originX, originY, center, 0.0);
  assert.equal(offset0.x, 0);
  assert.equal(offset0.y, 0);

  // At elapsed = 0.45s (halfway to 0.9s), offset is ~0.25px towards center
  const offsetHalf = calculateMicroStressOffset(originX, originY, center, 0.45);
  assert.ok(Math.abs(offsetHalf.x - 0.25) < 0.001);
  assert.equal(offsetHalf.y, 0);

  // At elapsed = 0.9s, offset reaches maximum 0.5px towards center
  const offsetMax = calculateMicroStressOffset(originX, originY, center, 0.9);
  assert.ok(Math.abs(offsetMax.x - 0.5) < 0.001);
  assert.equal(offsetMax.y, 0);

  // Past 0.9s, offset remains clamped at 0.5px
  const offsetClamped = calculateMicroStressOffset(originX, originY, center, 1.5);
  assert.ok(Math.abs(offsetClamped.x - 0.5) < 0.001);
  assert.equal(offsetClamped.y, 0);
});

test('calculateReleaseImpulse yields deterministic tangential and inward impulse', () => {
  const center = { x: 500, y: 300 };

  // Small release (Stage B)
  const bodyB = { x: 400, y: 300, stage: 'B', collapseId: 'eyebrow' };
  const impulseB = calculateReleaseImpulse(bodyB, center, 0);
  assert.ok(impulseB.vx > 0, 'Inward velocity toward center (+x)');
  assert.ok(Math.abs(impulseB.vy) > 0, 'Tangential velocity');
  assert.ok(Number.isFinite(impulseB.angularVelocity));

  // Hero failure (Stage D)
  const bodyD = { x: 400, y: 300, stage: 'D', collapseId: 'headline-1' };
  const impulseD = calculateReleaseImpulse(bodyD, center, 0);
  assert.ok(impulseD.vx > 0, 'Inward velocity toward center (+x)');
  assert.ok(Math.abs(impulseD.vy) > 0, 'Tangential velocity');
  assert.equal(bodyD.ignorePairwiseCollisions, true);
  assert.ok(bodyD.mass >= 3.0 && bodyD.mass <= 3.5);
});

test('CollapseChoreographer coordinates staged releases across phases A, B, C, D', () => {
  const choreographer = new CollapseChoreographer();
  const center = { x: 600, y: 400 };

  const candidateConfigs = [
    { id: 'header-meta', stage: 'B', x: 800, y: 40 },
    { id: 'eyebrow', stage: 'B', x: 200, y: 150 },
    { id: 'visual-caption', stage: 'B', x: 750, y: 450 },
    { id: 'site-nav', stage: 'C', x: 500, y: 40 },
    { id: 'hero-lede', stage: 'C', x: 250, y: 320 },
    { id: 'action-note', stage: 'C', x: 380, y: 420 },
    { id: 'headline-1', stage: 'D', x: 300, y: 220 },
    { id: 'headline-2', stage: 'D', x: 300, y: 280 },
  ];

  for (const conf of candidateConfigs) {
    choreographer.addBody({
      id: conf.id,
      stage: conf.stage,
      x: conf.x,
      y: conf.y,
      originX: conf.x,
      originY: conf.y,
      width: 100,
      height: 30,
      status: 'PINNED',
    });
  }

  assert.equal(choreographer.getPinnedBodies().length, 8);
  assert.equal(choreographer.getReleasedBodies().length, 0);

  // Phase A: 0.0s - 0.9s
  choreographer.update(0.4, 1 / 60, center);
  assert.equal(choreographer.getCurrentStage(), 'A');
  assert.equal(choreographer.isStageReleased('B'), false);
  assert.equal(choreographer.isStageReleased('C'), false);
  assert.equal(choreographer.isStageReleased('D'), false);
  assert.equal(choreographer.getPinnedBodies().length, 8);

  // Verify micro-stress has slightly displaced pinned bodies toward center
  const pinnedMeta = choreographer.getBody('header-meta');
  assert.notEqual(pinnedMeta.x, pinnedMeta.originX);
  assert.ok(Math.hypot(pinnedMeta.x - pinnedMeta.originX, pinnedMeta.y - pinnedMeta.originY) <= 0.5);

  // Phase B: at 0.9s
  choreographer.update(0.95, 1 / 60, center);
  assert.equal(choreographer.getCurrentStage(), 'B');
  assert.equal(choreographer.isStageReleased('B'), true);
  assert.equal(choreographer.isStageReleased('C'), false);
  assert.equal(choreographer.isStageReleased('D'), false);

  const stageBBodies = choreographer.getBodiesForStage('B');
  for (const b of stageBBodies) {
    assert.equal(b.status, 'ACTIVE');
    assert.equal(b.released, true);
    assert.ok(Math.hypot(b.vx, b.vy) > 0);
  }
  assert.equal(choreographer.getPinnedBodies().length, 5); // 3 released, 5 still pinned
  assert.equal(choreographer.getReleasedBodies().length, 3);

  // Phase C: at 2.0s
  choreographer.update(2.05, 1 / 60, center);
  assert.equal(choreographer.getCurrentStage(), 'C');
  assert.equal(choreographer.isStageReleased('C'), true);
  assert.equal(choreographer.isStageReleased('D'), false);

  const stageCBodies = choreographer.getBodiesForStage('C');
  for (const b of stageCBodies) {
    assert.equal(b.status, 'ACTIVE');
    assert.equal(b.released, true);
    assert.ok(Math.hypot(b.vx, b.vy) > 0);
  }
  assert.equal(choreographer.getPinnedBodies().length, 2); // only Stage D left
  assert.equal(choreographer.getReleasedBodies().length, 6);

  // Phase D: at 3.2s
  choreographer.update(3.25, 1 / 60, center);
  assert.equal(choreographer.getCurrentStage(), 'D');
  assert.equal(choreographer.isStageReleased('D'), true);

  const stageDBodies = choreographer.getBodiesForStage('D');
  for (const b of stageDBodies) {
    assert.equal(b.status, 'ACTIVE');
    assert.equal(b.released, true);
    assert.equal(b.ignorePairwiseCollisions, true);
    assert.ok(b.mass >= 3.0 && b.mass <= 3.5);
    assert.ok(Math.hypot(b.vx, b.vy) > 0);
  }
  assert.equal(choreographer.getPinnedBodies().length, 0);
  assert.equal(choreographer.getReleasedBodies().length, 8);
});

test('GravitySimulation skips PINNED bodies and respects ignorePairwiseCollisions', () => {
  const simulation = new GravitySimulation({ center: { x: 500, y: 500 }, strength: 1.0 });

  // 1. PINNED body should remain completely stationary
  const pinned = {
    id: 'header-meta',
    x: 200,
    y: 200,
    originX: 200,
    originY: 200,
    vx: 0,
    vy: 0,
    radius: 20,
    mass: 1,
    status: 'PINNED',
  };
  simulation.addBody(pinned);

  for (let i = 0; i < 30; i += 1) {
    simulation.step(1 / 60);
  }
  assert.equal(pinned.x, 200, 'Pinned body x position must not change during simulation step');
  assert.equal(pinned.y, 200, 'Pinned body y position must not change during simulation step');
  assert.equal(pinned.vx, 0);
  assert.equal(pinned.vy, 0);

  // 2. Collision resolution with ignorePairwiseCollisions
  const heavyHeadline = {
    id: 'headline-1',
    x: 300,
    y: 300,
    originX: 300,
    originY: 300,
    vx: 20,
    vy: 0,
    radius: 30,
    mass: 3.2,
    status: 'ACTIVE',
    ignorePairwiseCollisions: true,
  };
  const smallCard = {
    id: 'signal',
    x: 320,
    y: 300,
    originX: 320,
    originY: 300,
    vx: -20,
    vy: 0,
    radius: 30,
    mass: 1.0,
    status: 'ACTIVE',
  };

  const simWithCollision = new GravitySimulation({ center: { x: 900, y: 900 } });
  simWithCollision.addBody(heavyHeadline);
  simWithCollision.addBody(smallCard);

  // Since distance is 20 and minimum radius is 60, they overlap.
  // But heavyHeadline has ignorePairwiseCollisions = true, so collision must be skipped!
  simWithCollision.resolveCollisions();
  assert.equal(heavyHeadline.vx, 20, 'Headline vx must not change');
  assert.equal(smallCard.vx, -20, 'Small card vx must not change when colliding with headline');
  assert.equal(heavyHeadline.x, 300, 'Headline position must not be displaced by collision');
  assert.equal(smallCard.x, 320, 'Small card position must not be displaced by collision');
});

test('CollapseChoreographer reset restores all bodies cleanly to origin and PINNED status', () => {
  const choreographer = new CollapseChoreographer();
  const center = { x: 500, y: 500 };

  const body = choreographer.addBody({
    id: 'eyebrow',
    stage: 'B',
    x: 200,
    y: 100,
    originX: 200,
    originY: 100,
    status: 'PINNED',
  });

  // Advance time past Stage B threshold to release
  choreographer.update(1.2, 1 / 60, center);
  assert.equal(body.status, 'ACTIVE');
  assert.equal(body.released, true);
  assert.ok(Math.hypot(body.vx, body.vy) > 0);

  // Simulate body movement
  body.x = 240;
  body.y = 130;
  body.angle = 0.45;

  // Reset choreographer
  choreographer.reset();
  assert.equal(choreographer.elapsed, 0);
  assert.equal(body.status, 'PINNED');
  assert.equal(body.released, false);
  assert.equal(body.x, body.originX);
  assert.equal(body.y, body.originY);
  assert.equal(body.vx, 0);
  assert.equal(body.vy, 0);
  assert.equal(body.angle, 0);
  assert.equal(body.angularVelocity, 0);
  assert.equal(choreographer.getPinnedBodies().length, 1);
  assert.equal(choreographer.getReleasedBodies().length, 0);
});
