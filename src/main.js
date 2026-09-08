import { CONFIG, STATES, clamp } from './config.js';
import { GravityState } from './state.js';
import { GravityScene } from './scene.js';
import { GravitySimulation, seedTangentialVelocity } from './simulation.js';
import { measureElement, makeBodySprite, snapshotElement } from './conversion.js';
import { PointerGrabber } from './pointer.js';
import './styles.css';

const root = document.querySelector('.site-shell');
const canvas = document.querySelector('#gravity-canvas');
const enableButton = document.querySelector('#enable-gravity');
const resetButton = document.querySelector('#reset-gravity');
const stateLabel = document.querySelector('#state-label');
const captureCount = document.querySelector('#capture-count');
const strengthInput = document.querySelector('#gravity-strength');
const strengthValue = document.querySelector('#strength-value');
const gravityElements = [...document.querySelectorAll('[data-gravity]')];
const captureTotal = document.querySelector('#capture-total');
captureTotal.textContent = String(gravityElements.length);

const scene = new GravityScene(canvas);
const bodies = [];
let animationFrame = 0;
let previousTime = performance.now();
let accumulator = 0;
let transitionTimer = null;
let captured = 0;
let resetStartedAt = 0;
let resetTargets = new Map();
let resetFinalized = false;

function stagingPosition(index, measure) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const presets = [
    { x: .2, y: .27, scale: .62 },
    { x: .77, y: .27, scale: .58 },
    { x: .2, y: .68, scale: .52 },
    { x: .74, y: .67, scale: .56 },
    { x: .5, y: .18, scale: .48 },
  ];
  const preset = presets[index % presets.length];
  return {
    x: width * preset.x,
    y: height * preset.y,
    width: measure.width * preset.scale,
    height: measure.height * preset.scale,
  };
}

const state = new GravityState((next) => {
  root.dataset.state = next;
  stateLabel.textContent = {
    [STATES.NORMAL]: 'System normal',
    [STATES.TRANSITIONING]: 'Building field',
    [STATES.GRAVITY_ACTIVE]: 'Gravity active',
    [STATES.RESETTING]: 'Returning to origin',
  }[next];
  const fieldVisible = next === STATES.GRAVITY_ACTIVE || next === STATES.TRANSITIONING || next === STATES.RESETTING;
  root.classList.toggle('is-gravity-active', next === STATES.GRAVITY_ACTIVE || next === STATES.TRANSITIONING);
  root.classList.toggle('is-field-visible', fieldVisible);
  canvas.classList.toggle('is-active', fieldVisible);
  enableButton.disabled = next !== STATES.NORMAL;
  enableButton.setAttribute('aria-expanded', String(next === STATES.GRAVITY_ACTIVE));
});

const simulation = new GravitySimulation({
  center: scene.center,
  strength: CONFIG.defaultStrength,
  onCapture: (body) => {
    captured += 1;
    captureCount.textContent = String(captured);
    scene.syncBody(body);
    // Keep the captured plane attached at zero scale until reset so the
    // return animation can restore every source consistently.
  },
});

const pointer = new PointerGrabber(canvas, {
  getBodies: () => bodies,
  onGrab: (body) => {
    root.classList.add('is-grabbing');
    body.sprite?.material && (body.sprite.material.opacity = 1);
  },
  onMove: (body) => scene.syncBody(body),
  onRelease: () => root.classList.remove('is-grabbing'),
});

function updateStrength() {
  const strength = clamp(Number(strengthInput.value), CONFIG.minStrength, CONFIG.maxStrength);
  simulation.setStrength(strength);
  strengthValue.textContent = `${strength.toFixed(1)}×`;
}

async function enterGravity() {
  if (!state.transition(STATES.TRANSITIONING)) return;
  captured = 0;
  captureCount.textContent = '0';
  simulation.clear();
  bodies.splice(0);
  scene.resize();
  simulation.setCenter(scene.center);
  const snapshots = await Promise.all(gravityElements.map(async (element, index) => ({ element, index, snapshot: await snapshotElement(element), measure: measureElement(element) })));
  if (state.value !== STATES.TRANSITIONING) return;
  // Snapshot decoding can take longer than a frame; start the capture grace
  // period when the final body actually enters the field.
  simulation.resetClock();
  for (const { element, index, snapshot, measure } of snapshots) {
    if (state.value !== STATES.TRANSITIONING) break;
    const inViewport = measure.y + measure.height / 2 > 0 && measure.y - measure.height / 2 < window.innerHeight;
    const placement = inViewport ? measure : stagingPosition(index, measure);
    const body = {
      id: element.dataset.bodyId,
      element,
      x: placement.x,
      y: placement.y,
      originX: measure.x,
      originY: measure.y,
      width: placement.width,
      height: placement.height,
      radius: Math.max(22, Math.min(placement.width, placement.height) * .38),
      mass: clamp((measure.width * measure.height) / 26_000, .7, 2.3),
      zIndex: index,
      scale: 1,
      opacity: 1,
      status: 'ACTIVE',
      angle: 0,
      sourceVisibility: element.style.visibility,
    };
    seedTangentialVelocity(body, scene.center, index);
    const sprite = makeBodySprite(snapshot);
    scene.addBody(body, sprite);
    simulation.addBody(body);
    element.style.visibility = 'hidden';
    bodies.push(body);
    // Let each body enter on its own beat so the field reads as a release,
    // while staying short enough that the entire set is interactive quickly.
    await new Promise((resolve) => window.setTimeout(resolve, 88));
  }
  if (state.value !== STATES.TRANSITIONING) return;
  window.clearTimeout(transitionTimer);
  transitionTimer = window.setTimeout(() => state.transition(STATES.GRAVITY_ACTIVE), CONFIG.transitionMs);
  scene.render();
}

function resetGravity() {
  if (!state.canTransition(STATES.RESETTING)) return;
  state.transition(STATES.RESETTING);
  pointer.end(null, true);
  window.clearTimeout(transitionTimer);
  resetStartedAt = performance.now();
  resetFinalized = false;
  resetTargets = new Map(gravityElements.map((element) => [element.dataset.bodyId, measureElement(element)]));
  for (const body of bodies) {
    body.resetStart = { x: body.x, y: body.y, width: body.width, height: body.height, angle: body.angle || 0, scale: body.scale ?? 1, opacity: body.opacity ?? 1 };
    body.resetTarget = resetTargets.get(body.id) ?? { x: body.originX, y: body.originY, width: body.width, height: body.height };
    body.status = 'RESETTING';
    body.scale = body.resetStart.scale;
    body.opacity = body.resetStart.opacity;
  }
}

function finalizeReset() {
  if (resetFinalized) return;
  resetFinalized = true;
  for (const body of bodies) {
    body.element.style.visibility = body.sourceVisibility ?? '';
    scene.removeBody(body);
  }
  bodies.splice(0);
  simulation.clear();
  captured = 0;
  captureCount.textContent = '0';
  root.classList.remove('is-grabbing');
  resetTargets = new Map();
  state.transition(STATES.NORMAL);
  scene.render();
}

function animate(now) {
  const frameDelta = Math.min(CONFIG.maxFrameDelta, Math.max(0, (now - previousTime) / 1000));
  previousTime = now;
  if (state.value === STATES.GRAVITY_ACTIVE || state.value === STATES.TRANSITIONING) {
    accumulator = Math.min(CONFIG.maxAccumulator, accumulator + frameDelta);
    while (accumulator >= CONFIG.fixedStep) {
      simulation.step(CONFIG.fixedStep);
      accumulator -= CONFIG.fixedStep;
    }
    for (const body of bodies) scene.syncBody(body);
    scene.render();
  }
  if (state.value === STATES.RESETTING) {
    const progress = clamp((now - resetStartedAt) / CONFIG.resetMs, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    for (const body of bodies) {
      const start = body.resetStart;
      const target = body.resetTarget;
      body.x = start.x + (target.x - start.x) * eased;
      body.y = start.y + (target.y - start.y) * eased;
      body.width = start.width + (target.width - start.width) * eased;
      body.height = start.height + (target.height - start.height) * eased;
      body.angle = start.angle * (1 - eased);
      body.scale = start.scale + (1 - start.scale) * eased;
      body.opacity = start.opacity + (1 - start.opacity) * eased;
      scene.syncBody(body);
    }
    scene.render();
    if (progress >= 1) finalizeReset();
  }
  animationFrame = window.requestAnimationFrame(animate);
}

strengthInput.addEventListener('input', updateStrength);
enableButton.addEventListener('click', enterGravity);
resetButton.addEventListener('click', resetGravity);
window.addEventListener('resize', () => {
  scene.resize();
  if (state.value === STATES.GRAVITY_ACTIVE || state.value === STATES.TRANSITIONING) {
    simulation.setCenter(scene.center);
    for (const body of bodies) {
      body.x = clamp(body.x, -body.width, window.innerWidth + body.width);
      body.y = clamp(body.y, -body.height, window.innerHeight + body.height);
    }
    scene.render();
  }
});

updateStrength();
scene.render();
animationFrame = window.requestAnimationFrame(animate);
