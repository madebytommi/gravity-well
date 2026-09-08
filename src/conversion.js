import * as THREE from 'three';
import { finiteOr } from './config.js';

function inlineComputedStyles(source, target) {
  const computed = getComputedStyle(source);
  // Copy the browser's resolved kebab-case properties verbatim. This keeps
  // grid/flex layout and the visual treatment intact inside foreignObject.
  for (let index = 0; index < computed.length; index += 1) {
    const property = computed[index];
    target.style.setProperty(property, computed.getPropertyValue(property));
  }
  for (let index = 0; index < source.children.length; index += 1) {
    inlineComputedStyles(source.children[index], target.children[index]);
  }
}

function fallbackSnapshot(element, width, height) {
  const canvas = document.createElement('canvas');
  const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  context.scale(scale, scale);
  const styles = getComputedStyle(element);
  context.fillStyle = styles.backgroundColor === 'rgba(0, 0, 0, 0)' ? '#202326' : styles.backgroundColor;
  context.fillRect(0, 0, width, height);
  context.fillStyle = styles.color || '#f2ebdd';
  context.font = `${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
  const lines = (element.innerText || '').split('\n').map((line) => line.trim()).filter(Boolean);
  lines.slice(0, 8).forEach((line, index) => context.fillText(line.slice(0, 48), 18, 30 + index * 22));
  return canvas;
}

export async function snapshotElement(element) {
  const rect = element.getBoundingClientRect();
  const width = Math.max(24, Math.round(rect.width));
  const height = Math.max(24, Math.round(rect.height));
  const clone = element.cloneNode(true);
  clone.removeAttribute('data-gravity');
  inlineComputedStyles(element, clone);
  clone.style.margin = '0';
  // Absolute hero markers are measured in the live page, but their snapshot
  // needs to render in its own plane rather than retain page-relative offsets.
  clone.style.inset = 'auto';
  clone.style.top = 'auto';
  clone.style.right = 'auto';
  clone.style.bottom = 'auto';
  clone.style.left = 'auto';
  clone.style.transform = 'none';
  if (getComputedStyle(element).position === 'absolute' || getComputedStyle(element).position === 'fixed') clone.style.position = 'relative';
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  const serializedClone = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><xhtml:div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden">${serializedClone}</xhtml:div></foreignObject></svg>`;
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = source;
    });
    const canvas = document.createElement('canvas');
    const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { canvas, width, height };
  } catch {
    return { canvas: fallbackSnapshot(element, width, height), width, height };
  }
}

export function makeBodySprite(snapshot) {
  const texture = new THREE.CanvasTexture(snapshot.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Canvas pixels already use the browser's top-left origin; keep their text
  // upright when mapping them onto the XY plane.
  texture.flipY = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  // A plane keeps the snapshot in the same predictable orthographic plane as
  // the singularity and gives us ordinary Object3D rotation semantics.
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, side: THREE.DoubleSide });
  const sprite = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  sprite.scale.set(snapshot.width, snapshot.height, 1);
  sprite.userData = { texture, material };
  return sprite;
}

export function disposeBodySprite(sprite) {
  if (!sprite) return;
  sprite.userData?.texture?.dispose();
  sprite.userData?.material?.dispose();
  sprite.geometry?.dispose();
}

export function measureElement(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: finiteOr(rect.left + rect.width / 2),
    y: finiteOr(rect.top + rect.height / 2),
    width: Math.max(24, rect.width),
    height: Math.max(24, rect.height),
  };
}
