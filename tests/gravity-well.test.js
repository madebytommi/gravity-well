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

test('overlapping bodies separate and exchange a stable collision impulse', () => {
  const simulation = new GravitySimulation({ center: { x: 900, y: 900 }, strength: .45 });
  const first = { x: 200, y: 200, originX: 200, originY: 200, width: 40, height: 40, radius: 30, mass: 1, vx: 20, vy: 0 };
  const second = { x: 245, y: 200, originX: 245, originY: 200, width: 40, height: 40, radius: 30, mass: 1, vx: -20, vy: 0 };
  simulation.addBody(first); simulation.addBody(second);
  simulation.resolveCollisions();
  assert.ok(Math.hypot(second.x - first.x, second.y - first.y) >= 59.99);
  assert.ok(first.vx < 0 && second.vx > 0);
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
