(() => {
  "use strict";

  const CONFIG = Object.freeze({
    storageKey: "digital-fading:state:v3",
    storageVersion: 3,
    mapWidth: 384,
    mapMinHeight: 640,
    mapMaxHeight: 1700,
    brushCount: 10,
    brushSize: 144,
    devicePixelRatioCap: 1.75,
    mobileDevicePixelRatioCap: 1.35,
    saveDelayMs: 4200,
    analysisIntervalMs: 1100,
    hoverDelayMs: 480,
    hoverStampIntervalMs: 145,
    activeWindowMs: 30000,
    movementInteractionDistance: 30,
    scrollInteractionDistance: 56,
    maxPointerSegmentsPerFrame: 70,
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
      const squeeze = randomRange(0.92, 1.08);

      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const nx = ((x + 0.5) / size - 0.5) * 2;
          const ny = ((y + 0.5) / size - 0.5) * 2 * squeeze;
          const theta = Math.atan2(ny, nx);
          const irregularEdge =
            0.075 * Math.sin(theta * 5 + phaseA) +
            0.045 * Math.sin(theta * 9 + phaseB) +
            0.025 * Math.sin(theta * 17 + phaseC);
          const distance = Math.sqrt(nx * nx + ny * ny) - irregularEdge;
          const falloff = clamp(1 - distance, 0, 1);
          const coarse = pixelNoise(Math.floor(x / 4), Math.floor(y / 4), seed);
          const fine = pixelNoise(x, y, seed + 41);
          const twill = 0.76 + 0.24 * Math.sin((x + y * 1.06) * 0.49 + phaseA);
          const crossThread = 0.88 + 0.12 * Math.sin((x - y) * 0.22 + phaseB);
          const brokenFiber = fine > 0.94 ? 0.2 : fine < 0.055 ? 0.48 : 1;
          const grain = (0.58 + coarse * 0.27 + fine * 0.15) * twill * crossThread * brokenFiber;
          const coreVariation = 0.82 + 0.18 * Math.sin((x * 0.11 + y * 0.07) + phaseC);
          const alpha = Math.pow(falloff, 1.85) * grain * coreVariation;
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
      if (Math.abs(nextHeight - this.height) < 8) return false;

      const previous = createCanvas(this.width, this.height);
      previous.getContext("2d").drawImage(this.canvas, 0, 0);
      this.height = nextHeight;
      this.canvas.width = this.width;
      this.canvas.height = this.height;
      this.context = this.canvas.getContext("2d", { willReadFrequently: true });
      this.context.imageSmoothingEnabled = true;
      this.context.drawImage(previous, 0, 0, previous.width, previous.height, 0, 0, this.width, this.height);
      this.revision += 1;
      return true;
    }

    stamp(nx, ny, options = {}) {
      const radius = (options.radius ?? 0.014) * this.width;
      const strength = clamp(options.strength ?? 0.02, 0, 0.5);
      if (radius <= 0 || strength <= 0) return;

      const x = clamp(nx, -0.1, 1.1) * this.width;
      const y = clamp(ny, -0.05, 1.05) * this.height;
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
      const baseRadius = (options.radius ?? 0.011) * this.width;
      const spacing = Math.max(1.4, baseRadius * (options.spacing ?? 0.68));
      const steps = clamp(Math.ceil(distance / spacing), 1, 80);
      const angle = Math.atan2(dy, dx);
      const normalX = -Math.sin(angle);
      const normalY = Math.cos(angle);

      for (let index = 0; index <= steps; index += 1) {
        const t = index / steps;
        const jitter = randomRange(-baseRadius * 0.18, baseRadius * 0.18);
        const stampX = lerp(x1, x2, t) + normalX * jitter;
        const stampY = lerp(y1, y2, t) + normalY * jitter;
        this.stamp(stampX / this.width, stampY / this.height, {
          radius: (options.radius ?? 0.011) * randomRange(0.77, 1.2),
          strength: (options.strength ?? 0.012) * randomRange(0.72, 1.2),
          stretchX: (options.stretchX ?? 1.45) * randomRange(0.88, 1.13),
          stretchY: (options.stretchY ?? 0.78) * randomRange(0.88, 1.13),
          angle: angle + randomRange(-0.18, 0.18),
        });
      }
    }

    clickCluster(nx, ny, pointerType = "mouse") {
      const count = pointerType === "touch" ? 9 : 11;
      const baseRadius = pointerType === "touch" ? 0.034 : 0.026;
      const baseStrength = pointerType === "touch" ? 0.105 : 0.115;

      for (let index = 0; index < count; index += 1) {
        const theta = Math.random() * Math.PI * 2;
        const distance = Math.pow(Math.random(), 0.68) * baseRadius * 0.62;
        this.stamp(nx + Math.cos(theta) * distance, ny + Math.sin(theta) * distance, {
          radius: baseRadius * randomRange(0.42, 1.18),
          strength: baseStrength * randomRange(0.52, 1.15),
          stretchX: randomRange(0.72, 1.55),
          stretchY: randomRange(0.55, 1.12),
          angle: randomRange(0, Math.PI),
        });
      }

      for (let index = 0; index < 4; index += 1) {
        this.stamp(nx + randomRange(-0.018, 0.018), ny + randomRange(-0.009, 0.009), {
          radius: baseRadius * randomRange(0.26, 0.46),
          strength: baseStrength * randomRange(0.4, 0.72),
          stretchX: randomRange(1.7, 2.6),
          stretchY: randomRange(0.22, 0.38),
          angle: randomRange(-0.35, 0.35),
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
      const level = clamp(coverage * 0.65 + depth * Math.sqrt(coverage) * 0.35, 0, 1);
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
          this.context.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, 0, 0, this.width, this.height);
          this.revision += 1;
          resolve(true);
        };
        image.onerror = () => reject(new Error("The saved wear map could not be decoded."));
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
      this.midLayer = createCanvas();
      this.highLayer = createCanvas();
      this.fiberLayer = createCanvas();
      this.midTexture = createCanvas();
      this.highTexture = createCanvas();
      this.fiberTexture = createCanvas();
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
        this.midLayer,
        this.highLayer,
        this.fiberLayer,
        this.midTexture,
        this.highTexture,
        this.fiberTexture,
      ].forEach((layer) => {
        layer.width = pixelWidth;
        layer.height = pixelHeight;
      });

      this.canvas.style.width = `${cssWidth}px`;
      this.canvas.style.height = `${cssHeight}px`;
      this.buildTextures();
      return true;
    }

    buildTextures() {
      const width = this.pixelWidth;
      const height = this.pixelHeight;
      const dpr = this.dpr;
      const random = mulberry32(14031991 + width * 13 + height * 17);

      const mid = this.midTexture.getContext("2d");
      mid.clearRect(0, 0, width, height);
      const midGradient = mid.createLinearGradient(0, 0, width * 0.8, height);
      midGradient.addColorStop(0, "rgba(28, 85, 126, 0.84)");
      midGradient.addColorStop(0.5, "rgba(42, 105, 145, 0.84)");
      midGradient.addColorStop(1, "rgba(64, 126, 158, 0.78)");
      mid.fillStyle = midGradient;
      mid.fillRect(0, 0, width, height);

      mid.save();
      mid.globalAlpha = 0.22;
      mid.lineWidth = Math.max(0.7, dpr * 0.75);
      for (let offset = -height; offset < width + height; offset += 5.4 * dpr) {
        mid.strokeStyle = random() > 0.46 ? "rgba(213, 229, 229, 0.38)" : "rgba(1, 21, 38, 0.4)";
        mid.beginPath();
        mid.moveTo(offset, 0);
        mid.lineTo(offset - height, height);
        mid.stroke();
      }
      mid.restore();

      mid.save();
      mid.globalAlpha = 0.11;
      for (let index = 0; index < Math.floor((width * height) / (5200 * dpr)); index += 1) {
        const x = random() * width;
        const y = random() * height;
        const length = randomRange(3, 18) * dpr;
        mid.strokeStyle = random() > 0.5 ? "rgba(228, 238, 236, 0.72)" : "rgba(3, 25, 43, 0.76)";
        mid.lineWidth = randomRange(0.3, 1) * dpr;
        mid.beginPath();
        mid.moveTo(x, y);
        mid.lineTo(x + length, y - length * randomRange(0.7, 1.08));
        mid.stroke();
      }
      mid.restore();

      const high = this.highTexture.getContext("2d");
      high.clearRect(0, 0, width, height);
      const highGradient = high.createLinearGradient(0, height, width, 0);
      highGradient.addColorStop(0, "rgba(134, 169, 185, 0.68)");
      highGradient.addColorStop(0.48, "rgba(175, 198, 201, 0.78)");
      highGradient.addColorStop(1, "rgba(216, 222, 216, 0.82)");
      high.fillStyle = highGradient;
      high.fillRect(0, 0, width, height);

      high.save();
      high.globalAlpha = 0.3;
      high.lineWidth = Math.max(0.65, dpr * 0.7);
      for (let offset = -height; offset < width + height; offset += 4.1 * dpr) {
        high.strokeStyle = random() > 0.33 ? "rgba(240, 243, 237, 0.62)" : "rgba(51, 92, 115, 0.38)";
        high.beginPath();
        high.moveTo(offset, 0);
        high.lineTo(offset - height, height);
        high.stroke();
      }
      high.restore();

      const fibers = this.fiberTexture.getContext("2d");
      fibers.clearRect(0, 0, width, height);
      fibers.save();
      fibers.lineCap = "round";
      for (let index = 0; index < Math.floor((width * height) / (2900 * dpr)); index += 1) {
        const x = random() * width;
        const y = random() * height;
        const length = randomRange(4, 28) * dpr;
        const angle = -Math.PI / 4 + randomRange(-0.28, 0.28);
        fibers.strokeStyle = random() > 0.22 ? "rgba(236, 240, 233, 0.25)" : "rgba(101, 137, 151, 0.19)";
        fibers.lineWidth = randomRange(0.35, 1.15) * dpr;
        fibers.beginPath();
        fibers.moveTo(x, y);
        fibers.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
        fibers.stroke();
      }
      fibers.restore();
    }

    render(scrollY, documentHeight) {
      this.resize();
      const width = this.pixelWidth;
      const height = this.pixelHeight;
      const sourceY = clamp((scrollY / Math.max(documentHeight, 1)) * this.wearMap.height, 0, this.wearMap.height);
      const desiredSourceHeight = (this.cssHeight / Math.max(documentHeight, 1)) * this.wearMap.height;
      const sourceHeight = clamp(desiredSourceHeight, 1, this.wearMap.height - sourceY || 1);

      const mask = this.mask.getContext("2d");
      mask.setTransform(1, 0, 0, 1, 0, 0);
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

      const highMask = this.highMask.getContext("2d");
      highMask.clearRect(0, 0, width, height);
      highMask.globalCompositeOperation = "source-over";
      highMask.drawImage(this.mask, 0, 0);
      highMask.globalCompositeOperation = "source-in";
      highMask.drawImage(this.mask, 0, 0);
      highMask.globalCompositeOperation = "source-over";

      const midLayer = this.midLayer.getContext("2d");
      midLayer.clearRect(0, 0, width, height);
      midLayer.globalCompositeOperation = "source-over";
      midLayer.drawImage(this.midTexture, 0, 0);
      midLayer.globalCompositeOperation = "destination-in";
      midLayer.drawImage(this.mask, 0, 0);
      midLayer.globalCompositeOperation = "source-over";

      const highLayer = this.highLayer.getContext("2d");
      highLayer.clearRect(0, 0, width, height);
      highLayer.globalCompositeOperation = "source-over";
      highLayer.drawImage(this.highTexture, 0, 0);
      highLayer.globalCompositeOperation = "destination-in";
      highLayer.drawImage(this.highMask, 0, 0);
      highLayer.globalCompositeOperation = "source-over";

      const fiberLayer = this.fiberLayer.getContext("2d");
      fiberLayer.clearRect(0, 0, width, height);
      fiberLayer.globalCompositeOperation = "source-over";
      fiberLayer.drawImage(this.fiberTexture, 0, 0);
      fiberLayer.globalCompositeOperation = "destination-in";
      fiberLayer.drawImage(this.highMask, 0, 0);
      fiberLayer.globalCompositeOperation = "source-over";

      this.context.clearRect(0, 0, width, height);
      this.context.globalCompositeOperation = "source-over";
      this.context.globalAlpha = 0.97;
      this.context.drawImage(this.midLayer, 0, 0);
      this.context.globalAlpha = 0.94;
      this.context.drawImage(this.highLayer, 0, 0);
      this.context.globalAlpha = 1;
      this.context.drawImage(this.fiberLayer, 0, 0);
      this.context.globalAlpha = 1;
    }
  }

  class LocalWearStorage {
    constructor(statusElement) {
      this.statusElement = statusElement;
      this.available = this.checkAvailability();
    }

    checkAvailability() {
      try {
        const testKey = `${CONFIG.storageKey}:test`;
        localStorage.setItem(testKey, "1");
        localStorage.removeItem(testKey);
        return true;
      } catch (error) {
        this.setStatus("MEMORY UNAVAILABLE");
        return false;
      }
    }

    setStatus(message) {
      if (this.statusElement) this.statusElement.textContent = message;
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
      let encoded = canvas.toDataURL("image/webp", 0.82);
      if (!encoded.startsWith("data:image/webp")) encoded = canvas.toDataURL("image/png");

      if (encoded.length > 3_250_000) {
        const reduced = createCanvas(Math.max(1, Math.round(canvas.width * 0.72)), Math.max(1, Math.round(canvas.height * 0.72)));
        const context = reduced.getContext("2d");
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(canvas, 0, 0, reduced.width, reduced.height);
        encoded = reduced.toDataURL("image/webp", 0.72);
        if (!encoded.startsWith("data:image/webp")) encoded = reduced.toDataURL("image/png");
      }

      return encoded;
    }

    save(wearMap, metadata) {
      if (!this.available) return false;
      try {
        const state = {
          version: CONFIG.storageVersion,
          savedAt: Date.now(),
          map: {
            width: wearMap.width,
            height: wearMap.height,
            dataUrl: this.encodeCanvas(wearMap.canvas),
          },
          metadata,
        };
        localStorage.setItem(CONFIG.storageKey, JSON.stringify(state));
        this.setStatus("MEMORY SAVED");
        return true;
      } catch (error) {
        console.warn("DIGITAL FADING: local wear could not be saved.", error);
        this.setStatus("MEMORY FULL");
        return false;
      }
    }

    clear() {
      if (!this.available) return;
      try {
        localStorage.removeItem(CONFIG.storageKey);
        this.setStatus("RAW STATE");
      } catch (error) {
        console.warn("DIGITAL FADING: saved wear could not be cleared.", error);
      }
    }
  }

  class DigitalFadingApp {
    constructor() {
      this.canvas = document.getElementById("wear-canvas");
      this.surface = document.getElementById("surface");
      this.interactionsElement = document.getElementById("stat-interactions");
      this.timeElement = document.getElementById("stat-time");
      this.fadingElement = document.getElementById("stat-fading");
      this.memoryStatus = document.getElementById("memory-status");
      this.resetButton = document.getElementById("reset-button");
      this.resetDialog = document.getElementById("reset-dialog");
      this.cancelResetButton = document.getElementById("cancel-reset");
      this.confirmResetButton = document.getElementById("confirm-reset");

      const documentHeight = Math.max(document.documentElement.scrollHeight, window.innerHeight);
      const mapHeight = WearMap.targetHeight(window.innerWidth, documentHeight);
      this.wearMap = new WearMap(CONFIG.mapWidth, mapHeight);
      this.renderer = new DenimRenderer(this.canvas, this.wearMap);
      this.storage = new LocalWearStorage(this.memoryStatus);

      this.metadata = {
        totalInteractions: 0,
        activeTimeMs: 0,
        createdAt: Date.now(),
        lastVisitAt: Date.now(),
      };

      this.pointerSegments = [];
      this.lastMovePoint = null;
      this.lastPointerClient = null;
      this.pointerInside = false;
      this.pointerDown = false;
      this.pointerType = "mouse";
      this.lastPointerMoveAt = 0;
      this.lastHoverStampAt = 0;
      this.lastActivityAt = 0;
      this.movementCredit = 0;
      this.hoverCredit = 0;
      this.scrollCredit = 0;
      this.lastScrollY = window.scrollY;
      this.lastScrollStampAt = 0;
      this.lastTickAt = performance.now();
      this.lastStatsUpdateAt = 0;
      this.lastAnalysisAt = 0;
      this.lastSaveRequestAt = 0;
      this.fadingLevel = 0;
      this.renderRequested = true;
      this.analysisRequested = true;
      this.saveTimer = 0;
      this.resizeTimer = 0;
      this.destroyed = false;
      this.suppressEmptySave = true;

      this.tick = this.tick.bind(this);
      this.handlePointerMove = this.handlePointerMove.bind(this);
      this.handlePointerDown = this.handlePointerDown.bind(this);
      this.handlePointerUp = this.handlePointerUp.bind(this);
      this.handlePointerEnter = this.handlePointerEnter.bind(this);
      this.handlePointerLeave = this.handlePointerLeave.bind(this);
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
        };
      }

      if (saved?.map?.dataUrl) {
        try {
          await this.wearMap.restore(saved.map.dataUrl);
          this.storage.setStatus("MEMORY RESTORED");
        } catch (error) {
          console.warn("DIGITAL FADING: starting with a new surface because restoration failed.", error);
          this.storage.setStatus("NEW SURFACE");
        }
      } else if (this.storage.available) {
        this.storage.setStatus("NEW SURFACE");
      }

      this.renderer.resize();
      this.bindEvents();
      this.measureWear();
      this.updateStats();
      this.renderer.render(window.scrollY, this.documentHeight());
      requestAnimationFrame(this.tick);

      window.__DIGITAL_FADING__ = Object.freeze({
        version: CONFIG.storageVersion,
        save: () => this.saveNow(),
        snapshot: () => ({
          totalInteractions: this.metadata.totalInteractions,
          activeTimeMs: this.metadata.activeTimeMs,
          fadingLevel: this.fadingLevel,
          mapWidth: this.wearMap.width,
          mapHeight: this.wearMap.height,
        }),
      });
    }

    bindEvents() {
      window.addEventListener("pointermove", this.handlePointerMove, { passive: true });
      window.addEventListener("pointerdown", this.handlePointerDown, { passive: true });
      window.addEventListener("pointerup", this.handlePointerUp, { passive: true });
      window.addEventListener("pointercancel", this.handlePointerUp, { passive: true });
      document.addEventListener("pointerenter", this.handlePointerEnter, { passive: true });
      document.addEventListener("pointerleave", this.handlePointerLeave, { passive: true });
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

    pointFromClient(clientX, clientY) {
      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, this.documentHeight());
      return {
        clientX,
        clientY,
        nx: clamp(clientX / width, 0, 1),
        ny: clamp((window.scrollY + clientY) / height, 0, 1),
        time: performance.now(),
      };
    }

    handlePointerEnter(event) {
      this.pointerInside = true;
      this.pointerType = event.pointerType || this.pointerType;
    }

    handlePointerLeave() {
      this.pointerInside = false;
      this.pointerDown = false;
      this.lastMovePoint = null;
      this.lastPointerClient = null;
    }

    handlePointerMove(event) {
      if (this.isInterfaceTarget(event.target)) return;
      const coalesced = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [event];
      this.pointerInside = true;
      this.pointerType = event.pointerType || "mouse";

      for (const sample of coalesced) {
        const point = this.pointFromClient(sample.clientX, sample.clientY);
        if (this.lastMovePoint) {
          const clientDistance = Math.hypot(
            point.clientX - this.lastMovePoint.clientX,
            point.clientY - this.lastMovePoint.clientY,
          );
          const elapsed = Math.max(1, point.time - this.lastMovePoint.time);

          if (clientDistance >= 0.8) {
            this.pointerSegments.push({
              from: this.lastMovePoint,
              to: point,
              speed: clientDistance / elapsed,
              pointerType: this.pointerType,
            });
            if (this.pointerSegments.length > 220) this.pointerSegments.splice(0, this.pointerSegments.length - 220);

            this.movementCredit += clientDistance;
            const gained = Math.floor(this.movementCredit / CONFIG.movementInteractionDistance);
            if (gained > 0) {
              this.metadata.totalInteractions += gained;
              this.movementCredit -= gained * CONFIG.movementInteractionDistance;
            }
          }
        }

        this.lastMovePoint = point;
        this.lastPointerClient = { x: point.clientX, y: point.clientY };
      }

      this.lastPointerMoveAt = performance.now();
      this.markActive();
    }

    handlePointerDown(event) {
      if (this.isInterfaceTarget(event.target)) return;
      this.pointerDown = true;
      this.pointerInside = true;
      this.pointerType = event.pointerType || "mouse";
      const point = this.pointFromClient(event.clientX, event.clientY);
      this.lastMovePoint = point;
      this.lastPointerClient = { x: event.clientX, y: event.clientY };
      this.lastPointerMoveAt = performance.now();
      this.wearMap.clickCluster(point.nx, point.ny, this.pointerType);
      this.metadata.totalInteractions += this.pointerType === "touch" ? 2 : 1;
      this.markActive();
      this.markWearChanged();
    }

    handlePointerUp() {
      this.pointerDown = false;
      this.lastMovePoint = null;
    }

    handleScroll() {
      const current = window.scrollY;
      const delta = current - this.lastScrollY;
      const distance = Math.abs(delta);
      this.lastScrollY = current;
      this.lastMovePoint = null;
      this.renderRequested = true;

      if (distance > 0.5) {
        this.scrollCredit += distance;
        const gained = Math.floor(this.scrollCredit / CONFIG.scrollInteractionDistance);
        if (gained > 0) {
          this.metadata.totalInteractions += gained;
          this.scrollCredit -= gained * CONFIG.scrollInteractionDistance;
        }

        const now = performance.now();
        if (now - this.lastScrollStampAt > 88) {
          this.paintScrollWear(Math.sign(delta) || 1);
          this.lastScrollStampAt = now;
        }
        this.markActive();
      }
    }

    paintScrollWear(direction) {
      const anchors = Array.from(document.querySelectorAll(".wear-anchor"));
      if (!anchors.length) return;

      let nearest = anchors[0];
      let nearestDistance = Infinity;
      for (const anchor of anchors) {
        const rect = anchor.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = anchor;
        }
      }

      const focus = nearest.querySelector(".hero-copy, .field-copy, .memory-copy") || nearest;
      const rect = focus.getBoundingClientRect();
      const useEdge = Math.random() < 0.28;
      const clientX = useEdge
        ? (Math.random() < 0.5 ? randomRange(0.06, 0.16) : randomRange(0.84, 0.94)) * window.innerWidth
        : clamp(rect.left + rect.width * randomRange(0.12, 0.88), 24, window.innerWidth - 24);
      const clientY = clamp(rect.top + rect.height * randomRange(0.22, 0.78), 34, window.innerHeight - 34);
      const point = this.pointFromClient(clientX, clientY);
      const stamps = Math.random() < 0.36 ? 2 : 1;

      for (let index = 0; index < stamps; index += 1) {
        this.wearMap.stamp(point.nx + randomRange(-0.012, 0.012), point.ny + randomRange(-0.007, 0.007), {
          radius: randomRange(0.009, 0.018),
          strength: randomRange(0.025, 0.043),
          stretchX: randomRange(0.55, 0.9),
          stretchY: randomRange(1.45, 2.2),
          angle: (direction > 0 ? Math.PI / 2 : -Math.PI / 2) + randomRange(-0.22, 0.22),
        });
      }

      this.markWearChanged();
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
      }, 120);
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
        const speedFactor = clamp(segment.speed / 2.2, 0, 1);
        const touchFactor = segment.pointerType === "touch" ? 1.34 : 1;
        const radius = lerp(0.013, 0.0085, speedFactor) * touchFactor;
        const strength = lerp(0.017, 0.0065, speedFactor) * touchFactor;
        this.wearMap.stroke(segment.from, segment.to, {
          radius,
          strength,
          stretchX: lerp(1.65, 1.28, speedFactor),
          stretchY: lerp(0.78, 0.62, speedFactor),
          spacing: 0.72,
        });
        processed += 1;
      }

      if (processed > 0) this.markWearChanged();
    }

    processHover(now) {
      if (
        this.resetDialog.open ||
        !this.pointerInside ||
        this.pointerDown ||
        this.pointerType === "touch" ||
        !this.lastPointerClient ||
        now - this.lastPointerMoveAt < CONFIG.hoverDelayMs ||
        now - this.lastHoverStampAt < CONFIG.hoverStampIntervalMs
      ) {
        return;
      }

      const point = this.pointFromClient(this.lastPointerClient.x, this.lastPointerClient.y);
      const dwellSeconds = (now - this.lastPointerMoveAt) / 1000;
      const pressure = clamp(0.009 + dwellSeconds * 0.0017, 0.009, 0.024);
      const radius = clamp(0.015 + dwellSeconds * 0.0011, 0.015, 0.028);
      this.wearMap.stamp(point.nx + randomRange(-0.005, 0.005), point.ny + randomRange(-0.0035, 0.0035), {
        radius: radius * randomRange(0.82, 1.14),
        strength: pressure * randomRange(0.8, 1.2),
        stretchX: randomRange(0.82, 1.35),
        stretchY: randomRange(0.72, 1.16),
        angle: randomRange(0, Math.PI),
      });
      this.lastHoverStampAt = now;
      this.hoverCredit += 1;
      if (this.hoverCredit >= 6) {
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
      this.fadingLevel = result.level;
      this.analysisRequested = false;
      this.lastAnalysisAt = performance.now();
    }

    updateStats() {
      this.interactionsElement.textContent = new Intl.NumberFormat("en-US").format(
        Math.max(0, Math.floor(this.metadata.totalInteractions)),
      );
      this.timeElement.textContent = this.formatDuration(this.metadata.activeTimeMs);
      this.fadingElement.textContent = `${(this.fadingLevel * 100).toFixed(1)}%`;
    }

    formatDuration(milliseconds) {
      const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
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
      this.pointerSegments.length = 0;
      this.lastMovePoint = null;
      this.lastPointerClient = null;
      this.pointerInside = false;
      this.pointerDown = false;
      this.lastPointerMoveAt = performance.now();
      this.lastHoverStampAt = this.lastPointerMoveAt;
      this.movementCredit = 0;
      this.scrollCredit = 0;
      this.hoverCredit = 0;
      this.lastActivityAt = 0;
      this.lastSaveRequestAt = 0;
      this.suppressEmptySave = true;
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

      if (now - this.lastStatsUpdateAt >= 500) {
        this.updateStats();
        this.lastStatsUpdateAt = now;
      }

      requestAnimationFrame(this.tick);
    }
  }

  const app = new DigitalFadingApp();
  app.init();
})();
