/**
 * The planet, full screen, on the GPU - and turnable by hand.
 *
 * GL plumbing only. What the planet looks like is decided in
 * `src/render/globe-shader.ts`, a port of `src/render/planet.ts`, so the
 * look stays next to the renderer the golden frames pin. This file owns a
 * canvas, compiles that shader, uploads the two coverage tables, and turns
 * pointer input into the angles `orbit.ts` computes.
 *
 * Without WebGL2 it falls back to the software renderer, scaled up. Slower to
 * turn and softer, but the same planet.
 */

import type { VisualChannels } from "../sim/index.js";
import { CDF_BINS, GLOBE_FRAGMENT, GLOBE_VERTEX } from "../render/globe-shader.js";
import { cloudFieldHighAt, createScene, elevationField, renderScene } from "../render/planet.js";
import type { PlanetScene } from "../render/planet.js";
import { sphereCdf } from "../render/sphere-cdf.js";
import type { Orbit } from "./orbit.js";
import { coast, drag, hold, initialOrbit, zoomBy } from "./orbit.js";
import { MAX_DPR } from "./config.js";
import type { Settlement } from "../sim/index.js";
import { latLonToVec, vecToLatLon } from "../sim/index.js";
import type { GlobeCamera } from "./globe-geometry.js";
import { pickPlanet, projectToScreen } from "./globe-geometry.js";
import { formatLatLon, settlementLabel } from "./settlement-label.js";

/** Anything the instrument panel can hand channels to. */
export interface PlanetSink {
  update(channels: VisualChannels): void;
}

/** Share of the free area's short side the disc's radius takes at zoom 1. Leaves a margin of sky. */
const DISC_FRACTION = 0.42;
/** Frame-time targets for the adaptive render scale, milliseconds. */
const SLOW_FRAME_MS = 26;
const FAST_FRAME_MS = 15;

interface Gl {
  readonly gl: WebGL2RenderingContext;
  readonly program: WebGLProgram;
  readonly uniforms: Readonly<Record<string, WebGLUniformLocation | null>>;
}

const UNIFORMS = [
  "uResolution", "uCenter", "uRadius", "uPixelRatio", "uYaw", "uPitch", "uTime",
  "uCap", "uOcean", "uGreen", "uCloud", "uDust", "uAir", "uSky", "uTint",
  "uElevCdf", "uCloudCdf",
] as const;

export class Globe implements PlanetSink {
  readonly canvas: HTMLCanvasElement;
  private channels: VisualChannels | null = null;
  private orbit: Orbit = initialOrbit();
  private gl: Gl | null = null;
  private fallback: CanvasRenderingContext2D | null = null;
  private fallbackScene: { scene: PlanetScene; yaw: number; at: number } | null = null;
  /** Left inset, in CSS pixels, taken by the overlay panel - the disc centres in what is left. */
  private insetLeft = 0;
  private renderScale = 1;
  private lastFrame = 0;
  private slowFrames = 0;
  private fastFrames = 0;
  private dragging: { id: number; x: number; y: number; t: number } | null = null;
  private readonly started = performance.now();
  /** Batch 17: one marker per settlement, laid over the canvas and moved every frame. */
  private readonly markerLayer: HTMLElement;
  private readonly markers = new Map<string, { el: HTMLElement; settlement: Settlement }>();
  /** Set while the player is choosing a founding site: the next click on the planet picks it. */
  private picking: ((site: { lat: number; lon: number }) => void) | null = null;
  private pressedAt: { x: number; y: number } | null = null;

  constructor(host: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "globe-canvas";
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "The planet. Drag to turn it, scroll to zoom.");
    host.append(this.canvas);
    this.markerLayer = document.createElement("div");
    this.markerLayer.className = "globe-markers";
    host.append(this.markerLayer);

    this.gl = this.initGl();
    if (this.gl === null) this.fallback = this.canvas.getContext("2d");

    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.gl = null;
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      this.gl = this.initGl();
    });
    this.bindInput();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame((t) => this.frame(t));
  }

  /** Called when the player clicks a settlement's marker (micro §1.4: "selects a marker"). */
  onMarker: ((id: string) => void) | null = null;

  /** True while a journey drives the camera: the player's hand and the idle spin wait. */
  private posed = false;

  /**
   * Drive the camera to a pose (a journey's camera move, Batch 21), or hand
   * it back to the player with null. Handing back keeps the pose, still.
   */
  setPose(pose: { yaw: number; pitch: number; zoom: number } | null): void {
    if (pose === null) {
      this.posed = false;
      this.orbit = hold(this.orbit);
      return;
    }
    this.posed = true;
    this.dragging = null;
    this.orbit = { ...hold(this.orbit), yaw: pose.yaw, pitch: pose.pitch, zoom: pose.zoom };
  }

  /** The camera as it stands: where a journey's pull-back should return to. */
  currentPose(): { yaw: number; pitch: number; zoom: number } {
    return { yaw: this.orbit.yaw, pitch: this.orbit.pitch, zoom: this.orbit.zoom };
  }

  /** Stop drawing (the city view covers the planet) without losing the camera. */
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  update(channels: VisualChannels): void {
    this.channels = channels;
  }

  /** The settlements to mark on the planet. Markers are created and removed to match. */
  setSettlements(settlements: readonly Settlement[]): void {
    const live = new Set(settlements.map((s) => s.id));
    for (const [id, m] of this.markers) {
      if (!live.has(id)) {
        m.el.remove();
        this.markers.delete(id);
      }
    }
    for (const s of settlements) {
      const existing = this.markers.get(s.id);
      if (existing !== undefined) {
        this.markers.set(s.id, { el: existing.el, settlement: s });
        continue;
      }
      const el = document.createElement("button");
      el.type = "button";
      el.className = "globe-marker";
      el.setAttribute("aria-label", `Travel to ${settlementLabel(s)}`);
      el.addEventListener("click", () => this.onMarker?.(s.id));
      el.dataset["kind"] = s.kind;
      el.dataset["id"] = s.id;
      const pin = document.createElement("span");
      pin.className = "globe-marker-pin";
      const label = document.createElement("span");
      label.className = "globe-marker-label";
      label.textContent = settlementLabel(s);
      el.append(pin, label);
      el.title = `${settlementLabel(s)} - ${formatLatLon(s.lat, s.lon)}`;
      this.markerLayer.append(el);
      this.markers.set(s.id, { el, settlement: s });
    }
    this.placeMarkers();
  }

  /** The next click on the planet (not a drag) chooses a site. */
  beginPick(onPick: (site: { lat: number; lon: number }) => void): void {
    this.picking = onPick;
    this.canvas.classList.add("picking");
  }

  cancelPick(): void {
    this.picking = null;
    this.canvas.classList.remove("picking");
  }

  /** The camera the globe is drawing with, in CSS pixels - what markers and picking need. */
  camera(): GlobeCamera {
    const a = this.freeArea();
    return { cx: a.x + a.w / 2, cy: a.h / 2, radius: this.discRadiusCss(), yaw: this.orbit.yaw, pitch: this.orbit.pitch };
  }

  private placeMarkers(): void {
    if (this.markers.size === 0) return;
    const cam = this.camera();
    for (const { el, settlement: s } of this.markers.values()) {
      const at = projectToScreen(latLonToVec(s.lat, s.lon), cam);
      el.hidden = !at.visible;
      if (!at.visible) continue;
      el.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
      // Fade out as it rounds the limb rather than popping.
      el.style.opacity = Math.min(1, at.depth / 0.12).toFixed(3);
    }
  }

  /** The overlay panel's width, so the planet sits in the space beside it. */
  setInsetLeft(cssPixels: number): void {
    this.insetLeft = Math.max(0, cssPixels);
  }

  // ---- input ---------------------------------------------------------------

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || this.posed) return;
      c.setPointerCapture(e.pointerId);
      c.classList.add("dragging");
      this.pressedAt = { x: e.clientX, y: e.clientY };
      this.dragging = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
      this.orbit = hold(this.orbit);
    });
    c.addEventListener("pointermove", (e) => {
      const d = this.dragging;
      if (d === null || d.id !== e.pointerId) return;
      const dt = Math.max((e.timeStamp - d.t) / 1000, 1 / 240);
      this.orbit = drag(this.orbit, e.clientX - d.x, e.clientY - d.y, this.discRadiusCss(), dt);
      this.dragging = { id: d.id, x: e.clientX, y: e.clientY, t: e.timeStamp };
    });
    const release = (e: PointerEvent): void => {
      if (this.dragging?.id !== e.pointerId) return;
      // A click - pressed and released in place - picks a founding site when
      // one is being chosen. A drag still turns the planet as usual.
      const p = this.pressedAt;
      if (this.picking !== null && p !== null && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) {
        const rect = c.getBoundingClientRect();
        const hit = pickPlanet(e.clientX - rect.left, e.clientY - rect.top, this.camera());
        if (hit !== null) {
          const onPick = this.picking;
          this.cancelPick();
          onPick(vecToLatLon(hit));
        }
      }
      this.pressedAt = null;
      // A pause before letting go means "put it down", not "flick it".
      if (e.timeStamp - this.dragging.t > 80) this.orbit = hold(this.orbit);
      this.dragging = null;
      c.classList.remove("dragging");
    };
    c.addEventListener("pointerup", release);
    c.addEventListener("pointercancel", release);
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (this.posed) return;
        this.orbit = zoomBy(this.orbit, e.deltaY);
      },
      { passive: false },
    );
  }

  // ---- layout --------------------------------------------------------------

  private cssSize(): { w: number; h: number } {
    return { w: Math.max(1, this.canvas.clientWidth), h: Math.max(1, this.canvas.clientHeight) };
  }

  /** The free area beside the panel, in CSS pixels. Narrow screens ignore the panel. */
  private freeArea(): { x: number; w: number; h: number } {
    const { w, h } = this.cssSize();
    const inset = w - this.insetLeft >= 520 ? this.insetLeft : 0;
    return { x: inset, w: w - inset, h };
  }

  private discRadiusCss(): number {
    const a = this.freeArea();
    return DISC_FRACTION * Math.min(a.w, a.h) * this.orbit.zoom;
  }

  // ---- drawing ---------------------------------------------------------------

  private paused = false;

  private frame(now: number): void {
    if (this.paused) {
      this.lastFrame = 0;
      requestAnimationFrame((t) => this.frame(t));
      return;
    }
    const dt = this.lastFrame === 0 ? 1 / 60 : Math.min((now - this.lastFrame) / 1000, 0.1);
    const frameMs = now - this.lastFrame;
    this.lastFrame = now;
    if (this.dragging === null && !this.posed) this.orbit = coast(this.orbit, dt);
    this.adaptScale(frameMs);

    if (this.gl !== null) this.drawGl(now);
    else if (this.fallback !== null) this.drawFallback(now);
    this.placeMarkers();
    requestAnimationFrame((t) => this.frame(t));
  }

  /**
   * Shade fewer pixels when the GPU cannot keep up, more when it can. The
   * canvas is CSS-scaled back to full size either way.
   */
  private adaptScale(frameMs: number): void {
    if (!(frameMs > 0) || frameMs > 250) return;
    if (frameMs > SLOW_FRAME_MS) {
      this.slowFrames += 1;
      this.fastFrames = 0;
      if (this.slowFrames > 20) {
        this.renderScale = Math.max(0.5, this.renderScale * 0.85);
        this.slowFrames = 0;
      }
    } else if (frameMs < FAST_FRAME_MS) {
      this.fastFrames += 1;
      this.slowFrames = 0;
      if (this.fastFrames > 120) {
        this.renderScale = Math.min(1, this.renderScale * 1.1);
        this.fastFrames = 0;
      }
    }
  }

  private resize(): { ratio: number; w: number; h: number } {
    const { w, h } = this.cssSize();
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_DPR) * this.renderScale;
    const pw = Math.max(1, Math.round(w * ratio));
    const ph = Math.max(1, Math.round(h * ratio));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    return { ratio: pw / w, w: pw, h: ph };
  }

  private drawGl(now: number): void {
    const g = this.gl;
    const ch = this.channels;
    if (g === null || ch === null) return;
    const { gl, uniforms: u } = g;
    const { ratio, w, h } = this.resize();
    const area = this.freeArea();

    gl.viewport(0, 0, w, h);
    gl.useProgram(g.program);
    gl.uniform2f(u["uResolution"] ?? null, w, h);
    // GL's origin is bottom-left; the free area is centred vertically anyway.
    gl.uniform2f(u["uCenter"] ?? null, (area.x + area.w / 2) * ratio, (area.h / 2) * ratio);
    gl.uniform1f(u["uRadius"] ?? null, this.discRadiusCss() * ratio);
    gl.uniform1f(u["uPixelRatio"] ?? null, ratio);
    gl.uniform1f(u["uYaw"] ?? null, this.orbit.yaw);
    gl.uniform1f(u["uPitch"] ?? null, this.orbit.pitch);
    gl.uniform1f(u["uTime"] ?? null, (now - this.started) / 1000);
    gl.uniform1f(u["uCap"] ?? null, ch.capRadius);
    gl.uniform1f(u["uOcean"] ?? null, ch.oceanCoverage);
    gl.uniform1f(u["uGreen"] ?? null, ch.surfaceGreen);
    gl.uniform1f(u["uCloud"] ?? null, ch.cloudCover);
    gl.uniform1f(u["uDust"] ?? null, ch.dustIntensity);
    gl.uniform1f(u["uAir"] ?? null, ch.atmosphereThickness);
    gl.uniform3f(u["uSky"] ?? null, ch.skyColour.r, ch.skyColour.g, ch.skyColour.b);
    gl.uniform3f(u["uTint"] ?? null, ch.surfaceTint.r, ch.surfaceTint.g, ch.surfaceTint.b);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * The software renderer, scaled up. Its scene is per camera and costs tens
   * of milliseconds to build, so it is rebuilt only when the globe has turned
   * noticeably, and not more than a few times a second.
   */
  private drawFallback(now: number): void {
    const ctx = this.fallback;
    const ch = this.channels;
    if (ctx === null || ch === null) return;
    const { w, h, ratio } = this.resize();
    const size = 320;
    // The software renderer spins by +spin; the globe's convention is -yaw (see toPlanetJs).
    const spin = -this.orbit.yaw / (2 * Math.PI);
    const cached = this.fallbackScene;
    if (cached === null || (Math.abs(cached.yaw - spin) > 0.004 && now - cached.at > 250)) {
      this.fallbackScene = { scene: createScene({ width: size, height: size, spin }), yaw: spin, at: now };
    }
    const scene = this.fallbackScene?.scene;
    if (scene === undefined) return;
    const frame = renderScene(scene, ch);
    const image = new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height);
    const area = this.freeArea();
    // createScene's disc is 0.38 of the frame; scale the frame so the disc matches the GL radius.
    const scale = (this.discRadiusCss() * ratio) / (size * 0.38);
    ctx.fillStyle = "#050509";
    ctx.fillRect(0, 0, w, h);
    const tmp = document.createElement("canvas");
    tmp.width = size;
    tmp.height = size;
    tmp.getContext("2d")?.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    const drawn = size * scale;
    ctx.drawImage(tmp, (area.x + area.w / 2) * ratio - drawn / 2, (area.h / 2) * ratio - drawn / 2, drawn, drawn);
  }

  // ---- setup -------------------------------------------------------------------

  private initGl(): Gl | null {
    const gl = this.canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance" });
    if (gl === null) return null;

    const compile = (type: number, source: string): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (shader === null) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("globe shader failed to compile:", gl.getShaderInfoLog(shader));
        return null;
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, GLOBE_VERTEX);
    const fs = compile(gl.FRAGMENT_SHADER, GLOBE_FRAGMENT);
    if (vs === null || fs === null) return null;
    const program = gl.createProgram();
    if (program === null) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, "aPos");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("globe program failed to link:", gl.getProgramInfoLog(program));
      return null;
    }

    // One triangle that covers the screen.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of UNIFORMS) uniforms[name] = gl.getUniformLocation(program, name);

    gl.useProgram(program);
    this.uploadCdf(gl, 0, sphereCdf(elevationField, 60000, CDF_BINS));
    this.uploadCdf(gl, 1, sphereCdf(cloudFieldHighAt, 40000, CDF_BINS));
    gl.uniform1i(uniforms["uElevCdf"] ?? null, 0);
    gl.uniform1i(uniforms["uCloudCdf"] ?? null, 1);

    return { gl, program, uniforms };
  }

  private uploadCdf(gl: WebGL2RenderingContext, unit: number, table: Float32Array): void {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, table.length, 1, 0, gl.RED, gl.FLOAT, table);
  }
}
