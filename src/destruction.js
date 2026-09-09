import * as THREE from 'three';
import { clamp } from './config.js';

export const DESTRUCTION_PHASES = Object.freeze({
  APPROACH: 'APPROACH',
  TIDAL_STRETCH: 'TIDAL_STRETCH',
  SHEAR: 'SHEAR',
  FRAGMENT: 'FRAGMENT',
  FINAL_INTAKE: 'FINAL_INTAKE',
  CAPTURED: 'CAPTURED',
});

export const PHASE_THRESHOLDS = Object.freeze({
  APPROACH_END: 0.15,
  TIDAL_STRETCH_END: 0.35,
  SHEAR_END: 0.65,
  FRAGMENT_END: 0.88,
  FINAL_INTAKE_END: 1.0,
});

export function getDestructionPhase(progress) {
  const p = Number.isFinite(progress) ? progress : 0;
  if (p < 0.15) return DESTRUCTION_PHASES.APPROACH;
  if (p < 0.35) return DESTRUCTION_PHASES.TIDAL_STRETCH;
  if (p < 0.65) return DESTRUCTION_PHASES.SHEAR;
  if (p < 0.88) return DESTRUCTION_PHASES.FRAGMENT;
  if (p < 1.0) return DESTRUCTION_PHASES.FINAL_INTAKE;
  return DESTRUCTION_PHASES.CAPTURED;
}

export function getBodyCategory(body) {
  const id = body.id || body.collapseId || '';
  if (id === 'headline-1' || id === 'headline-2' || id === 'hero-lede') {
    return 'HEADLINE';
  }
  if (
    ['signal', 'question', 'map', 'measure', 'fragment'].includes(id) ||
    (body.element && body.element.classList && body.element.classList.contains('object-card'))
  ) {
    return 'LARGE_CARD';
  }
  return 'SMALL_ELEMENT';
}

export function getStripCount(body) {
  const category = getBodyCategory(body);
  if (category === 'LARGE_CARD') {
    return 5; // bounds: 4 to 6
  }
  if (category === 'HEADLINE') {
    return 4; // bounds: 3 to 5
  }
  const id = body.id || body.collapseId || '';
  if (id.includes('satellite')) return 2; // bounds: 2 to 3
  return 3; // bounds: 2 to 3
}

export const DEBRIS_COUNT = 8; // bounds: 6 to 10

export function getDebrisCount(_body) {
  return DEBRIS_COUNT;
}

const DEBRIS_COLORS = [0xdab38d, 0xf0e8d9, 0xe8a87c, 0xcbb69d];

export class DestructionManager {
  constructor(bodiesGroup) {
    this.bodiesGroup = bodiesGroup;
    this.activeDestructions = new Map();
  }

  createStrips(body) {
    const count = getStripCount(body);
    const texture = body.sprite?.userData?.texture || body.texture || null;
    const strips = [];

    for (let i = 0; i < count; i += 1) {
      // Horizontal ribbons: v1 is top of strip, v0 is bottom of strip
      const v1 = 1 - i / count;
      const v0 = 1 - (i + 1) / count;

      const geometry = new THREE.PlaneGeometry(1, 1);
      const uvs = geometry.attributes.uv;
      uvs.setXY(0, 0, v1);
      uvs.setXY(1, 1, v1);
      uvs.setXY(2, 0, v0);
      uvs.setXY(3, 1, v0);
      uvs.needsUpdate = true;

      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 10;
      mesh.userData = { isDestructionStrip: true, bodyId: body.id };
      this.bodiesGroup.add(mesh);

      // Unrotated local Y offset relative to card center
      const localY = (0.5 - (i + 0.5) / count) * body.height;

      strips.push({
        mesh,
        index: i,
        localY,
        v0,
        v1,
      });
    }

    return strips;
  }

  createDebris(body) {
    const count = getDebrisCount(body);
    const particles = [];

    for (let i = 0; i < count; i += 1) {
      const geom = new THREE.PlaneGeometry(1, 1);
      const color = DEBRIS_COLORS[i % DEBRIS_COLORS.length];
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        depthTest: false,
        opacity: 0,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geom, mat);
      mesh.renderOrder = 11;
      mesh.userData = { isDestructionDebris: true, bodyId: body.id };
      this.bodiesGroup.add(mesh);

      const angle = (i / count) * Math.PI * 2 + (body.angle || 0);
      const radiusFrac = 0.35 + 0.55 * ((i * 1.618) % 1);
      const offsetX = Math.cos(angle) * (body.width * 0.42) * radiusFrac;
      const offsetY = Math.sin(angle) * (body.height * 0.42) * radiusFrac;
      const size = 2.0 + (i % 3) * 1.2;

      mesh.scale.set(size, size, 1);

      particles.push({
        mesh,
        offsetX,
        offsetY,
        phaseOffset: (i / count) * 0.25,
        driftAngle: i * 0.785,
        size,
      });
    }

    return particles;
  }

  updateBody(body, center) {
    const progress = clamp(body.captureProgress || 0, 0, 1);
    const phase = getDestructionPhase(progress);
    body.destructionPhase = phase;

    const dx = center.x - body.x;
    const dy = center.y - body.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const angleToCenter = Math.atan2(dy, dx);
    const currentAngle = body.angle || 0;

    // Shortest angular difference
    let angleDiff = (angleToCenter - currentAngle) % (Math.PI * 2);
    if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    const scale = body.scale ?? 1;

    switch (phase) {
      case DESTRUCTION_PHASES.APPROACH: {
        body.destructionUngrabbable = false;
        if (body.sprite) {
          body.sprite.visible = true;
          const t = progress / 0.15;
          body.sprite.rotation.z = currentAngle + angleDiff * (t * 0.25);
          const stretch = 1 + t * 0.15;
          const compress = Math.max(0.2, 1 - t * 0.05);
          body.sprite.scale.set(body.width * scale * stretch, body.height * scale * compress, 1);
          if (body.sprite.material) {
            body.sprite.material.opacity = body.opacity ?? 1;
          }
        }
        break;
      }

      case DESTRUCTION_PHASES.TIDAL_STRETCH: {
        body.destructionUngrabbable = false;
        if (body.sprite) {
          body.sprite.visible = true;
          const t = (progress - 0.15) / 0.20;
          const alignProgress = 0.25 + t * 0.75;
          body.sprite.rotation.z = currentAngle + angleDiff * alignProgress;
          // Stretching along infall axis up to ~2.2x, compressing across perpendicular axis down to ~0.2x
          const stretch = 1.15 + t * (2.2 - 1.15);
          const compress = Math.max(0.2, 0.95 - t * (0.95 - 0.20));
          body.sprite.scale.set(body.width * scale * stretch, body.height * scale * compress, 1);
          if (body.sprite.material) {
            body.sprite.material.opacity = body.opacity ?? 1;
          }
        }
        break;
      }

      case DESTRUCTION_PHASES.SHEAR: {
        body.destructionUngrabbable = true;
        if (body.grabbed) {
          body.grabbed = false;
          body.pointerTarget = null;
          body.pointerOffset = null;
        }
        if (body.sprite) {
          body.sprite.visible = false;
        }

        let record = this.activeDestructions.get(body);
        if (!record) {
          record = {
            strips: this.createStrips(body),
            debris: this.createDebris(body),
            orbitalDir: Math.sign(body.angularVelocity) || 1,
          };
          this.activeDestructions.set(body, record);
        }

        const t = (progress - 0.35) / 0.30;
        const N = record.strips.length;
        const cosA = Math.cos(angleToCenter);
        const sinA = Math.sin(angleToCenter);
        // ux, uy along infall toward singularity
        const ux = cosA, uy = sinA;
        // vx, vy perpendicular
        const vx = -sinA, vy = cosA;

        const baseStretch = 2.2 + t * 0.6;
        const baseCompress = Math.max(0.12, 0.20 - t * 0.08);

        for (const strip of record.strips) {
          const sigma = N > 1 ? (strip.index - (N - 1) / 2) / ((N - 1) / 2) : 0;
          const diffInfall = sigma * t * 14;
          const lateralGap = sigma * t * 8;
          const slippage = Math.sin(sigma * Math.PI * 0.5) * t * 10;

          const localInfall = diffInfall + slippage;
          const localPerp = strip.localY * baseCompress + lateralGap;

          const worldX = body.x + ux * localInfall + vx * localPerp;
          const worldY = body.y + uy * localInfall + vy * localPerp;

          strip.mesh.position.set(worldX, worldY, (body.zIndex ?? 10) / 1000 + strip.index * 0.001);
          strip.mesh.rotation.z = angleToCenter + sigma * t * 0.12;
          strip.mesh.scale.set(body.width * scale * baseStretch, (body.height / N) * scale * baseCompress, 1);
          strip.mesh.material.opacity = body.opacity ?? 1;
          strip.mesh.visible = true;
        }

        for (const mote of record.debris) {
          const moteP = clamp(t + mote.phaseOffset, 0, 1);
          const worldX = body.x + mote.offsetX * (1 - moteP * 0.3) + ux * moteP * 20;
          const worldY = body.y + mote.offsetY * (1 - moteP * 0.3) + uy * moteP * 20;
          mote.mesh.position.set(worldX, worldY, (body.zIndex ?? 10) / 1000 + 0.01);
          mote.mesh.material.opacity = clamp(t * 1.5, 0, 0.85) * (body.opacity ?? 1);
          mote.mesh.visible = true;
        }
        break;
      }

      case DESTRUCTION_PHASES.FRAGMENT: {
        body.destructionUngrabbable = true;
        if (body.grabbed) {
          body.grabbed = false;
          body.pointerTarget = null;
          body.pointerOffset = null;
        }
        if (body.sprite) {
          body.sprite.visible = false;
        }

        let record = this.activeDestructions.get(body);
        if (!record) {
          record = {
            strips: this.createStrips(body),
            debris: this.createDebris(body),
            orbitalDir: Math.sign(body.angularVelocity) || 1,
          };
          this.activeDestructions.set(body, record);
        }

        const t = (progress - 0.65) / 0.23;
        const N = record.strips.length;
        const orbitalDir = record.orbitalDir;

        for (const strip of record.strips) {
          const sigma = N > 1 ? (strip.index - (N - 1) / 2) / ((N - 1) / 2) : 0;
          const staggerSpeed = 1.0 + 0.35 * sigma;
          const tStrip = clamp(t * staggerSpeed, 0, 1);

          const r = Math.max(10, distance * (1 - tStrip * 0.72) - sigma * 8);
          const spiralAngle = angleToCenter + orbitalDir * (0.35 + 0.85 * Math.pow(tStrip, 1.4)) + sigma * 0.22 * (1 - tStrip);

          const worldX = center.x - Math.cos(spiralAngle) * r;
          const worldY = center.y - Math.sin(spiralAngle) * r;

          const filamentLength = 2.8 + tStrip * 0.8;
          const filamentThin = Math.max(0.04, 0.12 - tStrip * 0.08);

          strip.mesh.position.set(worldX, worldY, (body.zIndex ?? 10) / 1000 + strip.index * 0.001);
          const tangentAngle = spiralAngle + Math.PI * 0.5 * orbitalDir * (0.4 + 0.4 * tStrip);
          strip.mesh.rotation.z = tangentAngle;
          strip.mesh.scale.set(body.width * scale * filamentLength, (body.height / N) * scale * filamentThin, 1);
          strip.mesh.material.opacity = (body.opacity ?? 1) * (1 - tStrip * 0.25);
          strip.mesh.visible = true;
        }

        for (let k = 0; k < record.debris.length; k += 1) {
          const mote = record.debris[k];
          const tMote = clamp(t * 1.1 + mote.phaseOffset, 0, 1);
          const rMote = Math.max(8, distance * (1 - tMote * 0.82));
          const angleMote = angleToCenter + orbitalDir * (0.5 + 1.2 * tMote) + mote.driftAngle * 0.3;
          const mX = center.x - Math.cos(angleMote) * rMote;
          const mY = center.y - Math.sin(angleMote) * rMote;
          mote.mesh.position.set(mX, mY, (body.zIndex ?? 10) / 1000 + 0.01);
          mote.mesh.material.opacity = (1 - tMote * 0.3) * 0.85 * (body.opacity ?? 1);
          mote.mesh.visible = true;
        }
        break;
      }

      case DESTRUCTION_PHASES.FINAL_INTAKE: {
        body.destructionUngrabbable = true;
        if (body.grabbed) {
          body.grabbed = false;
          body.pointerTarget = null;
          body.pointerOffset = null;
        }
        if (body.sprite) {
          body.sprite.visible = false;
        }

        let record = this.activeDestructions.get(body);
        if (!record) {
          record = {
            strips: this.createStrips(body),
            debris: this.createDebris(body),
            orbitalDir: Math.sign(body.angularVelocity) || 1,
          };
          this.activeDestructions.set(body, record);
        }

        const t = (progress - 0.88) / 0.12;
        const tFade = Math.pow(Math.max(0, 1 - t), 2.0);
        const N = record.strips.length;
        const orbitalDir = record.orbitalDir;

        for (const strip of record.strips) {
          const sigma = N > 1 ? (strip.index - (N - 1) / 2) / ((N - 1) / 2) : 0;
          const r = Math.max(4, distance * 0.28 * (1 - t * 0.85));
          const spiralAngle = angleToCenter + orbitalDir * (1.2 + 2.0 * t) + sigma * 0.15;

          const worldX = center.x - Math.cos(spiralAngle) * r;
          const worldY = center.y - Math.sin(spiralAngle) * r;

          strip.mesh.position.set(worldX, worldY, (body.zIndex ?? 10) / 1000 + strip.index * 0.001);
          strip.mesh.rotation.z = spiralAngle + Math.PI * 0.5 * orbitalDir;
          strip.mesh.scale.set(
            body.width * scale * Math.max(0.2, 3.6 * (1 - t * 0.6)),
            (body.height / N) * scale * Math.max(0.01, 0.04 * (1 - t * 0.7)),
            1
          );
          strip.mesh.material.opacity = (body.opacity ?? 1) * tFade;
          strip.mesh.visible = tFade > 0.005;
        }

        for (const mote of record.debris) {
          const rMote = Math.max(3, distance * 0.25 * (1 - t * 0.9));
          const aMote = angleToCenter + orbitalDir * (1.5 + 2.5 * t);
          mote.mesh.position.set(center.x - Math.cos(aMote) * rMote, center.y - Math.sin(aMote) * rMote, (body.zIndex ?? 10) / 1000 + 0.01);
          mote.mesh.material.opacity = 0.85 * (body.opacity ?? 1) * tFade;
          mote.mesh.visible = tFade > 0.005;
        }
        break;
      }

      case DESTRUCTION_PHASES.CAPTURED: {
        this.onCapture(body);
        break;
      }
    }
  }

  onCapture(body) {
    this.disposeBody(body);
    if (body.sprite) {
      body.sprite.visible = false;
      body.sprite.scale.set(0, 0, 1);
    }
  }

  disposeBody(body) {
    const record = this.activeDestructions.get(body);
    if (record) {
      for (const strip of record.strips) {
        this.bodiesGroup.remove(strip.mesh);
        strip.mesh.geometry?.dispose();
        strip.mesh.material?.dispose();
      }
      for (const mote of record.debris) {
        this.bodiesGroup.remove(mote.mesh);
        mote.mesh.geometry?.dispose();
        mote.mesh.material?.dispose();
      }
      this.activeDestructions.delete(body);
    }
    body.destructionUngrabbable = false;
  }

  reset(bodies = []) {
    for (const [body, record] of this.activeDestructions) {
      for (const strip of record.strips) {
        this.bodiesGroup.remove(strip.mesh);
        strip.mesh.geometry?.dispose();
        strip.mesh.material?.dispose();
      }
      for (const mote of record.debris) {
        this.bodiesGroup.remove(mote.mesh);
        mote.mesh.geometry?.dispose();
        mote.mesh.material?.dispose();
      }
      body.destructionUngrabbable = false;
      body.destructionPhase = null;
      if (body.sprite) {
        body.sprite.visible = true;
        body.sprite.rotation.z = body.angle || 0;
        const scale = body.scale ?? 1;
        body.sprite.scale.set(body.width * scale, body.height * scale, 1);
        if (body.sprite.material) {
          body.sprite.material.opacity = body.opacity ?? 1;
        }
      }
    }
    this.activeDestructions.clear();

    for (const body of bodies) {
      body.destructionUngrabbable = false;
      body.destructionPhase = null;
      if (body.sprite) {
        body.sprite.visible = true;
      }
    }
  }

  dispose() {
    this.reset();
  }
}
