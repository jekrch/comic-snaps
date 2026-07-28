import type { Panel } from "../../../../types";
import type { DrawShard, VizBackend, VizFrame } from "../types";
import { CSS_BLEND } from "../types";

interface Slot {
  wrap: HTMLDivElement;
  img: HTMLImageElement;
  panelId: string;
}

/**
 * Fallback backend for missing WebGL2 (and a plausible target for a very low
 * power path). It consumes the same declarative shard list as the WebGL
 * backend, so all of the choreography in the director is shared rather than
 * reimplemented — that split is the whole reason the frame is a value type.
 *
 * It cannot do frame feedback, halftone, or any of the uv-domain effects
 * (kaleidoscope, tiling, warp, ripple, twist, bulge) — those are all resolved
 * in the post shader, so a preset built around them degrades to its stack and
 * motion here. Crossfades, crops, transforms, and blend modes all survive.
 */
export class CssBackend implements VizBackend {
  private readonly stage: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  private readonly slots: Slot[] = [];
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly ready = new Set<string>();
  private height = 1;
  private disposed = false;

  constructor(root: HTMLElement) {
    this.stage = document.createElement("div");
    this.stage.style.cssText =
      "position:absolute;inset:0;overflow:hidden;background:#000;isolation:isolate;";
    this.vignette = document.createElement("div");
    this.vignette.style.cssText =
      "position:absolute;inset:0;pointer-events:none;" +
      "background:radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.75) 100%);";
    this.stage.appendChild(this.vignette);
    root.appendChild(this.stage);
  }

  resize(_width: number, height: number): void {
    // Stage space is normalised to the frame height, so only height matters.
    this.height = height;
  }

  isReady(panelId: string): boolean {
    return this.ready.has(panelId);
  }

  requestPanels(panels: Panel[]): void {
    for (const panel of panels) {
      if (this.images.has(panel.id)) continue;
      const img = new Image();
      img.decoding = "async";
      img.src = `${import.meta.env.BASE_URL}${panel.image}`;
      img.onload = () => this.ready.add(panel.id);
      this.images.set(panel.id, img);
    }
  }

  render(frame: VizFrame): void {
    if (this.disposed) return;
    const drawable = frame.shards.filter(
      (shard) => shard.opacity > 0.001 && this.ready.has(shard.panelId)
    );

    while (this.slots.length < drawable.length) this.addSlot();

    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const shard = drawable[i];
      if (!shard) {
        slot.wrap.style.display = "none";
        continue;
      }
      slot.wrap.style.display = "block";
      this.applyShard(slot, shard);
    }

    this.vignette.style.opacity = String(frame.post.vignette);
  }

  private addSlot(): void {
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:absolute;overflow:hidden;will-change:transform,opacity;";
    const img = document.createElement("img");
    img.style.cssText = "position:absolute;max-width:none;";
    wrap.appendChild(img);
    // Below the vignette, which stays last in the stage.
    this.stage.insertBefore(wrap, this.vignette);
    this.slots.push({ wrap, img, panelId: "" });
  }

  private applyShard(slot: Slot, shard: DrawShard): void {
    const source = this.images.get(shard.panelId);
    if (!source) return;
    if (slot.panelId !== shard.panelId) {
      slot.img.src = source.src;
      slot.panelId = shard.panelId;
    }

    // Stage space is y-up with x in [0, aspect]; CSS is y-down in pixels.
    const scale = this.height;
    const w = shard.dstRect.w * scale;
    const h = shard.dstRect.h * scale;
    const left = shard.dstRect.x * scale;
    const top = (1 - shard.dstRect.y - shard.dstRect.h) * scale;

    slot.wrap.style.width = `${w}px`;
    slot.wrap.style.height = `${h}px`;
    slot.wrap.style.left = `${left}px`;
    slot.wrap.style.top = `${top}px`;
    slot.wrap.style.opacity = String(shard.opacity);
    slot.wrap.style.mixBlendMode = CSS_BLEND[shard.blendMode];
    // CSS rotates clockwise; the stage convention is counter-clockwise.
    slot.wrap.style.transform = `rotate(${-shard.rotation}rad)`;

    const imgW = w / Math.max(shard.srcRect.w, 1e-4);
    const imgH = h / Math.max(shard.srcRect.h, 1e-4);
    slot.img.style.width = `${imgW}px`;
    slot.img.style.height = `${imgH}px`;
    slot.img.style.left = `${-shard.srcRect.x * imgW}px`;
    slot.img.style.top = `${-(1 - shard.srcRect.y - shard.srcRect.h) * imgH}px`;

    if (shard.tintAmount > 0.01) {
      const [r, g, b] = shard.tint;
      slot.img.style.filter = `saturate(${1 + shard.tintAmount})`;
      slot.wrap.style.backgroundColor = `rgba(${r * 255 | 0},${g * 255 | 0},${b * 255 | 0},${shard.tintAmount * 0.5})`;
      slot.wrap.style.backgroundBlendMode = "multiply";
    } else {
      slot.img.style.filter = "";
      slot.wrap.style.backgroundColor = "";
    }
  }

  get stats(): { resident: number; pending: number } {
    return { resident: this.ready.size, pending: this.images.size - this.ready.size };
  }

  dispose(): void {
    this.disposed = true;
    this.stage.remove();
    this.images.clear();
    this.ready.clear();
  }
}
