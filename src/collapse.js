export const COLLAPSE_STAGES = Object.freeze({
  A: { id: 'A', name: 'STRUCTURAL_STRESS', threshold: 0.0 },
  B: { id: 'B', name: 'SMALL_RELEASES', threshold: 0.9 },
  C: { id: 'C', name: 'INTERFACE_FAILURE', threshold: 2.0 },
  D: { id: 'D', name: 'HERO_FAILURE', threshold: 3.2 },
});

export const COLLAPSE_THRESHOLDS = Object.freeze({
  A: 0.0,
  B: 0.9,
  C: 2.0,
  D: 3.2,
});

export const COLLAPSE_STAGE_TARGETS = Object.freeze({
  B: ['header-meta', 'eyebrow', 'visual-caption'],
  C: ['site-nav', 'hero-lede', 'action-note'],
  D: ['headline-1', 'headline-2'],
});

export function calculateMicroStressOffset(originX, originY, center, elapsed) {
  const dx = center.x - originX;
  const dy = center.y - originY;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.001) return { x: 0, y: 0 };
  const nx = dx / dist;
  const ny = dy / dist;

  // Maximum micro-stress drift of 0.5px toward center reached smoothly by 0.9s
  const progress = Math.min(1, Math.max(0, elapsed / COLLAPSE_THRESHOLDS.B));
  const drift = progress * 0.5;
  return { x: nx * drift, y: ny * drift };
}

export function calculateReleaseImpulse(body, center, index = 0) {
  const dx = center.x - body.x;
  const dy = center.y - body.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const nx = dx / dist;
  const ny = dy / dist;

  // Alternating tangential direction
  const dir = index % 2 === 0 ? 1 : -1;
  const tx = -ny * dir;
  const ty = nx * dir;

  let tangentialSpeed;
  let inwardSpeed;
  let angularVelocity;

  if (body.stage === 'D') {
    // Stage D: Hero Failure (headline fragments)
    // Heavy mass (~3.0 - 3.5) and small deterministic release impulse
    body.mass = body.mass ?? (body.collapseId === 'headline-1' ? 3.2 : 3.4);
    body.ignorePairwiseCollisions = true;
    tangentialSpeed = 28;
    inwardSpeed = 16;
    angularVelocity = dir * 0.06;
  } else if (body.stage === 'C') {
    // Stage C: Interface Failure (site-nav, hero-lede, action-note)
    tangentialSpeed = 42 + (index % 3) * 6;
    inwardSpeed = 22;
    angularVelocity = dir * (0.12 + (index % 3) * 0.04);
  } else {
    // Stage B: Small Releases (header-meta, eyebrow, visual-caption)
    tangentialSpeed = 52 + (index % 3) * 8;
    inwardSpeed = 26;
    angularVelocity = dir * (0.18 + (index % 3) * 0.05);
  }

  return {
    vx: tx * tangentialSpeed + nx * inwardSpeed,
    vy: ty * tangentialSpeed + ny * inwardSpeed,
    angularVelocity,
  };
}

export class CollapseChoreographer {
  constructor(options = {}) {
    this.bodies = [];
    this.elapsed = 0;
    this.onRelease = options.onRelease || (() => {});
  }

  addBody(body) {
    if (!body.stage && body.element?.dataset?.collapseStage) {
      body.stage = body.element.dataset.collapseStage;
    }
    if (!body.collapseId && body.element?.dataset?.collapse) {
      body.collapseId = body.element.dataset.collapse;
    }
    body.id = body.id || body.collapseId;
    body.status = body.status || 'PINNED';
    body.originX = body.originX ?? body.x;
    body.originY = body.originY ?? body.y;
    body.collapseIndex = body.collapseIndex ?? this.bodies.length;

    if (body.stage === 'D') {
      body.ignorePairwiseCollisions = true;
      body.mass = body.mass ?? 3.2;
    }

    this.bodies.push(body);
    return body;
  }

  update(activeElapsedTime, frameDelta, center = { x: 0, y: 0 }) {
    this.elapsed = Math.max(0, activeElapsedTime);
    const c = center || { x: 0, y: 0 };

    // 1. Release eligible stages
    const stagesToRelease = ['B', 'C', 'D'];
    for (const stageId of stagesToRelease) {
      const threshold = COLLAPSE_THRESHOLDS[stageId];
      if (this.elapsed >= threshold) {
        for (let i = 0; i < this.bodies.length; i += 1) {
          const body = this.bodies[i];
          if (body.stage === stageId && body.status === 'PINNED') {
            body.status = 'ACTIVE';
            body.released = true;
            body.releasedAt = this.elapsed;

            const impulse = calculateReleaseImpulse(body, c, body.collapseIndex ?? i);
            body.vx = impulse.vx;
            body.vy = impulse.vy;
            body.angularVelocity = impulse.angularVelocity;

            if (body.stage === 'D') {
              body.ignorePairwiseCollisions = true;
            }

            this.onRelease(body, stageId);
          }
        }
      }
    }

    // 2. Apply micro-stress (subtle tension drift toward center) to pinned proxies
    for (const body of this.bodies) {
      if (body.status === 'PINNED') {
        const offset = calculateMicroStressOffset(body.originX, body.originY, c, this.elapsed);
        body.x = body.originX + offset.x;
        body.y = body.originY + offset.y;
      }
    }
  }

  getCurrentStage(time = this.elapsed) {
    if (time < COLLAPSE_THRESHOLDS.B) return 'A';
    if (time < COLLAPSE_THRESHOLDS.C) return 'B';
    if (time < COLLAPSE_THRESHOLDS.D) return 'C';
    return 'D';
  }

  isStageReleased(stageId, time = this.elapsed) {
    if (stageId === 'A') return true;
    const threshold = COLLAPSE_THRESHOLDS[stageId];
    return threshold !== undefined && time >= threshold;
  }

  getPinnedBodies() {
    return this.bodies.filter((body) => body.status === 'PINNED');
  }

  getReleasedBodies() {
    return this.bodies.filter((body) => body.status === 'ACTIVE' || body.released);
  }

  getBodiesForStage(stageId) {
    return this.bodies.filter((body) => body.stage === stageId);
  }

  getBody(id) {
    return this.bodies.find((body) => body.id === id || body.collapseId === id) || null;
  }

  reset() {
    this.elapsed = 0;
    for (const body of this.bodies) {
      body.status = 'PINNED';
      body.released = false;
      delete body.releasedAt;
      body.x = body.originX;
      body.y = body.originY;
      body.vx = 0;
      body.vy = 0;
      body.angle = 0;
      body.angularVelocity = 0;
      body.scale = 1;
      body.opacity = 1;
      if (body.stage === 'D') {
        body.ignorePairwiseCollisions = true;
      }
    }
  }

  clear() {
    this.reset();
    this.bodies.length = 0;
  }
}
