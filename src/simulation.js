import { CONFIG, clamp, finiteOr } from './config.js';

function safeVector(body) {
  body.x = finiteOr(body.x, body.originX ?? 0);
  body.y = finiteOr(body.y, body.originY ?? 0);
  body.vx = finiteOr(body.vx);
  body.vy = finiteOr(body.vy);
  body.angle = finiteOr(body.angle);
  body.angularVelocity = finiteOr(body.angularVelocity);
}

function clampVelocity(body, maxSpeed = CONFIG.maxSpeed) {
  const speed = Math.hypot(body.vx, body.vy);
  if (!Number.isFinite(speed)) {
    body.vx = 0;
    body.vy = 0;
    return;
  }
  if (speed > maxSpeed) {
    const scale = maxSpeed / speed;
    body.vx *= scale;
    body.vy *= scale;
  }
}

export function seedTangentialVelocity(body, center, index = 0) {
  const dx = body.x - center.x;
  const dy = body.y - center.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const direction = index % 2 === 0 ? 1 : -1;
  const speed = clamp(38 + distance * 0.075 + (index % 3) * 5, 42, 106);
  body.vx = (-dy / distance) * speed * direction;
  body.vy = (dx / distance) * speed * direction;
  body.vx += (dx / distance) * 7;
  body.vy += (dy / distance) * 7;
  body.angularVelocity = (index % 2 === 0 ? 1 : -1) * (0.18 + (index % 4) * 0.07);
  clampVelocity(body);
  return body;
}

export class GravitySimulation {
  constructor({ center = { x: 0, y: 0 }, strength = CONFIG.defaultStrength, onCapture = () => {}, onCaptureStart = () => {} } = {}) {
    this.center = { x: center.x, y: center.y };
    this.strength = strength;
    this.bodies = [];
    this.elapsed = 0;
    this.onCapture = onCapture;
    this.onCaptureStart = onCaptureStart;
  }

  setCenter(center) {
    this.center.x = finiteOr(center.x, this.center.x);
    this.center.y = finiteOr(center.y, this.center.y);
  }

  setStrength(strength) {
    this.strength = clamp(finiteOr(strength, CONFIG.defaultStrength), CONFIG.minStrength, CONFIG.maxStrength);
  }

  addBody(body) {
    safeVector(body);
    body.status = body.status ?? 'ACTIVE';
    body.mass = Math.max(0.15, finiteOr(body.mass, 1));
    body.radius = Math.max(8, finiteOr(body.radius, 30));
    body.captureProgress = finiteOr(body.captureProgress);
    this.bodies.push(body);
    return body;
  }

  clear() {
    this.bodies.length = 0;
    this.elapsed = 0;
  }

  resetClock() {
    this.elapsed = 0;
  }

  step(dt = CONFIG.fixedStep) {
    const step = clamp(finiteOr(dt, CONFIG.fixedStep), 0, CONFIG.maxFrameDelta);
    this.elapsed += step;
    const active = this.bodies.filter((body) => body.status === 'ACTIVE');
    for (const body of active) {
      safeVector(body);
      if (body.grabbed) {
        const target = body.pointerTarget ?? { x: body.x, y: body.y };
        const offsetX = finiteOr(target.x) - body.x;
        const offsetY = finiteOr(target.y) - body.y;
        // A critically damped spring keeps the card attached to the pointer
        // without teleporting it through other bodies on fast moves.
        body.vx += offsetX * 185 * step;
        body.vy += offsetY * 185 * step;
        body.vx *= Math.exp(-27 * step);
        body.vy *= Math.exp(-27 * step);
        clampVelocity(body);
        body.x += body.vx * step;
        body.y += body.vy * step;
        body.angle += body.angularVelocity * step;
        safeVector(body);
        continue;
      }
      const dx = this.center.x - body.x;
      const dy = this.center.y - body.y;
      const distanceSquared = dx * dx + dy * dy;
      const softened = distanceSquared + CONFIG.softening * CONFIG.softening;
      const inverseDistance = 1 / Math.sqrt(softened);
      const acceleration = (CONFIG.gravityConstant * this.strength) / softened;
      body.vx += dx * inverseDistance * acceleration * step;
      body.vy += dy * inverseDistance * acceleration * step;
      body.vx *= Math.pow(0.9992, step * 60);
      body.vy *= Math.pow(0.9992, step * 60);
      clampVelocity(body);
      body.x += body.vx * step;
      body.y += body.vy * step;
      body.angle += body.angularVelocity * step;
      clampVelocity(body);
      safeVector(body);

      const distance = Math.hypot(this.center.x - body.x, this.center.y - body.y);
      if (this.elapsed > CONFIG.captureDelay && distance < CONFIG.captureRadius) {
        body.status = 'CAPTURING';
        body.captureProgress = 0;
        this.onCaptureStart(body);
      }
    }

    this.resolveCollisions(active);
    for (const body of this.bodies) {
      if (body.status !== 'CAPTURING') continue;
      safeVector(body);
      const dx = this.center.x - body.x;
      const dy = this.center.y - body.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const pull = clamp(step * 4.4, 0, 1);
      body.vx += (dx / distance) * 180 * step;
      body.vy += (dy / distance) * 180 * step;
      body.x += body.vx * step * 0.8;
      body.y += body.vy * step * 0.8;
      body.captureProgress = clamp(body.captureProgress + step / CONFIG.captureDuration, 0, 1);
      body.angle += body.angularVelocity * step;
      body.scale = 1 - body.captureProgress * 0.82;
      body.opacity = 1 - body.captureProgress * 0.7;
      body.x += (this.center.x - body.x) * pull;
      body.y += (this.center.y - body.y) * pull;
      clampVelocity(body, CONFIG.maxSpeed);
      if (body.captureProgress >= 1) {
        body.status = 'CAPTURED';
        body.scale = 0;
        body.opacity = 0;
        this.onCapture(body);
      }
    }
  }

  resolveCollisions(bodies = this.bodies) {
    for (let firstIndex = 0; firstIndex < bodies.length; firstIndex += 1) {
      const first = bodies[firstIndex];
      if (first.status !== 'ACTIVE' || first.grabbed) continue;
      for (let secondIndex = firstIndex + 1; secondIndex < bodies.length; secondIndex += 1) {
        const second = bodies[secondIndex];
        if (second.status !== 'ACTIVE' || second.grabbed) continue;
        let dx = second.x - first.x;
        let dy = second.y - first.y;
        let distance = Math.hypot(dx, dy);
        const minimum = first.radius + second.radius;
        if (distance >= minimum) continue;
        if (distance < 0.0001) {
          dx = 1;
          dy = 0;
          distance = 1;
        }
        const nx = dx / distance;
        const ny = dy / distance;
        const overlap = minimum - distance;
        const totalMass = first.mass + second.mass;
        first.x -= nx * overlap * (second.mass / totalMass);
        first.y -= ny * overlap * (second.mass / totalMass);
        second.x += nx * overlap * (first.mass / totalMass);
        second.y += ny * overlap * (first.mass / totalMass);
        const relativeVelocity = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny;
        if (relativeVelocity > 0) continue;
        const impulse = (-(1 + CONFIG.restitution) * relativeVelocity) / (1 / first.mass + 1 / second.mass);
        first.vx -= (impulse * nx) / first.mass;
        first.vy -= (impulse * ny) / first.mass;
        second.vx += (impulse * nx) / second.mass;
        second.vy += (impulse * ny) / second.mass;
        clampVelocity(first);
        clampVelocity(second);
      }
    }
  }
}

export { clampVelocity, safeVector };
