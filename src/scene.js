import * as THREE from 'three';
import { CONFIG } from './config.js';
import { disposeBodySprite } from './conversion.js';

function makeHaloTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(128, 128, 4, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(229, 135, 106, .4)');
  gradient.addColorStop(.18, 'rgba(229, 135, 106, .17)');
  gradient.addColorStop(.5, 'rgba(218, 179, 141, .06)');
  gradient.addColorStop(1, 'rgba(218, 179, 141, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  return canvas;
}

export class GravityScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    canvas.dataset.sceneReady = 'true';
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, 1, 0, 1, -100, 100);
    this.camera.position.z = 10;
    this.bodiesGroup = new THREE.Group();
    this.bodiesGroup.renderOrder = 5;
    this.scene.add(this.bodiesGroup);
    this.singularity = new THREE.Group();
    this.singularity.renderOrder = 2;
    this.scene.add(this.singularity);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(makeHaloTexture()), transparent: true, depthTest: false, opacity: .85 }));
    halo.scale.set(280, 280, 1);
    halo.userData.texture = halo.material.map;
    this.halo = halo;
    this.singularity.add(halo);
    const ring = new THREE.Mesh(new THREE.RingGeometry(26, 28, 64), new THREE.MeshBasicMaterial({ color: 0xdab38d, transparent: true, opacity: .45, side: THREE.DoubleSide }));
    ring.renderOrder = 3;
    this.singularity.add(ring);
    const core = new THREE.Mesh(new THREE.CircleGeometry(18, 48), new THREE.MeshBasicMaterial({ color: 0x0c0d0e, transparent: true, opacity: .96 }));
    core.renderOrder = 4;
    this.singularity.add(core);
    this.resize();
  }

  resize() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    this.renderer.setSize(width, height, false);
    this.camera.left = 0;
    this.camera.right = width;
    this.camera.top = 0;
    this.camera.bottom = height;
    this.camera.updateProjectionMatrix();
    this.setCenter({ x: width * 0.56, y: height * 0.5 });
  }

  setCenter(point) {
    this.singularity.position.set(point.x, point.y, 0);
    this.center = { x: point.x, y: point.y };
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
    body.sprite.rotation.z = body.angle || 0;
    const scale = body.scale ?? 1;
    body.sprite.scale.set(body.width * scale, body.height * scale, 1);
    body.sprite.material.opacity = body.opacity ?? 1;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    for (const child of [...this.bodiesGroup.children]) {
      this.bodiesGroup.remove(child);
      disposeBodySprite(child);
    }
    this.halo.userData.texture.dispose();
    this.halo.material.dispose();
    this.singularity.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material && node !== this.halo) node.material.dispose();
    });
    this.renderer.dispose();
  }
}
