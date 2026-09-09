import { STATES } from './config.js';

const transitions = Object.freeze({
  [STATES.NORMAL]: new Set([STATES.TRANSITIONING]),
  [STATES.TRANSITIONING]: new Set([STATES.GRAVITY_ACTIVE, STATES.RESETTING, STATES.NORMAL]),
  [STATES.GRAVITY_ACTIVE]: new Set([STATES.RESETTING]),
  [STATES.RESETTING]: new Set([STATES.NORMAL]),
});

export class GravityState {
  constructor(onChange = () => {}) {
    this.value = STATES.NORMAL;
    this.onChange = onChange;
  }

  canTransition(next) {
    return next === this.value || transitions[this.value]?.has(next) === true;
  }

  transition(next) {
    if (!this.canTransition(next)) return false;
    const previous = this.value;
    this.value = next;
    if (previous !== next) this.onChange(next, previous);
    return true;
  }
}

export { transitions };
