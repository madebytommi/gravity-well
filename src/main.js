import { CONFIG, STATES, clamp } from './config.js';
import { GravityState } from './state.js';
import { GravityScene } from './scene.js';
import { GravitySimulation, seedTangentialVelocity } from './simulation.js';
import { measureElement, makeBodySprite, snapshotElement, snapshotPageBackground } from './conversion.js';
import { PointerGrabber } from './pointer.js';
import { CollapseChoreographer } from './collapse.js';
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
const collapseElements = [...document.querySelectorAll('[data-collapse]')];
const captureTotal = document.querySelector('#capture-total');
captureTotal.textContent = String(gravityElements.length);

const scene = new GravityScene(canvas);
const bodies = [];
const choreographer = new CollapseChoreographer();
let animationFrame = 0;
let previousTime = performance.now();
let accumulator = 0;
let transitionTimer = null;
let captured = 0;
let transitionStartedAt = 0;
let transitionDuration = 1000;
let gravityActiveStartedAt = 0;
let resetStartedAt = 0;
let resetLensingStart = 1.0;
let resetTargets = new Map();
let resetFinalized = false;
let activationInProgress = false;

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
  if (next === STATES.GRAVITY_ACTIVE) {
    gravityActiveStartedAt = performance.now();
  } else if (next !== STATES.GRAVITY_ACTIVE) {
    gravityActiveStartedAt = 0;
  }
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
  resetButton.hidden = next === STATES.NORMAL;
  resetButton.disabled = next === STATES.RESETTING;
  enableButton.setAttribute('aria-expanded', String(next === STATES.GRAVITY_ACTIVE));
});

const simulation = new GravitySimulation({
  center: scene.center,
  strength: CONFIG.defaultStrength,
  onCapture: (body) => {
    if (body.element?.hasAttribute('data-gravity')) {
      captured += 1;
      captureCount.textContent = String(captured);
    }
    scene.destructionManager.onCapture(body);
    scene.syncBody(body);
    scene.triggerCaptureReaction(body);
    // Keep the captured plane attached at zero scale until reset so the
    // return animation can restore every source consistently.
  },
  onCaptureStart: (body) => {
    scene.triggerCaptureReaction(body);
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
  if (activationInProgress || state.value !== STATES.NORMAL) return;
  activationInProgress = true;

  try {
    // Capture the normal page before state CSS begins collapsing its static visuals.
    const bgSnapshot = await snapshotPageBackground(window.innerWidth, window.innerHeight);
    if (!state.transition(STATES.TRANSITIONING)) return;

    captured = 0;
    captureCount.textContent = '0';
    simulation.clear();
    choreographer.clear();
    scene.destructionManager.reset(bodies);
    bodies.splice(0);
    scene.resize();
    simulation.setCenter(scene.center);

    transitionStartedAt = performance.now();
    transitionDuration = (gravityElements.length * 88) + CONFIG.transitionMs;
    scene.setLensingStrength(0.0);
    scene.setBackground(bgSnapshot);

    // Snapshot collapse elements and place pinned WebGL proxies exactly over DOM positions
    const collapseSnapshots = await Promise.all(
      collapseElements.map(async (element, index) => ({
        element,
        index,
        snapshot: await snapshotElement(element),
        measure: measureElement(element),
      }))
    );

    if (state.value !== STATES.TRANSITIONING) return;

    for (const { element, index, snapshot, measure } of collapseSnapshots) {
      const stage = element.dataset.collapseStage || 'B';
      const collapseId = element.dataset.collapse;
      const isHeadline = stage === 'D' || collapseId === 'headline-1' || collapseId === 'headline-2';
      const body = {
        id: collapseId,
        collapseId,
        stage,
        collapseIndex: index,
        element,
        x: measure.x,
        y: measure.y,
        originX: measure.x,
        originY: measure.y,
        width: measure.width,
        height: measure.height,
        radius: Math.max(16, Math.min(measure.width, measure.height) * 0.38),
        mass: isHeadline ? 3.2 : clamp((measure.width * measure.height) / 26_000, 0.5, 1.8),
        ignorePairwiseCollisions: isHeadline,
        zIndex: 20 + index,
        scale: 1,
        opacity: 1,
        status: 'PINNED',
        angle: 0,
        angularVelocity: 0,
        vx: 0,
        vy: 0,
        sourceVisibility: element.style.visibility,
      };
      const sprite = makeBodySprite(snapshot);
      scene.addBody(body, sprite);
      simulation.addBody(body);
      choreographer.addBody(body);
      element.style.visibility = 'hidden';
      bodies.push(body);
    }

    const snapshots = await Promise.all(gravityElements.map(async (element, index) => ({ element, index, snapshot: await snapshotElement(element), measure: measureElement(element) })));
    if (state.value !== STATES.TRANSITIONING) return;
    // Snapshot decoding can take longer than a frame; start the capture grace
    // period when the final body actually enters the field.
    simulation.resetClock();
    for (const { element, index, snapshot, measure } of snapshots) {
      if (state.value !== STATES.TRANSITIONING) break;
      const inViewport = measure.y + measure.height / 2 > 0 && measure.y - measure.height / 2 < window.innerHeight;
      const placement = inViewport ? measure : stagingPosition(index, measure);
      const isCard = element.classList.contains('object-card');
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
        scale: isCard ? 0.88 : 1,
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
  } finally {
    activationInProgress = false;
  }
}

function resetGravity() {
  if (!state.canTransition(STATES.RESETTING)) return;
  state.transition(STATES.RESETTING);
  pointer.end(null, true);
  window.clearTimeout(transitionTimer);
  scene.destructionManager.reset(bodies);
  resetStartedAt = performance.now();
  resetLensingStart = scene.lensingStrength || 1.0;
  resetFinalized = false;
  const allElements = [...gravityElements, ...collapseElements];
  resetTargets = new Map(allElements.map((element) => [element.dataset.bodyId || element.dataset.collapse, measureElement(element)]));
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
  scene.destructionManager.reset(bodies);
  for (const body of bodies) {
    body.element.style.visibility = body.sourceVisibility ?? '';
    scene.removeBody(body);
  }
  bodies.splice(0);
  simulation.clear();
  choreographer.clear();
  captured = 0;
  captureCount.textContent = '0';
  root.classList.remove('is-grabbing');
  resetTargets = new Map();
  scene.setLensingStrength(0.0);
  scene.clearBackground();
  state.transition(STATES.NORMAL);
  scene.render();
}

function animate(now) {
  const frameDelta = Math.min(CONFIG.maxFrameDelta, Math.max(0, (now - previousTime) / 1000));
  previousTime = now;
  const isFieldActive = state.value === STATES.GRAVITY_ACTIVE || state.value === STATES.TRANSITIONING;
  const isFieldVisible = isFieldActive || state.value === STATES.RESETTING;

  // Lensing strength transition ramp
  if (state.value === STATES.TRANSITIONING) {
    const progress = clamp((now - transitionStartedAt) / Math.max(1, transitionDuration), 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    scene.setLensingStrength(eased);
  } else if (state.value === STATES.GRAVITY_ACTIVE) {
    scene.setLensingStrength(1.0);
  } else if (state.value === STATES.RESETTING) {
    const progress = clamp((now - resetStartedAt) / CONFIG.resetMs, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    scene.setLensingStrength(resetLensingStart * (1 - eased));
  } else {
    scene.setLensingStrength(0.0);
  }

  if (state.value === STATES.GRAVITY_ACTIVE) {
    if (gravityActiveStartedAt === 0) gravityActiveStartedAt = now;
    const activeElapsedTime = Math.max(0, (now - gravityActiveStartedAt) / 1000);
    choreographer.update(activeElapsedTime, frameDelta, scene.center);
  }

  if (isFieldActive) {
    accumulator = Math.min(CONFIG.maxAccumulator, accumulator + frameDelta);
    while (accumulator >= CONFIG.fixedStep) {
      simulation.step(CONFIG.fixedStep);
      accumulator -= CONFIG.fixedStep;
    }
    for (const body of bodies) scene.syncBody(body);
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
    if (progress >= 1) finalizeReset();
  }

  if (isFieldVisible) {
    scene.update(frameDelta, now * 0.001, isFieldActive);
    scene.render();
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
scene.update(0, 0, false);
scene.render();
animationFrame = window.requestAnimationFrame(animate);
