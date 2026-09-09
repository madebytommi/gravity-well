import * as THREE from 'three';
import { finiteOr } from './config.js';

export const SNAPSHOT_TIMEOUT_MS = 900;

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

export function createFallbackBackgroundCanvas(width, height) {
  const w = Math.max(1, Math.round(width || 1200));
  const h = Math.max(1, Math.round(height || 900));

  if (typeof document === 'undefined') {
    return { width: w, height: h };
  }

  const canvas = document.createElement('canvas');
  const scale = Math.min(2, Math.max(1, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1));
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.scale(scale, scale);

  // 1. Base dark obsidian surface (#101214)
  ctx.fillStyle = '#101214';
  ctx.fillRect(0, 0, w, h);

  // 2. Editorial radial glow: circle at 76% 21%, rgba(123, 146, 150, .08), transparent 28rem
  const glowX = w * 0.76;
  const glowY = h * 0.21;
  const glowRadius = Math.max(w, h) * 0.48;
  const radial = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, glowRadius);
  radial.addColorStop(0, 'rgba(123, 146, 150, 0.12)');
  radial.addColorStop(0.45, 'rgba(123, 146, 150, 0.04)');
  radial.addColorStop(1, 'rgba(16, 18, 20, 0)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, w, h);

  // 3. Subtle editorial grid lines and section dividers
  ctx.strokeStyle = 'rgba(240, 232, 217, 0.14)';
  ctx.lineWidth = 1;

  // Header bottom border line (y = 76px)
  ctx.beginPath();
  ctx.moveTo(w * 0.05, 76);
  ctx.lineTo(w * 0.95, 76);
  ctx.stroke();

  // Vertical editorial grid guide lines (5vw, 13vw, 50%, 87vw, 95vw)
  ctx.strokeStyle = 'rgba(240, 232, 217, 0.04)';
  const gridXs = [w * 0.05, w * 0.13, w * 0.5, w * 0.87, w * 0.95];
  for (const x of gridXs) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  // Section divider lines
  ctx.strokeStyle = 'rgba(240, 232, 217, 0.09)';
  ctx.beginPath();
  ctx.moveTo(w * 0.1, h * 0.52);
  ctx.lineTo(w * 0.9, h * 0.52);
  ctx.stroke();

  // Subtle hero orbit rings in background
  ctx.strokeStyle = 'rgba(218, 179, 141, 0.15)';
  ctx.beginPath();
  ctx.ellipse(w * 0.68, h * 0.38, 140, 75, (-18 * Math.PI) / 180, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(123, 146, 150, 0.12)';
  ctx.beginPath();
  ctx.ellipse(w * 0.68, h * 0.38, 170, 115, (58 * Math.PI) / 180, 0, Math.PI * 2);
  ctx.stroke();

  // Editorial typography hints
  ctx.fillStyle = 'rgba(240, 232, 217, 0.5)';
  ctx.font = '600 11px Inter, ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('GRAVITY WELL', w * 0.05, 43);
  ctx.fillStyle = 'rgba(157, 154, 147, 0.4)';
  ctx.font = '400 9px Inter, ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('INTERACTIVE STUDY / 01', w * 0.82, 43);

  return canvas;
}

export async function snapshotPageBackground(width, height) {
  const w = Math.max(1, Math.round(width || (typeof window !== 'undefined' ? window.innerWidth : 1200)));
  const h = Math.max(1, Math.round(height || (typeof window !== 'undefined' ? window.innerHeight : 900)));
  const scale = Math.min(2, Math.max(1, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1));

  if (typeof document === 'undefined' || typeof window === 'undefined') {
    const canvas = createFallbackBackgroundCanvas(w, h);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return { canvas, texture, width: w, height: h, source: 'FALLBACK' };
  }

  const excludedElements = [...document.querySelectorAll('[data-gravity], [data-collapse]')];
  const savedVisibilities = excludedElements.map((el) => el.style.visibility);

  // Temporarily hide [data-gravity] and [data-collapse] elements so they are not baked into background
  for (const el of excludedElements) {
    el.style.visibility = 'hidden';
  }

  let canvas = null;
  let backgroundSource = 'FALLBACK';

  try {
    const shell = document.querySelector('.site-shell') || document.body;
    if (shell) {
      const clone = shell.cloneNode(true);
      inlineComputedStyles(shell, clone);
      // Remove canvas and controls from snapshot clone
      const canvasInClone = clone.querySelector('#gravity-canvas');
      if (canvasInClone) canvasInClone.remove();
      const controlsInClone = clone.querySelector('.gravity-controls');
      if (controlsInClone) controlsInClone.remove();
      const resetInClone = clone.querySelector('#reset-gravity');
      if (resetInClone) resetInClone.remove();
      const readoutInClone = clone.querySelector('.capture-readout');
      if (readoutInClone) readoutInClone.remove();

      // Ensure gravity and collapse elements in clone stay hidden
      const excludedInClone = clone.querySelectorAll('[data-gravity], [data-collapse]');
      for (const el of excludedInClone) {
        el.style.visibility = 'hidden';
      }

      clone.style.margin = '0';
      clone.style.width = `${w}px`;
      clone.style.height = `${h}px`;
      clone.style.position = 'relative';
      clone.style.overflow = 'hidden';

      // Inline stylesheets into SVG
      let stylesString = '';
      try {
        for (const sheet of document.styleSheets) {
          try {
            for (const rule of sheet.cssRules) {
              stylesString += rule.cssText + '\n';
            }
          } catch {
            // Ignore security restricted sheets
          }
        }
      } catch {
        // Ignore style access errors
      }

      const serialized = new XMLSerializer().serializeToString(clone);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml" width="${w}" height="${h}"><defs><style type="text/css"><![CDATA[${stylesString}]]></style></defs><foreignObject width="100%" height="100%"><xhtml:div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;overflow:hidden">${serialized}</xhtml:div></foreignObject></svg>`;
      const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

      const img = new Image();
      img.decoding = 'async';

      const loadPromise = new Promise((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = source;
      });

      let timeoutId = null;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error('Snapshot timed out')), SNAPSHOT_TIMEOUT_MS);
      });

      let loadedImg;
      try {
        loadedImg = await Promise.race([loadPromise, timeoutPromise]);
      } finally {
        window.clearTimeout(timeoutId);
      }

      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * scale));
      c.height = Math.max(1, Math.round(h * scale));
      const ctx = c.getContext('2d');
      if (ctx) {
        // Draw the fallback gradient underneath so any transparent areas have proper editorial dark styling
        const fallback = createFallbackBackgroundCanvas(w, h);
        ctx.drawImage(fallback, 0, 0);
        ctx.drawImage(loadedImg, 0, 0, c.width, c.height);
        canvas = c;
        backgroundSource = 'REAL_SNAPSHOT';
      }
    }
  } catch {
    // Snapshot failed or timed out; will use robust fallback
  } finally {
    // Restore original visibility of [data-gravity] and [data-collapse] elements
    for (let i = 0; i < excludedElements.length; i += 1) {
      excludedElements[i].style.visibility = savedVisibilities[i];
    }
  }

  if (!canvas) {
    canvas = createFallbackBackgroundCanvas(w, h);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  return { canvas, texture, width: w, height: h, source: backgroundSource };
}

export async function snapshotElement(element) {
  const rect = element.getBoundingClientRect();
  const width = Math.max(24, Math.round(rect.width));
  const height = Math.max(24, Math.round(rect.height));
  const clone = element.cloneNode(true);
  clone.removeAttribute('data-gravity');
  clone.removeAttribute('data-collapse');
  clone.removeAttribute('data-collapse-stage');
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
