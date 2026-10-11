(() => {
  "use strict";

  const CONFIG = Object.freeze({
    storageKey: "digital-fading:state:v3",
    storageVersion: 3,
    layoutSignature: "single-surface-v1",
    mapWidth: 512,
    mapMinHeight: 240,
    mapMaxHeight: 1120,
    brushCount: 14,
    brushSize: 160,
    devicePixelRatioCap: 1.5,
    mobileDevicePixelRatioCap: 1.25,
    saveDelayMs: 3800,
    analysisIntervalMs: 900,
    hoverDelayMs: 720,
    hoverStampIntervalMs: 180,
    activeWindowMs: 30000,
    movementInteractionDistance: 52,
    dragInteractionDistance: 18,
    wheelInteractionDistance: 92,
    maxPointerSegmentsPerFrame: 90,
    touchRubThresholdPx: 11,
    clickDistancePx: 7,
  });

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const randomRange = (min, max) => min + Math.random() * (max - min);
  const createCanvas = (width = 1, height = 1) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };

  const mulberry32 = (seed) => {
    let value = seed >>> 0;
    return () => {
      value += 0x6d2b79f5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  };

  const pixelNoise = (x, y, seed) => {
    let value = Math.imul(x + seed * 1013, 374761393) + Math.imul(y + seed * 9176, 668265263);
    value = (value ^ (value >>> 13)) >>> 0;
    value = Math.imul(value, 1274126177) >>> 0;
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  };

  class WearMap {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.canvas = createCanvas(width, height);
      this.context = this.canvas.getContext("2d", { willReadFrequently: true });
      this.context.imageSmoothingEnabled = true;
      this.brushes = this.createBrushes();
      this.revision = 0;
    }

    static targetHeight(viewportWidth, documentHeight) {
      if (!viewportWidth || !documentHeight) return CONFIG.mapMinHeight;
      return clamp(
        Math.round((CONFIG.mapWidth * documentHeight) / viewportWidth),
        CONFIG.mapMinHeight,
        CONFIG.mapMaxHeight,
      );
    }

    createBrushes() {
      return Array.from({ length: CONFIG.brushCount }, (_, index) =>
        this.createRoughBrush(CONFIG.brushSize, 7301 + index * 977),
      );
    }

    createRoughBrush(size, seed) {
      const canvas = createCanvas(size, size);
      const context = canvas.getContext("2d");
      const image = context.createImageData(size, size);
      const data = image.data;
      const random = mulberry32(seed);
      const phaseA = random() * Math.PI * 2;
      const phaseB = random() * Math.PI * 2;
      const phaseC = random() * Math.PI * 2;
      const squeeze = 0.9 + random() * 0.2;
      const skew = (random() - 0.5) * 0.12;

      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const nx = ((x + 0.5) / size - 0.5) * 2;
          const ny = ((y + 0.5) / size - 0.5) * 2 * squeeze + nx * skew;
          const theta = Math.atan2(ny, nx);
          const irregularEdge =
            0.082 * Math.sin(theta * 5 + phaseA) +
            0.047 * Math.sin(theta * 9 + phaseB) +
            0.027 * Math.sin(theta * 17 + phaseC);
          const distance = Math.sqrt(nx * nx + ny * ny) - irregularEdge;
          const falloff = clamp(1 - distance, 0, 1);
          const coarse = pixelNoise(Math.floor(x / 5), Math.floor(y / 5), seed);
          const fine = pixelNoise(x, y, seed + 41);
          const fiber = pixelNoise(Math.floor((x + y) / 2), Math.floor((y - x + size) / 3), seed + 89);
          const twill = 0.7 + 0.3 * Math.sin((x + y * 1.04) * 0.52 + phaseA);
          const crossThread = 0.87 + 0.13 * Math.sin((x - y) * 0.22 + phaseB);
          const brokenFiber = fine > 0.95 ? 0.16 : fine < 0.045 ? 0.42 : 1;
          const openThread = fiber > 0.965 ? 0.34 : 1;
          const grain =
            (0.54 + coarse * 0.28 + fine * 0.18) * twill * crossThread * brokenFiber * openThread;
          const coreVariation = 0.8 + 0.2 * Math.sin(x * 0.11 + y * 0.07 + phaseC);
          const alpha = Math.pow(falloff, 1.72) * grain * coreVariation;
          const offset = (y * size + x) * 4;
          data[offset] = 255;
          data[offset + 1] = 255;
          data[offset + 2] = 255;
          data[offset + 3] = Math.round(clamp(alpha, 0, 1) * 255);
        }
      }

      context.putImageData(image, 0, 0);
      return canvas;
    }

    resizeForDocument(viewportWidth, documentHeight) {
      const nextHeight = WearMap.targetHeight(viewportWidth, documentHeight);
      if (Math.abs(nextHeight - this.height) < 6) return false;

      const previous = createCanvas(this.width, this.height);
      previous.getContext("2d").drawImage(this.canvas, 0, 0);
      this.height = nextHeight;
      this.canvas.width = this.width;
      this.canvas.height = this.height;
      this.context = this.canvas.getContext("2d", { willReadFrequently: true });
      this.context.imageSmoothingEnabled = true;
      this.context.imageSmoothingQuality = "high";
      this.context.drawImage(previous, 0, 0, previous.width, previous.height, 0, 0, this.width, this.height);
      this.revision += 1;
      return true;
    }

    stamp(nx, ny, options = {}) {
      const radius = (options.radius ?? 0.012) * this.width;
      const strength = clamp(options.strength ?? 0.012, 0, 0.45);
      if (radius <= 0 || strength <= 0) return;

      const x = clamp(nx, -0.1, 1.1) * this.width;
      const y = clamp(ny, -0.08, 1.08) * this.height;
      const stretchX = options.stretchX ?? 1;
      const stretchY = options.stretchY ?? 1;
      const angle = options.angle ?? 0;
      const brushIndex = Math.abs(options.brushIndex ?? Math.floor(Math.random() * this.brushes.length));
      const brush = this.brushes[brushIndex % this.brushes.length];

      this.context.save();
      this.context.globalCompositeOperation = "source-over";
      this.context.globalAlpha = strength;
      this.context.translate(x, y);
      this.context.rotate(angle);
      this.context.drawImage(
        brush,
        -radius * stretchX,
        -radius * stretchY,
        radius * 2 * stretchX,
        radius * 2 * stretchY,
      );
      this.context.restore();
      this.revision += 1;
    }

    stroke(from, to, options = {}) {
      if (!from || !to) return;
      const x1 = from.nx * this.width;
      const y1 = from.ny * this.height;
      const x2 = to.nx * this.width;
      const y2 = to.ny * this.height;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const distance = Math.hypot(dx, dy);
      const baseRadius = (options.radius ?? 0.01) * this.width;
      const spacing = Math.max(1.1, baseRadius * (options.spacing ?? 0.62));
      const steps = clamp(Math.ceil(distance / spacing), 1, 96);
      const angle = Math.atan2(dy, dx);
      const normalX = -Math.sin(angle);
      const normalY = Math.cos(angle);
      const fiberPass = Boolean(options.fiberPass);

      for (let index = 0; index <= steps; index += 1) {
        const t = index / steps;
        const jitter = randomRange(-baseRadius * 0.2, baseRadius * 0.2);
        const stampX = lerp(x1, x2, t) + normalX * jitter;
        const stampY = lerp(y1, y2, t) + normalY * jitter;
        const radius = (options.radius ?? 0.01) * randomRange(0.76, 1.22);
        const strength = (options.strength ?? 0.01) * randomRange(0.68, 1.24);

        this.stamp(stampX / this.width, stampY / this.height, {
          radius,
          strength,
          stretchX: (options.stretchX ?? 1.5) * randomRange(0.88, 1.14),
          stretchY: (options.stretchY ?? 0.72) * randomRange(0.86, 1.14),
          angle: angle + randomRange(-0.16, 0.16),
        });

        if (fiberPass && Math.random() < 0.46) {
          const threadOffset = randomRange(-baseRadius * 0.34, baseRadius * 0.34);
          const globalTwillAngle = -Math.PI / 4;
          const combAngle = lerp(angle, globalTwillAngle, randomRange(0.22, 0.5));
          this.stamp(
            (stampX + normalX * threadOffset) / this.width,
            (stampY + normalY * threadOffset) / this.height,
            {
              radius: radius * randomRange(0.24, 0.39),
              strength: strength * randomRange(0.42, 0.72),
              stretchX: randomRange(2.1, 3.15),
              stretchY: randomRange(0.16, 0.3),
              angle: combAngle + randomRange(-0.11, 0.11),
            },
          );
        }
      }
    }

    clickCluster(nx, ny, pointerType = "mouse") {
      const touch = pointerType === "touch";
      const count = touch ? 7 : 6;
      const baseRadius = touch ? 0.024 : 0.0165;
      const baseStrength = touch ? 0.06 : 0.052;

      for (let index = 0; index < count; index += 1) {
        const theta = Math.random() * Math.PI * 2;
        const distance = Math.pow(Math.random(), 0.72) * baseRadius * 0.62;
        this.stamp(nx + Math.cos(theta) * distance, ny + Math.sin(theta) * distance, {
          radius: baseRadius * randomRange(0.38, 1.04),
          strength: baseStrength * randomRange(0.45, 1.08),
          stretchX: randomRange(0.74, 1.52),
          stretchY: randomRange(0.46, 1.02),
          angle: randomRange(0, Math.PI),
        });
      }

      for (let index = 0; index < 3; index += 1) {
        this.stamp(nx + randomRange(-0.009, 0.009), ny + randomRange(-0.006, 0.006), {
          radius: baseRadius * randomRange(0.22, 0.38),
          strength: baseStrength * randomRange(0.34, 0.62),
          stretchX: randomRange(1.9, 2.8),
          stretchY: randomRange(0.17, 0.3),
          angle: -Math.PI / 4 + randomRange(-0.25, 0.25),
        });
      }
    }

    clear() {
      this.context.clearRect(0, 0, this.width, this.height);
      this.revision += 1;
    }

    analyze(step = 3) {
      const image = this.context.getImageData(0, 0, this.width, this.height).data;
      let sampled = 0;
      let active = 0;
      let alphaSum = 0;
      const stride = Math.max(1, step) * 4;

      for (let index = 3; index < image.length; index += stride) {
        const alpha = image[index];
        sampled += 1;
        if (alpha > 2) {
          active += 1;
          alphaSum += alpha;
        }
      }

      if (!active || !sampled) {
        return { coverage: 0, depth: 0, level: 0 };
      }

      const coverage = active / sampled;
      const depth = alphaSum / (active * 255);
      const level = clamp(coverage * 0.61 + depth * Math.sqrt(coverage) * 0.39, 0, 1);
      return { coverage, depth, level };
    }

    restore(dataUrl) {
      return new Promise((resolve, reject) => {
        if (!dataUrl) {
          resolve(false);
          return;
        }

        const image = new Image();
        image.onload = () => {
          this.context.clearRect(0, 0, this.width, this.height);
          this.context.imageSmoothingEnabled = true;
          this.context.imageSmoothingQuality = "high";
          this.context.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, 0, 0, this.width, this.height);
          this.revision += 1;
          resolve(true);
        };
        image.onerror = () => reject(new Error("The saved wear map could not be decoded."));
        image.src = dataUrl;
      });
    }

    restoreFoldedLegacy(dataUrl, savedWidth, savedHeight) {
      return new Promise((resolve, reject) => {
        if (!dataUrl) {
          resolve({ restored: false, panels: 0 });
          return;
        }

        const image = new Image();
        image.onload = () => {
          const oldWidth = Math.max(1, Number(savedWidth) || image.naturalWidth);
          const oldHeight = Math.max(1, Number(savedHeight) || image.naturalHeight);
          const oldAspect = oldHeight / oldWidth;
          const newAspect = this.height / this.width;
          const estimatedPanels = clamp(Math.round(oldAspect / Math.max(newAspect, 0.01)), 2, 4);
          const panels = oldHeight >= CONFIG.mapMaxHeight * 0.94 ? 3 : estimatedPanels;
          const sourcePanelHeight = image.naturalHeight / panels;

          this.context.clearRect(0, 0, this.width, this.height);
          this.context.imageSmoothingEnabled = true;
          this.context.imageSmoothingQuality = "high";
          this.context.save();
          this.context.globalCompositeOperation = "source-over";

          for (let index = 0; index < panels; index += 1) {
            this.context.globalAlpha = index === 0 ? 0.82 : 0.68;
            this.context.drawImage(
              image,
              0,
              sourcePanelHeight * index,
              image.naturalWidth,
              sourcePanelHeight,
              0,
              0,
              this.width,
              this.height,
            );
          }

          this.context.restore();
          this.revision += 1;
          resolve({ restored: true, panels });
        };
        image.onerror = () => reject(new Error("The legacy wear map could not be decoded."));
        image.src = dataUrl;
      });
    }
  }

  class DenimRenderer {
    constructor(canvas, wearMap) {
      this.canvas = canvas;
      this.context = canvas.getContext("2d", { alpha: true });
      this.wearMap = wearMap;
      this.cssWidth = 0;
      this.cssHeight = 0;
      this.pixelWidth = 0;
      this.pixelHeight = 0;
      this.dpr = 1;
      this.mask = createCanvas();
      this.highMask = createCanvas();
      this.coreMask = createCanvas();
      this.midLayer = createCanvas();
      this.highLayer = createCanvas();
      this.coreLayer = createCanvas();
      this.fiberLayer = createCanvas();
      this.midTexture = createCanvas();
      this.highTexture = createCanvas();
      this.coreTexture = createCanvas();
      this.fiberTexture = createCanvas();
      this.maskGrainTexture = createCanvas();
    }

    resize() {
      const cssWidth = Math.max(1, window.innerWidth);
      const cssHeight = Math.max(1, window.innerHeight);
      const mobile = window.matchMedia("(max-width: 760px)").matches;
      const cap = mobile ? CONFIG.mobileDevicePixelRatioCap : CONFIG.devicePixelRatioCap;
      const dpr = clamp(window.devicePixelRatio || 1, 1, cap);
      const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
      const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));

      if (pixelWidth === this.pixelWidth && pixelHeight === this.pixelHeight) return false;

      this.cssWidth = cssWidth;
      this.cssHeight = cssHeight;
      this.pixelWidth = pixelWidth;
      this.pixelHeight = pixelHeight;
      this.dpr = dpr;

      [
        this.canvas,
        this.mask,
        this.highMask,
        this.coreMask,
        this.midLayer,
        this.highLayer,
        this.coreLayer,
        this.fiberLayer,
        this.midTexture,
        this.highTexture,
        this.coreTexture,
        this.fiberTexture,
        this.maskGrainTexture,
      ].forEach((layer) => {
        layer.width = pixelWidth;
        layer.height = pixelHeight;
      });

      this.canvas.style.width = `${cssWidth}px`;
      this.canvas.style.height = `${cssHeight}px`;
      this.buildTextures();
      return true;
    }

    createFabricTile(kind, seed) {
      const dpr = this.dpr;
      const nominal = Math.max(112, Math.round(176 * dpr));
      const size = Math.ceil(nominal / 32) * 32;
      const tile = createCanvas(size, size);
      const context = tile.getContext("2d");
      const image = context.createImageData(size, size);
      const data = image.data;
      const palettes = {
        mid: { base: [38, 91, 128], contrast: 28, light: [104, 151, 171] },
        high: { base: [108, 151, 174], contrast: 31, light: [185, 204, 203] },
        core: { base: [174, 190, 190], contrast: 27, light: [225, 226, 216] },
      };
      const palette = palettes[kind];
      const twillUnit = Math.max(3, Math.round(size / 36));
      const twillCycle = twillUnit * 4;
      const phase = (seed % 97) / 97;

      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const u = x / size;
          const v = y / size;
          const twillBand = Math.floor(((x + y + twillUnit * 2) % twillCycle) / twillUnit);
          const twill = [0.34, 0.15, -0.11, -0.24][twillBand];
          const warp = Math.sin(Math.PI * 2 * 41 * u + phase * Math.PI * 2) * 0.11;
          const weft = Math.sin(Math.PI * 2 * 29 * v + 1.2) * 0.055;
          const diagonal = Math.sin(Math.PI * 2 * (17 * u + 17 * v) + 0.7) * 0.075;
          const broad =
            Math.sin(Math.PI * 2 * (3 * u + 2 * v) + 0.4) * 0.08 +
            Math.sin(Math.PI * 2 * (5 * u - 4 * v) + 2.1) * 0.055;
          const grain = (pixelNoise(x, y, seed) - 0.5) * 0.13;
          const threadLift = clamp(twill + warp + weft + diagonal + broad + grain, -0.45, 0.55);
          const lightMix = clamp((threadLift - 0.08) * 0.45, 0, 0.28);
          const shade = threadLift * palette.contrast;
          const offset = (y * size + x) * 4;

          data[offset] = clamp(Math.round(palette.base[0] + shade + (palette.light[0] - palette.base[0]) * lightMix), 0, 255);
          data[offset + 1] = clamp(
            Math.round(palette.base[1] + shade * 0.9 + (palette.light[1] - palette.base[1]) * lightMix),
            0,
            255,
          );
          data[offset + 2] = clamp(
            Math.round(palette.base[2] + shade * 0.75 + (palette.light[2] - palette.base[2]) * lightMix),
            0,
            255,
          );
          data[offset + 3] = 255;
        }
      }

      context.putImageData(image, 0, 0);
      return tile;
    }

    createFiberTile(seed) {
      const dpr = this.dpr;
      const nominal = Math.max(140, Math.round(220 * dpr));
      const size = Math.ceil(nominal / 16) * 16;
      const tile = createCanvas(size, size);
      const context = tile.getContext("2d");
      const random = mulberry32(seed);
      context.lineCap = "round";

      const drawWrappedLine = (x, y, length, angle, width, strokeStyle) => {
        for (const offsetX of [-size, 0, size]) {
          for (const offsetY of [-size, 0, size]) {
            context.strokeStyle = strokeStyle;
            context.lineWidth = width;
            context.beginPath();
            context.moveTo(x + offsetX, y + offsetY);
            context.lineTo(
              x + offsetX + Math.cos(angle) * length,
              y + offsetY + Math.sin(angle) * length,
            );
            context.stroke();
          }
        }
      };

      const count = Math.floor((size * size) / (140 * dpr));
      for (let index = 0; index < count; index += 1) {
        const x = random() * size;
        const y = random() * size;
        const longFiber = random() > 0.72;
        const length = (longFiber ? 10 + random() * 28 : 3 + random() * 13) * dpr;
        const angle = -Math.PI / 4 + (random() - 0.5) * (longFiber ? 0.22 : 0.46);
        const width = (0.28 + random() * (longFiber ? 0.72 : 0.48)) * dpr;
        const alpha = longFiber ? 0.22 + random() * 0.18 : 0.1 + random() * 0.18;
        const strokeStyle =
          random() > 0.18
            ? `rgba(241, 239, 228, ${alpha})`
            : `rgba(82, 124, 145, ${alpha * 0.72})`;
        drawWrappedLine(x, y, length, angle, width, strokeStyle);
      }

      return tile;
    }

    createMaskGrainTile(seed) {
      const dpr = this.dpr;
      const nominal = Math.max(96, Math.round(144 * dpr));
      const size = Math.ceil(nominal / 16) * 16;
      const tile = createCanvas(size, size);
      const context = tile.getContext("2d");
      const image = context.createImageData(size, size);
      const data = image.data;

      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const twill = 0.77 + 0.23 * Math.sin((x + y) * 0.82);
          const cross = 0.9 + 0.1 * Math.sin((x - y) * 0.36 + 1.5);
          const noise = pixelNoise(x, y, seed);
          const hole = noise > 0.982 ? 0.2 : noise < 0.024 ? 0.52 : 1;
          const alpha = clamp((0.71 + noise * 0.29) * twill * cross * hole, 0.16, 1);
          const offset = (y * size + x) * 4;
          data[offset] = 255;
          data[offset + 1] = 255;
          data[offset + 2] = 255;
          data[offset + 3] = Math.round(alpha * 255);
        }
      }

      context.putImageData(image, 0, 0);
      return tile;
    }

    fillWithPattern(target, tile) {
      const context = target.getContext("2d");
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
      context.clearRect(0, 0, target.width, target.height);
      const pattern = context.createPattern(tile, "repeat");
      context.fillStyle = pattern;
      context.fillRect(0, 0, target.width, target.height);
    }

    buildTextures() {
      const width = this.pixelWidth;
      const height = this.pixelHeight;
      const midTile = this.createFabricTile("mid", 194711);
      const highTile = this.createFabricTile("high", 284933);
      const coreTile = this.createFabricTile("core", 377909);
      const fiberTile = this.createFiberTile(480881);
      const maskTile = this.createMaskGrainTile(573953);

      this.fillWithPattern(this.midTexture, midTile);
      this.fillWithPattern(this.highTexture, highTile);
      this.fillWithPattern(this.coreTexture, coreTile);
      this.fillWithPattern(this.fiberTexture, fiberTile);
      this.fillWithPattern(this.maskGrainTexture, maskTile);

      const addWashVariation = (canvas, light, dark) => {
        const context = canvas.getContext("2d");
        const gradient = context.createRadialGradient(
          width * 0.48,
          height * 0.42,
          0,
          width * 0.48,
          height * 0.42,
          Math.max(width, height) * 0.72,
        );
        gradient.addColorStop(0, light);
        gradient.addColorStop(0.58, "rgba(255,255,255,0)");
        gradient.addColorStop(1, dark);
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);
      };

      addWashVariation(this.midTexture, "rgba(190,219,224,0.035)", "rgba(3,25,43,0.09)");
      addWashVariation(this.highTexture, "rgba(239,241,232,0.055)", "rgba(34,72,94,0.08)");
      addWashVariation(this.coreTexture, "rgba(255,251,235,0.07)", "rgba(75,104,110,0.055)");
    }

    render(scrollY, documentHeight) {
      this.resize();
      const width = this.pixelWidth;
      const height = this.pixelHeight;
      const sourceY = clamp((scrollY / Math.max(documentHeight, 1)) * this.wearMap.height, 0, this.wearMap.height);
      const desiredSourceHeight = (this.cssHeight / Math.max(documentHeight, 1)) * this.wearMap.height;
      const available = Math.max(1, this.wearMap.height - sourceY);
      const sourceHeight = clamp(desiredSourceHeight, 1, available);

      const mask = this.mask.getContext("2d");
      mask.setTransform(1, 0, 0, 1, 0, 0);
      mask.globalAlpha = 1;
      mask.globalCompositeOperation = "source-over";
      mask.clearRect(0, 0, width, height);
      mask.imageSmoothingEnabled = true;
      mask.imageSmoothingQuality = "high";
      mask.drawImage(
        this.wearMap.canvas,
        0,
        sourceY,
        this.wearMap.width,
        sourceHeight,
        0,
        0,
        width,
        height,
      );
      mask.globalCompositeOperation = "destination-in";
      mask.drawImage(this.maskGrainTexture, 0, 0);
      mask.globalCompositeOperation = "source-over";

      const highMask = this.highMask.getContext("2d");
      highMask.clearRect(0, 0, width, height);
      highMask.globalCompositeOperation = "source-over";
      highMask.drawImage(this.mask, 0, 0);
      highMask.globalCompositeOperation = "source-in";
      highMask.drawImage(this.mask, 0, 0);
      highMask.globalCompositeOperation = "source-over";

      const coreMask = this.coreMask.getContext("2d");
      coreMask.clearRect(0, 0, width, height);
      coreMask.globalCompositeOperation = "source-over";
      coreMask.drawImage(this.highMask, 0, 0);
      coreMask.globalCompositeOperation = "source-in";
      coreMask.drawImage(this.mask, 0, 0);
      coreMask.globalCompositeOperation = "source-over";

      const clipTexture = (layer, texture, clipMask) => {
        const context = layer.getContext("2d");
        context.clearRect(0, 0, width, height);
        context.globalAlpha = 1;
        context.globalCompositeOperation = "source-over";
        context.drawImage(texture, 0, 0);
        context.globalCompositeOperation = "destination-in";
        context.drawImage(clipMask, 0, 0);
        context.globalCompositeOperation = "source-over";
      };

      clipTexture(this.midLayer, this.midTexture, this.mask);
      clipTexture(this.highLayer, this.highTexture, this.highMask);
      clipTexture(this.coreLayer, this.coreTexture, this.coreMask);
      clipTexture(this.fiberLayer, this.fiberTexture, this.highMask);

      this.context.clearRect(0, 0, width, height);
      this.context.globalCompositeOperation = "source-over";
      this.context.globalAlpha = 0.96;
      this.context.drawImage(this.midLayer, 0, 0);
      this.context.globalAlpha = 0.94;
      this.context.drawImage(this.highLayer, 0, 0);
      this.context.globalAlpha = 0.88;
      this.context.drawImage(this.coreLayer, 0, 0);
      this.context.globalAlpha = 1;
      this.context.drawImage(this.fiberLayer, 0, 0);
      this.context.globalAlpha = 1;
    }
  }

  class LocalWearStorage {
    constructor() {
      this.available = this.checkAvailability();
    }

    checkAvailability() {
      try {
        const testKey = `${CONFIG.storageKey}:test`;
        localStorage.setItem(testKey, "1");
        localStorage.removeItem(testKey);
        return true;
      } catch (error) {
        return false;
      }
    }

    load() {
      if (!this.available) return null;
      try {
        const raw = localStorage.getItem(CONFIG.storageKey);
        if (!raw) return null;
        const state = JSON.parse(raw);
        if (!state || state.version !== CONFIG.storageVersion) return null;
        return state;
      } catch (error) {
        console.warn("DIGITAL FADING: saved data was ignored because it could not be read.", error);
        return null;
      }
    }

    encodeCanvas(canvas) {
      let encoded = canvas.toDataURL("image/webp", 0.84);
      if (!encoded.startsWith("data:image/webp")) encoded = canvas.toDataURL("image/png");

      if (encoded.length > 3_250_000) {
        const reduced = createCanvas(
          Math.max(1, Math.round(canvas.width * 0.74)),
          Math.max(1, Math.round(canvas.height * 0.74)),
        );
        const context = reduced.getContext("2d");
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(canvas, 0, 0, reduced.width, reduced.height);
        encoded = reduced.toDataURL("image/webp", 0.74);
        if (!encoded.startsWith("data:image/webp")) encoded = reduced.toDataURL("image/png");
      }

      return encoded;
    }

    save(wearMap, metadata) {
      if (!this.available) return false;
      try {
        const state = {
          version: CONFIG.storageVersion,
          layout: CONFIG.layoutSignature,
          savedAt: Date.now(),
          map: {
            width: wearMap.width,
            height: wearMap.height,
            dataUrl: this.encodeCanvas(wearMap.canvas),
          },
          metadata,
        };
        localStorage.setItem(CONFIG.storageKey, JSON.stringify(state));
        return true;
      } catch (error) {
        console.warn("DIGITAL FADING: local wear could not be saved.", error);
        return false;
      }
    }

    clear() {
      if (!this.available) return;
      try {
        localStorage.removeItem(CONFIG.storageKey);
      } catch (error) {
        console.warn("DIGITAL FADING: saved wear could not be cleared.", error);
      }
    }
  }

  class DigitalFadingApp {
    constructor() {
      this.canvas = document.getElementById("wear-canvas");
      this.surface = document.getElementById("surface");
      this.fadingElement = document.getElementById("stat-fading");
      this.wearMeterFill = document.getElementById("wear-meter-fill");
      this.instructionElement = document.getElementById("interaction-instruction");
      this.resetButton = document.getElementById("reset-button");
      this.resetDialog = document.getElementById("reset-dialog");
      this.cancelResetButton = document.getElementById("cancel-reset");
      this.confirmResetButton = document.getElementById("confirm-reset");

      const documentHeight = Math.max(document.documentElement.scrollHeight, window.innerHeight);
      const mapHeight = WearMap.targetHeight(window.innerWidth, documentHeight);
      this.wearMap = new WearMap(CONFIG.mapWidth, mapHeight);
      this.renderer = new DenimRenderer(this.canvas, this.wearMap);
      this.storage = new LocalWearStorage();

      this.metadata = {
        totalInteractions: 0,
        activeTimeMs: 0,
        createdAt: Date.now(),
        lastVisitAt: Date.now(),
      };

      this.pointerSegments = [];
      this.gesture = null;
      this.lastMovePoint = null;
      this.lastPointerClient = null;
      this.pointerInside = false;
      this.pointerDown = false;
      this.pointerType = "mouse";
      this.lastPointerMoveAt = 0;
      this.lastHoverStampAt = 0;
      this.lastActivityAt = 0;
      this.movementCredit = 0;
      this.dragCredit = 0;
      this.hoverCredit = 0;
      this.wheelCredit = 0;
      this.lastScrollY = window.scrollY;
      this.lastWheelStampAt = 0;
      this.lastTickAt = performance.now();
      this.lastStatsUpdateAt = 0;
      this.lastAnalysisAt = 0;
      this.lastSaveRequestAt = 0;
      this.fadingLevel = 0;
      this.lastAnalysis = { coverage: 0, depth: 0, level: 0 };
      this.renderRequested = true;
      this.analysisRequested = true;
      this.saveTimer = 0;
      this.resizeTimer = 0;
      this.destroyed = false;
      this.suppressEmptySave = true;
      this.migratedLegacyLayout = false;

      this.tick = this.tick.bind(this);
      this.handlePointerMove = this.handlePointerMove.bind(this);
      this.handlePointerDown = this.handlePointerDown.bind(this);
      this.handlePointerUp = this.handlePointerUp.bind(this);
      this.handlePointerCancel = this.handlePointerCancel.bind(this);
      this.handlePointerEnter = this.handlePointerEnter.bind(this);
      this.handlePointerLeave = this.handlePointerLeave.bind(this);
      this.handleLostPointerCapture = this.handleLostPointerCapture.bind(this);
      this.handleWheel = this.handleWheel.bind(this);
      this.handleScroll = this.handleScroll.bind(this);
      this.handleResize = this.handleResize.bind(this);
      this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
      this.handlePageHide = this.handlePageHide.bind(this);
    }

    async init() {
      const saved = this.storage.load();
      this.suppressEmptySave = !saved;

      if (saved?.metadata) {
        this.metadata = {
          totalInteractions: Number(saved.metadata.totalInteractions) || 0,
          activeTimeMs: Number(saved.metadata.activeTimeMs) || 0,
          createdAt: Number(saved.metadata.createdAt) || Date.now(),
          lastVisitAt: Date.now(),
          ...(saved.metadata.layoutMigratedAt
            ? { layoutMigratedAt: Number(saved.metadata.layoutMigratedAt) }
            : {}),
        };
      }

      if (saved?.map?.dataUrl) {
        try {
          const savedWidth = Number(saved.map.width) || CONFIG.mapWidth;
          const savedHeight = Number(saved.map.height) || this.wearMap.height;
          const oldRatio = savedHeight / Math.max(1, savedWidth);
          const newRatio = this.wearMap.height / this.wearMap.width;
          const needsFoldMigration =
            saved.layout !== CONFIG.layoutSignature && oldRatio > newRatio * 1.42;

          if (needsFoldMigration) {
            await this.wearMap.restoreFoldedLegacy(saved.map.dataUrl, savedWidth, savedHeight);
            this.migratedLegacyLayout = true;
            this.metadata.layoutMigratedAt = Date.now();
            this.suppressEmptySave = false;
          } else {
            await this.wearMap.restore(saved.map.dataUrl);
          }
        } catch (error) {
          console.warn("DIGITAL FADING: starting with a new surface because restoration failed.", error);
        }
      }

      this.renderer.resize();
      this.bindEvents();
      this.measureWear();
      this.updateStats();
      this.renderer.render(window.scrollY, this.documentHeight());

      if (this.migratedLegacyLayout) this.saveNow();
      requestAnimationFrame(this.tick);

      window.__DIGITAL_FADING__ = Object.freeze({
        version: CONFIG.storageVersion,
        layout: CONFIG.layoutSignature,
        save: () => this.saveNow(),
        snapshot: () => ({
          totalInteractions: this.metadata.totalInteractions,
          activeTimeMs: this.metadata.activeTimeMs,
          fadingLevel: this.fadingLevel,
          coverage: this.lastAnalysis.coverage,
          depth: this.lastAnalysis.depth,
          mapWidth: this.wearMap.width,
          mapHeight: this.wearMap.height,
          mapRevision: this.wearMap.revision,
          pointerDown: this.pointerDown,
          migratedLegacyLayout: this.migratedLegacyLayout,
        }),
      });
    }

    bindEvents() {
      this.surface.addEventListener("pointermove", this.handlePointerMove, { passive: true });
      this.surface.addEventListener("pointerdown", this.handlePointerDown, { passive: false });
      this.surface.addEventListener("pointerenter", this.handlePointerEnter, { passive: true });
      this.surface.addEventListener("pointerleave", this.handlePointerLeave, { passive: true });
      this.surface.addEventListener("lostpointercapture", this.handleLostPointerCapture, { passive: true });
      this.surface.addEventListener("dragstart", (event) => event.preventDefault());
      window.addEventListener("pointerup", this.handlePointerUp, { passive: true });
      window.addEventListener("pointercancel", this.handlePointerCancel, { passive: true });
      window.addEventListener("wheel", this.handleWheel, { passive: true });
      window.addEventListener("scroll", this.handleScroll, { passive: true });
      window.addEventListener("resize", this.handleResize, { passive: true });
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
      window.addEventListener("pagehide", this.handlePageHide);

      this.resetButton.addEventListener("click", () => this.openResetDialog());
      this.cancelResetButton.addEventListener("click", () => this.resetDialog.close());
      this.confirmResetButton.addEventListener("click", () => this.resetSurface());
      this.resetDialog.addEventListener("click", (event) => {
        if (event.target === this.resetDialog) this.resetDialog.close();
      });
    }

    documentHeight() {
      return Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, window.innerHeight);
    }

    isInterfaceTarget(target) {
      return target instanceof Element && Boolean(target.closest("button, dialog"));
    }

    pointFromClient(clientX, clientY, time = performance.now()) {
      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, this.documentHeight());
      return {
        clientX,
        clientY,
        nx: clamp(clientX / width, 0, 1),
        ny: clamp((window.scrollY + clientY) / height, 0, 1),
        time,
      };
    }

    handlePointerEnter(event) {
      this.pointerInside = true;
      this.pointerType = event.pointerType || this.pointerType;
    }

    handlePointerLeave() {
      if (this.gesture) return;
      this.pointerInside = false;
      this.lastMovePoint = null;
      this.lastPointerClient = null;
    }

    beginRubbing(gesture) {
      if (gesture.rubbing) return;
      gesture.rubbing = true;
      gesture.scrolling = false;
      this.pointerDown = true;
      document.body.classList.add("is-rubbing");

      if (!gesture.captured && typeof this.surface.setPointerCapture === "function") {
        try {
          this.surface.setPointerCapture(gesture.pointerId);
          gesture.captured = true;
        } catch (error) {
          // Capture can fail when the pointer has already been cancelled by native scrolling.
        }
      }
    }

    queueSegment(from, to, mode, pointerType, pressure) {
      const clientDistance = Math.hypot(to.clientX - from.clientX, to.clientY - from.clientY);
      const elapsed = Math.max(1, to.time - from.time);
      if (clientDistance < 0.65) return 0;

      this.pointerSegments.push({
        from,
        to,
        speed: clientDistance / elapsed,
        distance: clientDistance,
        mode,
        pointerType,
        pressure: clamp(Number(pressure) || 0.5, 0.1, 1),
      });

      if (this.pointerSegments.length > 280) {
        this.pointerSegments.splice(0, this.pointerSegments.length - 280);
      }
      return clientDistance;
    }

    handlePointerMove(event) {
      if (this.isInterfaceTarget(event.target)) return;
      if (event.isPrimary === false) return;
      let coalesced = [event];
      
      if (typeof event.getCoalescedEvents === "function") {
        try {
          const samples = event.getCoalescedEvents();
      
          if (samples && samples.length > 0) {
            coalesced = samples;
          }
        } catch (error) {
          coalesced = [event];
        }
      }
      const pointerType = event.pointerType || "mouse";
      const activeGesture = this.gesture?.pointerId === event.pointerId ? this.gesture : null;
      this.pointerInside = true;
      this.pointerType = pointerType;

      for (const sample of coalesced) {
        const point = this.pointFromClient(sample.clientX, sample.clientY, performance.now());
        const previous = this.lastMovePoint;

        if (activeGesture) {
          const totalX = point.clientX - activeGesture.startPoint.clientX;
          const totalY = point.clientY - activeGesture.startPoint.clientY;
          const absoluteX = Math.abs(totalX);
          const absoluteY = Math.abs(totalY);
          activeGesture.distance = Math.hypot(totalX, totalY);
          activeGesture.lastPoint = point;

          if (pointerType === "touch" && !activeGesture.rubbing && !activeGesture.scrolling) {
            if (absoluteX >= CONFIG.touchRubThresholdPx && absoluteX > absoluteY * 1.14) {
              this.beginRubbing(activeGesture);
            } else if (absoluteY >= CONFIG.touchRubThresholdPx && absoluteY > absoluteX * 1.08) {
              activeGesture.scrolling = true;
              this.pointerDown = false;
            }
          } else if (pointerType !== "touch" && !activeGesture.rubbing && activeGesture.distance > 1.5) {
            this.beginRubbing(activeGesture);
          }

          if (activeGesture.rubbing && previous) {
            const distance = this.queueSegment(
              previous,
              point,
              "drag",
              pointerType,
              sample.pressure || event.pressure || 0.5,
            );
            activeGesture.dragDistance += distance;
            this.dragCredit += distance;
            const gained = Math.floor(this.dragCredit / CONFIG.dragInteractionDistance);
            if (gained > 0) {
              this.metadata.totalInteractions += gained;
              this.dragCredit -= gained * CONFIG.dragInteractionDistance;
            }
          }
        } else if (pointerType !== "touch" && previous) {
          const distance = this.queueSegment(
            previous,
            point,
            "move",
            pointerType,
            sample.pressure || event.pressure || 0.5,
          );
          this.movementCredit += distance;
          const gained = Math.floor(this.movementCredit / CONFIG.movementInteractionDistance);
          if (gained > 0) {
            this.metadata.totalInteractions += gained;
            this.movementCredit -= gained * CONFIG.movementInteractionDistance;
          }
        }

        this.lastMovePoint = point;
        this.lastPointerClient = { x: point.clientX, y: point.clientY };
      }

      this.lastPointerMoveAt = performance.now();
      if (activeGesture?.rubbing || pointerType !== "touch") this.markActive();
    }

    handlePointerDown(event) {
      if (this.isInterfaceTarget(event.target)) return;
      if (event.isPrimary === false) return;
      if ((event.pointerType === "mouse" || event.pointerType === "pen") && event.button !== 0) return;

      const pointerType = event.pointerType || "mouse";
      const point = this.pointFromClient(event.clientX, event.clientY);
      this.pointerInside = true;
      this.pointerType = pointerType;
      this.pointerDown = pointerType !== "touch";
      this.lastMovePoint = point;
      this.lastPointerClient = { x: event.clientX, y: event.clientY };
      this.lastPointerMoveAt = performance.now();
      this.gesture = {
        pointerId: event.pointerId,
        pointerType,
        startPoint: point,
        lastPoint: point,
        distance: 0,
        dragDistance: 0,
        rubbing: false,
        scrolling: false,
        captured: false,
        startedAt: performance.now(),
      };

      if (pointerType !== "touch" && typeof this.surface.setPointerCapture === "function") {
        try {
          this.surface.setPointerCapture(event.pointerId);
          this.gesture.captured = true;
        } catch (error) {
          // Pointer capture is an enhancement; normal window-level pointerup still resets state.
        }
        event.preventDefault();
      }

      this.markActive();
    }

    finishPointer(event, cancelled = false) {
      const gesture = this.gesture;
      if (!gesture || (event?.pointerId != null && gesture.pointerId !== event.pointerId)) return;

      const endPoint =
        event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
          ? this.pointFromClient(event.clientX, event.clientY)
          : gesture.lastPoint;
      const travel = Math.max(
        gesture.distance,
        Math.hypot(endPoint.clientX - gesture.startPoint.clientX, endPoint.clientY - gesture.startPoint.clientY),
      );

      if (!cancelled && !gesture.rubbing && !gesture.scrolling && travel <= CONFIG.clickDistancePx) {
        this.wearMap.clickCluster(endPoint.nx, endPoint.ny, gesture.pointerType);
        this.metadata.totalInteractions += gesture.pointerType === "touch" ? 2 : 1;
        this.markActive();
        this.markWearChanged();
      }

      const capturedPointerId = gesture.captured ? gesture.pointerId : null;
      this.gesture = null;
      this.pointerDown = false;
      this.lastMovePoint = null;
      document.body.classList.remove("is-rubbing");

      if (capturedPointerId != null && typeof this.surface.releasePointerCapture === "function") {
        try {
          if (this.surface.hasPointerCapture?.(capturedPointerId)) {
            this.surface.releasePointerCapture(capturedPointerId);
          }
        } catch (error) {
          // The browser may have already released capture after pointercancel.
        }
      }
    }

    handlePointerUp(event) {
      this.finishPointer(event, false);
    }

    handlePointerCancel(event) {
      this.finishPointer(event, true);
    }

    handleLostPointerCapture(event) {
      if (this.gesture?.pointerId === event.pointerId) this.finishPointer(event, true);
    }

    handleWheel(event) {
      if (this.resetDialog.open || this.isInterfaceTarget(event.target)) return;
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
      const distance = (Math.abs(event.deltaX) + Math.abs(event.deltaY)) * multiplier;
      if (distance <= 0.5) return;

      this.wheelCredit += distance;
      const gained = Math.floor(this.wheelCredit / CONFIG.wheelInteractionDistance);
      if (gained > 0) {
        this.metadata.totalInteractions += gained;
        this.wheelCredit -= gained * CONFIG.wheelInteractionDistance;
      }

      const now = performance.now();
      if (now - this.lastWheelStampAt > 92) {
        this.paintWheelWear(Math.sign(event.deltaY || event.deltaX) || 1);
        this.lastWheelStampAt = now;
      }
      this.markActive();
    }

    paintWheelWear(direction) {
      const clientX = this.lastPointerClient?.x ?? window.innerWidth * 0.5;
      const clientY = this.lastPointerClient?.y ?? window.innerHeight * 0.58;
      const point = this.pointFromClient(clientX, clientY);

      this.wearMap.stamp(point.nx + randomRange(-0.008, 0.008), point.ny + randomRange(-0.006, 0.006), {
        radius: randomRange(0.0065, 0.011),
        strength: randomRange(0.009, 0.016),
        stretchX: randomRange(0.5, 0.76),
        stretchY: randomRange(1.45, 2.05),
        angle: (direction > 0 ? Math.PI / 2 : -Math.PI / 2) + randomRange(-0.19, 0.19),
      });
      this.markWearChanged();
    }

    handleScroll() {
      const current = window.scrollY;
      if (current !== this.lastScrollY) {
        this.lastScrollY = current;
        this.lastMovePoint = null;
        this.renderRequested = true;
      }
    }

    handleResize() {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => {
        const changed = this.wearMap.resizeForDocument(window.innerWidth, this.documentHeight());
        this.renderer.resize();
        this.lastMovePoint = null;
        this.renderRequested = true;
        this.analysisRequested = true;
        if (changed) this.requestSave();
      }, 140);
    }

    handleVisibilityChange() {
      this.lastTickAt = performance.now();
      if (document.hidden) this.saveNow();
    }

    handlePageHide() {
      this.saveNow();
    }

    processPointerSegments() {
      let processed = 0;
      while (this.pointerSegments.length && processed < CONFIG.maxPointerSegmentsPerFrame) {
        const segment = this.pointerSegments.shift();
        const touchFactor = segment.pointerType === "touch" ? 1.24 : 1;

        if (segment.mode === "drag") {
          const slowFactor = 1 - clamp(segment.speed / 1.45, 0, 1);
          const pressureFactor = segment.pointerType === "pen" ? lerp(0.78, 1.28, segment.pressure) : 1;
          const radius = lerp(0.0125, 0.018, slowFactor) * touchFactor;
          const strength = lerp(0.0145, 0.0315, slowFactor) * pressureFactor * touchFactor;
          this.wearMap.stroke(segment.from, segment.to, {
            radius,
            strength,
            stretchX: lerp(1.72, 2.15, slowFactor),
            stretchY: lerp(0.58, 0.72, slowFactor),
            spacing: 0.5,
            fiberPass: true,
          });
        } else {
          const speedFactor = clamp(segment.speed / 2.25, 0, 1);
          const radius = lerp(0.0093, 0.0064, speedFactor);
          const strength = lerp(0.0066, 0.0025, speedFactor);
          this.wearMap.stroke(segment.from, segment.to, {
            radius,
            strength,
            stretchX: lerp(1.5, 1.22, speedFactor),
            stretchY: lerp(0.67, 0.54, speedFactor),
            spacing: 0.78,
            fiberPass: false,
          });
        }
        processed += 1;
      }

      if (processed > 0) this.markWearChanged();
    }

    processHover(now) {
      if (
        this.resetDialog.open ||
        !this.pointerInside ||
        this.pointerDown ||
        this.gesture ||
        this.pointerType === "touch" ||
        !this.lastPointerClient ||
        now - this.lastPointerMoveAt < CONFIG.hoverDelayMs ||
        now - this.lastHoverStampAt < CONFIG.hoverStampIntervalMs
      ) {
        return;
      }

      const point = this.pointFromClient(this.lastPointerClient.x, this.lastPointerClient.y);
      const dwellSeconds = (now - this.lastPointerMoveAt) / 1000;
      const pressure = clamp(0.0045 + dwellSeconds * 0.0011, 0.0045, 0.014);
      const radius = clamp(0.011 + dwellSeconds * 0.0009, 0.011, 0.021);
      this.wearMap.stamp(point.nx + randomRange(-0.004, 0.004), point.ny + randomRange(-0.003, 0.003), {
        radius: radius * randomRange(0.82, 1.13),
        strength: pressure * randomRange(0.76, 1.18),
        stretchX: randomRange(0.82, 1.34),
        stretchY: randomRange(0.65, 1.04),
        angle: -Math.PI / 4 + randomRange(-0.48, 0.48),
      });
      this.lastHoverStampAt = now;
      this.hoverCredit += 1;
      if (this.hoverCredit >= 7) {
        this.metadata.totalInteractions += 1;
        this.hoverCredit = 0;
      }
      this.markActive();
      this.markWearChanged();
    }

    markActive() {
      this.lastActivityAt = performance.now();
    }

    markWearChanged() {
      this.suppressEmptySave = false;
      this.renderRequested = true;
      this.analysisRequested = true;
      this.requestSave();
    }

    requestSave() {
      this.lastSaveRequestAt = performance.now();
      if (this.saveTimer) return;
      this.saveTimer = window.setTimeout(() => {
        this.saveTimer = 0;
        this.saveNow();
      }, CONFIG.saveDelayMs);
    }

    saveNow() {
      if (this.saveTimer) {
        window.clearTimeout(this.saveTimer);
        this.saveTimer = 0;
      }
      if (this.suppressEmptySave) return false;
      this.metadata.lastVisitAt = Date.now();
      return this.storage.save(this.wearMap, { ...this.metadata });
    }

    measureWear() {
      const result = this.wearMap.analyze(3);
      this.lastAnalysis = result;
      this.fadingLevel = result.level;
      this.analysisRequested = false;
      this.lastAnalysisAt = performance.now();
    }

    updateStats() {
      const percent = clamp(this.fadingLevel * 100, 0, 100);
      this.fadingElement.textContent = `${percent.toFixed(1)}%`;
      this.wearMeterFill.style.width = `${percent}%`;
    }

    openResetDialog() {
      if (typeof this.resetDialog.showModal === "function") {
        this.resetDialog.showModal();
      } else if (window.confirm("Return this surface to raw indigo? This removes all locally stored wear.")) {
        this.resetSurface();
      }
    }

    resetSurface() {
      this.wearMap.clear();
      this.metadata = {
        totalInteractions: 0,
        activeTimeMs: 0,
        createdAt: Date.now(),
        lastVisitAt: Date.now(),
      };
      this.fadingLevel = 0;
      this.lastAnalysis = { coverage: 0, depth: 0, level: 0 };
      this.pointerSegments.length = 0;
      this.gesture = null;
      this.lastMovePoint = null;
      this.lastPointerClient = null;
      this.pointerInside = false;
      this.pointerDown = false;
      this.lastPointerMoveAt = performance.now();
      this.lastHoverStampAt = this.lastPointerMoveAt;
      this.movementCredit = 0;
      this.dragCredit = 0;
      this.wheelCredit = 0;
      this.hoverCredit = 0;
      this.lastActivityAt = 0;
      this.lastSaveRequestAt = 0;
      this.suppressEmptySave = true;
      this.migratedLegacyLayout = false;
      document.body.classList.remove("is-rubbing");

      if (this.saveTimer) {
        window.clearTimeout(this.saveTimer);
        this.saveTimer = 0;
      }

      this.storage.clear();
      if (this.resetDialog.open) this.resetDialog.close();
      this.updateStats();
      this.renderRequested = true;
      this.analysisRequested = false;
      this.renderer.render(window.scrollY, this.documentHeight());
    }

    tick(now) {
      if (this.destroyed) return;
      const delta = clamp(now - this.lastTickAt, 0, 1000);
      this.lastTickAt = now;

      if (!document.hidden && now - this.lastActivityAt < CONFIG.activeWindowMs && this.lastActivityAt > 0) {
        this.metadata.activeTimeMs += delta;
        if (now - this.lastSaveRequestAt > CONFIG.saveDelayMs) this.requestSave();
      }

      this.processPointerSegments();
      this.processHover(now);

      if (this.analysisRequested && now - this.lastAnalysisAt >= CONFIG.analysisIntervalMs) {
        this.measureWear();
      }

      if (this.renderRequested) {
        this.renderer.render(window.scrollY, this.documentHeight());
        this.renderRequested = false;
      }

      if (now - this.lastStatsUpdateAt >= 420) {
        this.updateStats();
        this.lastStatsUpdateAt = now;
      }

      requestAnimationFrame(this.tick);
    }
  }

  const app = new DigitalFadingApp();
  app.init();
})();
