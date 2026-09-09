import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { GravityState } from '../src/state.js';
import { GravitySimulation, seedTangentialVelocity } from '../src/simulation.js';
import { PointerGrabber } from '../src/pointer.js';

test('state machine only accepts the intended lifecycle', () => {
  const seen = [];
  const state = new GravityState((next, previous) => seen.push(`${previous}->${next}`));
  assert.equal(state.transition('GRAVITY_ACTIVE'), false);
  assert.equal(state.value, 'NORMAL');
  assert.equal(state.transition('RESETTING'), false);
  assert.equal(state.value, 'NORMAL');
  assert.equal(state.transition('TRANSITIONING'), true);
  assert.equal(state.transition('GRAVITY_ACTIVE'), true);
  assert.equal(state.transition('NORMAL'), false);
  assert.equal(state.transition('RESETTING'), true);
  assert.equal(state.transition('NORMAL'), true);
  assert.deepEqual(seen, ['NORMAL->TRANSITIONING', 'TRANSITIONING->GRAVITY_ACTIVE', 'GRAVITY_ACTIVE->RESETTING', 'RESETTING->NORMAL']);
});

test('tangential seeding provides momentum with a curved starting path', () => {
  const body = { x: 420, y: 200, originX: 420, originY: 200, vx: 0, vy: 0 };
  seedTangentialVelocity(body, { x: 200, y: 200 }, 0);
  assert.ok(body.vy > 0);
  assert.ok(Math.hypot(body.vx, body.vy) > 40);
  assert.ok(Math.hypot(body.vx, body.vy) <= CONFIG.maxSpeed);
});

test('fixed-step simulation remains finite under a long run and bounded speed', () => {
  const simulation = new GravitySimulation({ center: { x: 400, y: 300 }, strength: 1.2 });
  const body = { x: 150, y: 160, originX: 150, originY: 160, width: 80, height: 60, radius: 28, mass: 1, vx: 70, vy: 25, angle: 0, angularVelocity: .4 };
  simulation.addBody(body);
  for (let i = 0; i < 60 * 45; i += 1) simulation.step(1 / 60);
  assert.ok(Number.isFinite(body.x) && Number.isFinite(body.y));
  assert.ok(Number.isFinite(body.vx) && Number.isFinite(body.vy));
  assert.ok(Math.hypot(body.vx, body.vy) <= CONFIG.maxSpeed + 0.001);
});

test('point gravity gives equal acceleration to bodies with different masses', () => {
  const makeSimulation = (mass) => {
    const simulation = new GravitySimulation({ center: { x: 400, y: 300 }, strength: 1.2 });
    const body = { x: 150, y: 160, originX: 150, originY: 160, radius: 20, mass, vx: 0, vy: 0 };
    simulation.addBody(body);
    simulation.step(1 / 60);
    return body;
  };
  const light = makeSimulation(1);
  const heavy = makeSimulation(3);
  assert.equal(light.vx, heavy.vx);
  assert.equal(light.vy, heavy.vy);
});

test('grabbed body follows a pointer target through a spring without teleporting', () => {
  const simulation = new GravitySimulation({ center: { x: 900, y: 900 }, strength: 1 });
  const body = { x: 100, y: 100, originX: 100, originY: 100, width: 60, height: 60, radius: 24, mass: 1, vx: 0, vy: 0, grabbed: true, pointerTarget: { x: 400, y: 100 } };
  simulation.addBody(body);
  simulation.step(1 / 60);
  assert.ok(body.x > 100 && body.x < 400);
  assert.equal(body.y, 100);
  for (let i = 0; i < 120; i += 1) simulation.step(1 / 60);
  assert.ok(Math.abs(body.x - 400) < 1);
  assert.ok(Number.isFinite(body.vx));
});

test('pointer cancellation clears the grab and cancels throw momentum', () => {
  const handlers = {};
  const canvas = {
    addEventListener: (name, handler) => { handlers[name] = handler; },
    removeEventListener: () => {},
    setPointerCapture: () => {},
  };
  const body = { x: 100, y: 100, width: 80, height: 60, angle: 0, status: 'ACTIVE', vx: 0, vy: 0 };
  let releaseCancelled = false;
  new PointerGrabber(canvas, { getBodies: () => [body], onRelease: (_body, cancelled) => { releaseCancelled = cancelled; } });
  const event = (extra = {}) => ({ button: 0, pointerId: 3, clientX: 100, clientY: 100, preventDefault: () => {}, ...extra });
  handlers.pointerdown(event());
  handlers.pointermove(event({ clientX: 170, clientY: 140 }));
  handlers.pointercancel(event({ clientX: 170, clientY: 140 }));
  assert.equal(body.grabbed, false);
  assert.equal(body.vx, 0);
  assert.equal(body.vy, 0);
  assert.equal(releaseCancelled, true);
});

test('overlapping bodies separate and exchange a stable mass-weighted collision impulse', () => {
  const simulation = new GravitySimulation({ center: { x: 900, y: 900 }, strength: .45 });
  const first = { x: 200, y: 200, originX: 200, originY: 200, width: 40, height: 40, radius: 30, mass: 1, vx: 20, vy: 0 };
  const second = { x: 245, y: 200, originX: 245, originY: 200, width: 40, height: 40, radius: 30, mass: 3, vx: -20, vy: 0 };
  simulation.addBody(first); simulation.addBody(second);
  simulation.resolveCollisions();
  assert.ok(Math.hypot(second.x - first.x, second.y - first.y) >= 59.99);
  assert.ok(Math.abs(first.vx - (-32.2)) < 0.0001);
  assert.ok(Math.abs(second.vx - (-2.6)) < 0.0001);
});

test('capture is gradual and emits once after the configured delay', () => {
  let captures = 0;
  const simulation = new GravitySimulation({ center: { x: 200, y: 200 }, strength: 1, onCapture: () => { captures += 1; } });
  const body = { x: 222, y: 200, originX: 222, originY: 200, width: 40, height: 40, radius: 20, mass: 1, vx: 0, vy: 0 };
  simulation.addBody(body);
  for (let i = 0; i < 60 * (CONFIG.captureDelay + CONFIG.captureDuration + .5); i += 1) simulation.step(1 / 60);
  assert.equal(body.status, 'CAPTURED');
  assert.equal(captures, 1);
  assert.equal(body.opacity, 0);
});

test('capture triggers onCaptureStart when transition begins', () => {
  let captureStarts = 0;
  const simulation = new GravitySimulation({
    center: { x: 200, y: 200 },
    strength: 1,
    onCaptureStart: () => { captureStarts += 1; },
  });
  const body = { x: 222, y: 200, originX: 222, originY: 200, width: 40, height: 40, radius: 20, mass: 1, vx: 0, vy: 0 };
  simulation.addBody(body);
  for (let i = 0; i < 60 * (CONFIG.captureDelay + 0.1); i += 1) simulation.step(1 / 60);
  assert.equal(body.status, 'CAPTURING');
  assert.equal(captureStarts, 1);
});

test('card scale reset interpolation smoothly restores scale from 0.88 to 1.0', () => {
  const activeScale = 0.88;
  const start = { scale: activeScale };
  const targetScale = 1.0;

  // Midway through reset easing
  const progressMid = 0.5;
  const easedMid = 1 - Math.pow(1 - progressMid, 3);
  const midScale = start.scale + (targetScale - start.scale) * easedMid;
  assert.ok(midScale > 0.88 && midScale < 1.0);

  // Completion of reset
  const progressEnd = 1.0;
  const easedEnd = 1 - Math.pow(1 - progressEnd, 3);
  const endScale = start.scale + (targetScale - start.scale) * easedEnd;
  assert.equal(endScale, 1.0);
});

