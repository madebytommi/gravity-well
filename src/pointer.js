import { clamp } from './config.js';

export class PointerGrabber {
  constructor(canvas, { getBodies, onGrab = () => {}, onMove = () => {}, onRelease = () => {} }) {
    this.canvas = canvas;
    this.getBodies = getBodies;
    this.onGrab = onGrab;
    this.onMove = onMove;
    this.onRelease = onRelease;
    this.active = null;
    this.points = [];
    this.pointerId = null;
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerCancel = this.handlePointerCancel.bind(this);
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerCancel);
  }

  pick(x, y) {
    return this.getBodies()
      .filter((body) => {
        if (body.destructionUngrabbable || (body.captureProgress ?? 0) >= 0.35) return false;
        return body.status === 'ACTIVE' || body.status === 'CAPTURING';
      })
      .map((body) => ({
        body,
        distance: Math.hypot(x - body.x, y - body.y),
        hit: (() => {
          const deltaX = x - body.x;
          const deltaY = y - body.y;
          const angle = body.angle || 0;
          const cosine = Math.cos(angle);
          const sine = Math.sin(angle);
          const localX = cosine * deltaX + sine * deltaY;
          const localY = -sine * deltaX + cosine * deltaY;
          return Math.abs(localX) <= body.width * .56 && Math.abs(localY) <= body.height * .56;
        })(),
      }))
      .filter((item) => item.hit)
      .sort((a, b) => a.distance - b.distance)[0]?.body ?? null;
  }

  handlePointerDown(event) {
    if (this.active || event.button !== 0) return;
    const body = this.pick(event.clientX, event.clientY);
    if (!body) return;
    event.preventDefault();
    this.active = body;
    this.pointerId = event.pointerId;
    this.points = [{ x: event.clientX, y: event.clientY, time: performance.now() }];
    body.grabbed = true;
    body.pointerOffset = { x: body.x - event.clientX, y: body.y - event.clientY };
    body.pointerTarget = { x: body.x, y: body.y };
    body.vx = 0;
    body.vy = 0;
    this.canvas.setPointerCapture?.(event.pointerId);
    this.onGrab(body, event);
  }

  handlePointerMove(event) {
    if (!this.active || event.pointerId !== this.pointerId) return;
    if (this.active.destructionUngrabbable || (this.active.captureProgress ?? 0) >= 0.35) {
      this.end(event, true);
      return;
    }
    event.preventDefault();
    const now = performance.now();
    this.points.push({ x: event.clientX, y: event.clientY, time: now });
    this.points = this.points.filter((point) => now - point.time < 140).slice(-8);
    const offset = this.active.pointerOffset ?? { x: 0, y: 0 };
    this.active.pointerTarget = { x: event.clientX + offset.x, y: event.clientY + offset.y };
    this.onMove(this.active);
  }

  end(event, cancelled = false) {
    if (!this.active || (event && event.pointerId !== this.pointerId)) return;
    if (event) event.preventDefault();
    const body = this.active;
    const releaseTime = performance.now();
    const recentPoints = this.points.filter((point) => releaseTime - point.time < 140);
    if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      recentPoints.push({ x: event.clientX, y: event.clientY, time: releaseTime });
    }
    const latest = recentPoints[recentPoints.length - 1];
    const earliest = recentPoints[0] ?? latest;
    const duration = Math.max(16, (latest?.time ?? releaseTime) - (earliest?.time ?? releaseTime));
    const throwScale = 1000 / duration;
    body.vx = cancelled || !latest || recentPoints.length < 2 ? 0 : clamp((latest.x - earliest.x) * throwScale, -840, 840);
    body.vy = cancelled || !latest || recentPoints.length < 2 ? 0 : clamp((latest.y - earliest.y) * throwScale, -840, 840);
    body.grabbed = false;
    body.pointerTarget = null;
    body.pointerOffset = null;
    this.onRelease(body, cancelled);
    this.active = null;
    this.pointerId = null;
    this.points = [];
  }

  handlePointerUp(event) { this.end(event); }
  handlePointerCancel(event) { this.end(event, true); }

  destroy() {
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointercancel', this.handlePointerCancel);
  }
}
