import * as THREE from 'three';
import { CONFIG, clamp } from './config.js';
import { disposeBodySprite } from './conversion.js';
import { SingularityVisuals } from './singularity.js';
import { LensingPipeline } from './lensing.js';

export class GravityScene {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.renderer = options.renderer || new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    const pixelRatio = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setClearColor(0x000000, 0);
    if (canvas && canvas.dataset) canvas.dataset.sceneReady = 'true';
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, 1, 0, 1, -100, 100);
    this.camera.position.z = 10;
    this.bodiesGroup = new THREE.Group();
    this.bodiesGroup.renderOrder = 5;
    this.scene.add(this.bodiesGroup);

    this.singularityVisuals = new SingularityVisuals();
    this.singularity = this.singularityVisuals.group;
    this.halo = this.singularityVisuals.coronaMesh;
    this.scene.add(this.singularity);

    this.backgroundMesh = null;
    this.lensingStrength = 0;
    this.lensingEnabled = true;
    this.lensingPipeline = new LensingPipeline(this.renderer, 1, 1);

    this.resize();
  }

  resize() {
    const width = Math.max(1, typeof window !== 'undefined' ? window.innerWidth : 800);
    const height = Math.max(1, typeof window !== 'undefined' ? window.innerHeight : 600);
    const pixelRatio = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(pixelRatio);
    this.camera.left = 0;
    this.camera.right = width;
    this.camera.top = 0;
    this.camera.bottom = height;
    this.camera.updateProjectionMatrix();

    if (this.lensingPipeline) {
      this.lensingPipeline.setSize(width, height, pixelRatio);
    }

    let center = { x: width * 0.56, y: height * 0.5 };
    if (typeof document !== 'undefined') {
      const coreEl = document.querySelector('.orbit-core');
      if (coreEl) {
        const rect = coreEl.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          center = { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
        }
      }
    }
    this.setCenter(center);
    this.singularityVisuals.resize(pixelRatio);

    if (this.backgroundMesh) {
      this.backgroundMesh.geometry?.dispose();
      this.backgroundMesh.geometry = new THREE.PlaneGeometry(width, height);
      this.backgroundMesh.position.set(width * 0.5, height * 0.5, -5);
    }
  }

  setCenter(point) {
    this.singularity.position.set(point.x, point.y, 0);
    this.center = { x: point.x, y: point.y };
    this.singularityVisuals.setCenter(this.center);
    const width = this.camera.right || (typeof window !== 'undefined' ? window.innerWidth : 800);
    const height = this.camera.bottom || (typeof window !== 'undefined' ? window.innerHeight : 600);
    if (this.lensingPipeline) {
      this.lensingPipeline.setCenter(this.center, width, height);
    }
  }

  setBackground(snapshot) {
    this.clearBackground();
    if (!snapshot) return;
    if (this.canvas?.dataset) this.canvas.dataset.backgroundSource = snapshot.source || 'FALLBACK';
    const texture = snapshot.texture || new THREE.CanvasTexture(snapshot.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    const width = snapshot.width || this.camera.right || (typeof window !== 'undefined' ? window.innerWidth : 800);
    const height = snapshot.height || this.camera.bottom || (typeof window !== 'undefined' ? window.innerHeight : 600);

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const geometry = new THREE.PlaneGeometry(width, height);
    this.backgroundMesh = new THREE.Mesh(geometry, material);
    this.backgroundMesh.position.set(width * 0.5, height * 0.5, -5);
    this.backgroundMesh.renderOrder = 0;
    this.scene.add(this.backgroundMesh);
  }

  clearBackground() {
    if (this.backgroundMesh) {
      this.scene.remove(this.backgroundMesh);
      this.backgroundMesh.geometry?.dispose();
      this.backgroundMesh.material?.map?.dispose();
      this.backgroundMesh.material?.dispose();
      this.backgroundMesh = null;
    }
    if (this.canvas?.dataset) {
      delete this.canvas.dataset.backgroundSource;
    }
  }

  setLensingStrength(strength) {
    this.lensingStrength = clamp(strength, 0, 1);
    this.lensingPipeline.setStrength(this.lensingStrength);
  }

  isLensingActive() {
    return this.lensingEnabled && this.lensingStrength > 0.0001;
  }

  addBody(body, sprite) {
    // The camera sits at z=10; keep sprites on the field plane so they remain
    // in front of the camera with a small per-body ordering offset.
    sprite.position.set(body.x, body.y, body.zIndex / 1000);
    sprite.renderOrder = 10;
    this.bodiesGroup.add(sprite);
    this.canvas.dataset.spriteCount = String(this.bodiesGroup.children.length);
    body.sprite = sprite;
  }

  removeBody(body) {
    if (!body.sprite) return;
    this.bodiesGroup.remove(body.sprite);
    this.canvas.dataset.spriteCount = String(this.bodiesGroup.children.length);
    disposeBodySprite(body.sprite);
    body.sprite = null;
  }

  syncBody(body) {
    if (!body.sprite) return;
    body.sprite.position.x = body.x;
    body.sprite.position.y = body.y;
    const scale = body.scale ?? 1;

    // During capture, apply gentle tidal elongation and orientation toward singularity
    if (body.status === 'CAPTURING' && this.center) {
      const dx = this.center.x - body.x;
      const dy = this.center.y - body.y;
      const angleToCenter = Math.atan2(dy, dx);
      const progress = body.captureProgress || 0;
      const currentAngle = body.angle || 0;

      // Handle shortest angular difference without phase jumps
      let angleDiff = (angleToCenter - currentAngle) % (Math.PI * 2);
      if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      const alignProgress = Math.min(1, progress * 1.8);
      body.sprite.rotation.z = currentAngle + angleDiff * alignProgress;

      // Tidal elongation along infall vector up to ~1.5x, compression down to ~0.2x
      const stretch = 1 + Math.sin(progress * Math.PI) * 0.5;
      const compress = Math.max(0.2, 1 - progress * 0.8);
      body.sprite.scale.set(body.width * scale * stretch, body.height * scale * compress, 1);
    } else {
      body.sprite.rotation.z = body.angle || 0;
      body.sprite.scale.set(body.width * scale, body.height * scale, 1);
    }

    body.sprite.material.opacity = body.opacity ?? 1;
  }

  update(dt, time, isFieldActive) {
    this.singularityVisuals.update(dt, time, isFieldActive);
  }

  triggerCaptureReaction(body) {
    this.singularityVisuals.triggerCaptureReaction(body);
  }

  render() {
    if (this.isLensingActive()) {
      // 1. Render base scene (background mesh + bodies) into lensingPipeline.renderTarget
      this.singularity.visible = false;
      if (this.backgroundMesh) this.backgroundMesh.visible = true;
      this.bodiesGroup.visible = true;

      this.renderer.setClearColor(0x101214, 1);
      this.renderer.setRenderTarget(this.lensingPipeline.renderTarget);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);

      // 2. Render lensing quad to screen canvas
      this.renderer.setRenderTarget(null);
      this.lensingPipeline.render(this.renderer);

      // 3. Render this.singularity directly to screen canvas with renderer.autoClear = false
      this.singularity.visible = true;
      if (this.backgroundMesh) this.backgroundMesh.visible = false;
      this.bodiesGroup.visible = false;

      this.renderer.autoClear = false;
      this.renderer.render(this.scene, this.camera);

      // 4. Restore renderer state and visibility
      this.bodiesGroup.visible = true;
      this.renderer.autoClear = true;
      this.renderer.setClearColor(0x000000, 0);
    } else {
      // Standard direct render
      this.singularity.visible = true;
      this.bodiesGroup.visible = true;
      if (this.backgroundMesh) this.backgroundMesh.visible = false;
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose() {
    for (const child of [...this.bodiesGroup.children]) {
      this.bodiesGroup.remove(child);
      disposeBodySprite(child);
    }
    this.clearBackground();
    this.lensingPipeline.dispose();
    this.singularityVisuals.dispose();
    this.scene.remove(this.singularity);
    this.renderer.dispose();
  }
}
