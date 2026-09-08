# Gravity Well

Gravity Well is a small, framework-free editorial interface with one deliberate shift in behavior: the page begins as a set of quiet cards, then turns those same cards into textured Three.js bodies moving through a softened gravitational field.

## Run it

```bash
npm install
npm run dev
```

Open the local URL Vite prints. Production assets can be checked with `npm run build`; deterministic physics and lifecycle checks run with `npm test`.

## Architecture

- `src/main.js` owns the page lifecycle, render loop, DOM controls, conversion orchestration, and reset cleanup.
- `src/state.js` defines the explicit `NORMAL → TRANSITIONING → GRAVITY_ACTIVE → RESETTING → NORMAL` state machine.
- `src/conversion.js` measures marked DOM elements, creates SVG foreign-object snapshots with inline computed styles, and turns them into Three.js canvas textures. A small canvas fallback preserves text and color if snapshot rasterization is unavailable.
- `src/scene.js` owns the orthographic camera, responsive renderer, textured sprites, singularity disc, and restrained halo.
- `src/simulation.js` owns fixed-timestep integration, soft point gravity, tangential momentum, speed guards, pair collisions, and delayed gradual capture.
- `src/pointer.js` owns pointer capture, recent-motion throw velocity, clamping, and cancellation handling.

The reset control and system controls live outside the `[data-gravity]` set, so the interface can always recover. Originals retain their layout space with `visibility: hidden` while their snapshots move on the canvas; reset restores each source element and disposes every sprite texture and material.

## Tuning and limits

Pull strength is intentionally exposed in the small control dock. Gravity uses a softened inverse-square field, a bounded frame delta, a 60 Hz accumulator, and a finite-value guard. Bodies have simple circle collision bounds and a capped velocity, which keeps the field legible instead of physically exhaustive. Capture waits before beginning, shrinks over time, and staggers naturally as each body reaches the singularity.

This first foundation does not include lensing shaders, fragmentation, audio, post-processing, or a full rigid-body solver. Snapshotting is designed for local HTML/CSS content and falls back to a readable raster card if a browser declines SVG foreign-object decoding.
