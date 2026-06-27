/**
 * ScrollFramePlayer
 * ─────────────────────────────────────────────────────────────
 * A reusable scroll-driven frame animation player.
 * Drop this script into any page, then call ScrollFramePlayer(config).
 *
 * MINIMAL USAGE
 * ─────────────
 *   ScrollFramePlayer({
 *     canvasId:    'my-canvas',
 *     frameFolder: './frames/',
 *     totalFrames: 80,
 *   });
 *
 * FULL CONFIG (all options + defaults shown)
 * ──────────────────────────────────────────
 *   ScrollFramePlayer({
 *
 *     // ── Required ──────────────────────────────────────────
 *     canvasId:     'product-canvas',   // id of <canvas> element
 *     frameFolder:  './frames/',        // path to frame images (trailing slash)
 *     totalFrames:  80,                 // total number of frame files
 *
 *     // ── Frame file naming ─────────────────────────────────
 *     framePrefix:  'ezgif-frame-',     // filename prefix
 *     frameExt:     '.jpg',             // filename extension
 *     framePad:     3,                  // zero-pad digits  (003 → 3 digits)
 *     frameStart:   1,                  // first frame number (usually 1)
 *     frameStep:    1,                  // load every Nth frame (2 = skip odd frames, halves load on mobile)
 *
 *     // ── Canvas size & position ────────────────────────────
 *     width:        '100vw',            // CSS width  ('100vw' | '800px' | '80%')
 *     height:       '100vh',            // CSS height ('100vh' | '600px')
 *     position:     'absolute',         // CSS position
 *     top:          '0',                // CSS top    (only used when relevant)
 *     bottom:       null,               // CSS bottom (null = not set)
 *     left:         '0',                // CSS left
 *     right:        null,               // CSS right  (null = not set)
 *
 *     // ── Scroll trigger ────────────────────────────────────
 *     // wrapperId: the scroll-wrapper whose height drives the animation.
 *     // If omitted the library looks for the canvas's closest
 *     // [data-scroll-wrapper] ancestor, then falls back to document.body.
 *     wrapperId:    null,
 *
 *     // scrollStart / scrollEnd: portion of the wrapper's scroll range
 *     // that maps to frame 0 → last frame (0–1).
 *     scrollStart:  0,                  // 0 = top of wrapper
 *     scrollEnd:    1,                  // 1 = bottom of wrapper
 *
 *     // ── Rendering ─────────────────────────────────────────
 *     fit:          'cover',            // 'cover' | 'contain' | 'fill' | 'none'
 *     bgColor:      '#080808',          // canvas background fill
 *     smoothing:    0.18,               // lerp factor 0.01 (slow) – 1 (instant)
 *     dpr:          Math.min(window.devicePixelRatio || 1, 2),  // capped at 2 for mobile safety
 *
 *     // ── Loading screen ────────────────────────────────────
 *     // Set loaderId to wire up a built-in loading overlay automatically.
 *     // If you handle loading UI yourself, leave these null.
 *     loaderId:     null,               // id of loader overlay element
 *     loaderFillId: null,               // id of the <div> fill bar
 *     loaderPctId:  null,               // id of the percentage text element
 *
 *     // ── Callbacks ─────────────────────────────────────────
 *     onProgress:   null,   // (progress: 0–1) => void   — fires every frame
 *     onFrameChange: null,  // (frameIndex: number) => void
 *     onLoad:       null,   // () => void                — all frames loaded
 *     onDestroy:    null,   // () => void                — after destroy()
 *   });
 *
 * RETURN VALUE
 * ────────────
 * Returns a controller object:
 *   {
 *     destroy()          — stops RAF, removes resize listener
 *     goToProgress(t)    — jump to scroll progress 0–1 programmatically
 *     getProgress()      — returns current scroll progress 0–1
 *     getFrame()         — returns current frame index
 *   }
 *
 * ─────────────────────────────────────────────────────────────
 */
function ScrollFramePlayer(userConfig) {
  'use strict';

  /* ── Defaults ────────────────────────────────────────────── */
  const defaults = {
    canvasId:      null,
    frameFolder:   './frames/',
    totalFrames:   74,
    framePrefix:   "frame_",
    frameExt:      '.jpg',
    framePad:      3,
    frameStart:    1,
    frameStep:     1,                                    // NEW: skip frames on mobile

    width:         '100vw',
    height:        '100vh',
    position:      'absolute',
    top:           '0',
    bottom:        null,
    left:          '0',
    right:         null,

    wrapperId:     null,
    scrollStart:   0,
    scrollEnd:     1,

    fit:           'cover',
    bgColor:       '#080808',
    smoothing:     0.18,
    dpr:           Math.min(window.devicePixelRatio || 1, 2), // NEW: cap DPR at 2

    loaderId:      null,
    loaderFillId:  null,
    loaderPctId:   null,

    onProgress:    null,
    onFrameChange: null,
    onLoad:        null,
    onDestroy:     null,
  };

  const cfg = Object.assign({}, defaults, userConfig);

  /* ── Validate required fields ────────────────────────────── */
  if (!cfg.canvasId)    throw new Error('[ScrollFramePlayer] canvasId is required.');
  if (!cfg.frameFolder) throw new Error('[ScrollFramePlayer] frameFolder is required.');
  if (!cfg.totalFrames) throw new Error('[ScrollFramePlayer] totalFrames is required.');

  /* ── DOM refs ────────────────────────────────────────────── */
  const canvas = document.getElementById(cfg.canvasId);
  if (!canvas) throw new Error(`[ScrollFramePlayer] No element found with id "${cfg.canvasId}".`);
  const ctx = canvas.getContext('2d');

  const loaderEl = cfg.loaderId     ? document.getElementById(cfg.loaderId)     : null;
  const fillEl   = cfg.loaderFillId ? document.getElementById(cfg.loaderFillId) : null;
  const pctEl    = cfg.loaderPctId  ? document.getElementById(cfg.loaderPctId)  : null;

  /* ── Apply canvas CSS size & position ───────────────────── */
  (function applyStyles() {
    const s = canvas.style;
    s.position = cfg.position;
    s.width    = cfg.width;
    s.height   = cfg.height;
    if (cfg.top    !== null) s.top    = cfg.top;
    if (cfg.bottom !== null) s.bottom = cfg.bottom;
    if (cfg.left   !== null) s.left   = cfg.left;
    if (cfg.right  !== null) s.right  = cfg.right;
    s.display  = 'block';
  })();

  /* ── State ───────────────────────────────────────────────── */
  // When frameStep > 1, we only load ceil(totalFrames / frameStep) images.
  const loadCount    = Math.ceil(cfg.totalFrames / cfg.frameStep);
  const frames       = new Array(loadCount);
  let loadedCount    = 0;
  let rafId          = null;
  let destroyed      = false;
  let scrollProgress = 0;
  let displayFrame   = 0;
  let currentFrame   = 0;
  let lastTs         = 0;
  let allLoaded      = false;

  /* ── Canvas physical resolution ─────────────────────────── */
  function resizeCanvas() {
    const W = canvas.clientWidth  || window.innerWidth;
    const H = canvas.clientHeight || window.innerHeight;
    canvas.width  = W * cfg.dpr;
    canvas.height = H * cfg.dpr;
    ctx.scale(cfg.dpr, cfg.dpr);
    if (allLoaded) drawFrame(currentFrame);
  }

  /* ── Frame filename helper ───────────────────────────────── */
  // i = logical frame index 0…(loadCount-1)
  function frameSrc(i) {
    const fileNum = cfg.frameStart + (i * cfg.frameStep);
    const num     = String(fileNum).padStart(cfg.framePad, '0');
    return cfg.frameFolder + cfg.framePrefix + num + cfg.frameExt;
  }

  /* ── Draw ────────────────────────────────────────────────── */
  function drawFrame(idx) {
    idx = Math.max(0, Math.min(loadCount - 1, idx));

    // Fallback to nearest loaded frame
    let safeIdx = idx;
    if (!frames[idx] || !frames[idx].complete || frames[idx].naturalWidth === 0) {
      for (let i = idx; i >= 0; i--) {
        if (frames[i] && frames[i].complete && frames[i].naturalWidth > 0) {
          safeIdx = i; break;
        }
      }
    }

    const img = frames[safeIdx];
    if (!img || !img.complete || img.naturalWidth === 0) return;

    const W = canvas.clientWidth  || window.innerWidth;
    const H = canvas.clientHeight || window.innerHeight;

    ctx.clearRect(0, 0, W, H);

    if (cfg.bgColor) {
      ctx.fillStyle = cfg.bgColor;
      ctx.fillRect(0, 0, W, H);
    }

    const iW = img.naturalWidth;
    const iH = img.naturalHeight;
    let dW, dH, dx, dy;

    if (cfg.fit === 'cover') {
      const scale = Math.max(W / iW, H / iH);
      dW = iW * scale; dH = iH * scale;
      dx = (W - dW) / 2; dy = (H - dH) / 2;
    } else if (cfg.fit === 'contain') {
      const scale = Math.min(W / iW, H / iH);
      dW = iW * scale; dH = iH * scale;
      dx = (W - dW) / 2; dy = (H - dH) / 2;
    } else if (cfg.fit === 'fill') {
      dW = W; dH = H; dx = 0; dy = 0;
    } else {
      dW = iW; dH = iH;
      dx = (W - dW) / 2; dy = (H - dH) / 2;
    }

    ctx.drawImage(img, dx, dy, dW, dH);
  }

  /* ── Scroll progress calculation ────────────────────────── */
  function getWrapper() {
    if (cfg.wrapperId) return document.getElementById(cfg.wrapperId);
    let el = canvas.parentElement;
    while (el) {
      if (el.dataset && el.dataset.scrollWrapper !== undefined) return el;
      el = el.parentElement;
    }
    return document.body;
  }

  function calcScrollProgress() {
    const wrapper     = getWrapper();
    const rect        = wrapper.getBoundingClientRect();
    const totalScroll = wrapper.offsetHeight - window.innerHeight;
    if (totalScroll <= 0) return 0;
    const scrolled = -rect.top;
    const raw      = Math.max(0, Math.min(1, scrolled / totalScroll));
    const range    = cfg.scrollEnd - cfg.scrollStart;
    return Math.max(0, Math.min(1, (raw - cfg.scrollStart) / range));
  }

  /* ── Render loop ─────────────────────────────────────────── */
  function renderLoop(ts) {
    if (destroyed) return;
    lastTs = ts;

    scrollProgress = calcScrollProgress();
    const targetFrame = Math.round(scrollProgress * (loadCount - 1));

    displayFrame += (targetFrame - displayFrame) * cfg.smoothing;
    const frameIdx = Math.round(displayFrame);

    if (frameIdx !== currentFrame) {
      currentFrame = frameIdx;
      drawFrame(frameIdx);
      if (typeof cfg.onFrameChange === 'function') cfg.onFrameChange(frameIdx);
    }

    if (typeof cfg.onProgress === 'function') cfg.onProgress(scrollProgress);

    rafId = requestAnimationFrame(renderLoop);
  }

  /* ── Preload ─────────────────────────────────────────────── */
  function preload() {
    for (let i = 0; i < loadCount; i++) {
      const img = new Image();
      img.src = frameSrc(i);

      img.onload = img.onerror = function () {
        loadedCount++;
        const pct = Math.round((loadedCount / loadCount) * 100);

        if (fillEl) fillEl.style.width = pct + '%';
        if (pctEl)  pctEl.textContent  = pct + '%';

        if (loadedCount === loadCount) {
          allLoaded = true;
          drawFrame(0);

          if (loaderEl) {
            loaderEl.style.transition = 'opacity 0.8s ease, visibility 0.8s ease';
            loaderEl.style.opacity    = '0';
            loaderEl.style.visibility = 'hidden';
          }

          if (typeof cfg.onLoad === 'function') cfg.onLoad();

          rafId = requestAnimationFrame(renderLoop);
        }
      };

      frames[i] = img;
    }
  }

  /* ── Resize + orientation change handler ───────────────── */  // NEW
  function onResize() {
    resizeCanvas();
  }

  function onOrientationChange() {                               // NEW
    setTimeout(function () {
      resizeCanvas();
      if (allLoaded) drawFrame(currentFrame);
    }, 300); // wait for browser reflow to finish
  }

  /* ── Init ────────────────────────────────────────────────── */
  resizeCanvas();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onOrientationChange); // NEW
  preload();

  /* ── Public API ─────────────────────────────────────────── */
  return {
    destroy() {
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onOrientationChange); // NEW
      if (typeof cfg.onDestroy === 'function') cfg.onDestroy();
    },

    goToProgress(t) {
      scrollProgress = Math.max(0, Math.min(1, t));
      const frameIdx = Math.round(scrollProgress * (loadCount - 1));
      currentFrame   = frameIdx;
      displayFrame   = frameIdx;
      drawFrame(frameIdx);
      if (typeof cfg.onFrameChange === 'function') cfg.onFrameChange(frameIdx);
      if (typeof cfg.onProgress    === 'function') cfg.onProgress(scrollProgress);
    },

    getProgress() { return scrollProgress; },
    getFrame()    { return currentFrame; },
  };
}