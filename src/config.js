export const STATES = Object.freeze({
  NORMAL: 'NORMAL',
  TRANSITIONING: 'TRANSITIONING',
  GRAVITY_ACTIVE: 'GRAVITY_ACTIVE',
  RESETTING: 'RESETTING',
});

export const CONFIG = Object.freeze({
  fixedStep: 1 / 60,
  maxFrameDelta: 0.05,
  maxAccumulator: 0.25,
  gravityConstant: 1_350_000,
  softening: 72,
  maxSpeed: 840,
  restitution: 0.74,
  captureRadius: 54,
  captureDelay: 3.2,
  captureDuration: 1.15,
  transitionMs: 720,
  resetMs: 420,
  defaultStrength: 1,
  minStrength: 0.45,
  maxStrength: 1.6,
});

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function finiteOr(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}
