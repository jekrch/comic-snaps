import { useEffect, useMemo, useRef, useState } from "react";
import { panelImageUrl } from "../../utils/imageUrl";
import { Wide } from "./explainerPrimitives";
import { Term } from "../guide/Term";
import {
  highlight,
  loadPatchExamples,
  similarityMap,
  type ModelMaps,
  type PatchExample,
  type PatchModel,
} from "./patchMaps";

const ACCENT: [number, number, number] = [233, 125, 98];

const captionStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  color: "rgba(255,255,255,0.4)",
};

/**
 * What each example's starting patch shows by layer 12, per model where the
 * two differ. Keyed by panel id; the list itself is EXAMPLES in
 * scripts/compute-patch-maps.py. Checked against that script's output.
 */
const EXAMPLE_NOTES: Record<string, Partial<Record<PatchModel, string>> & { both?: string }> = {
  "universal-monsters-phantom-of-the-opera-3-1777232387": {
    both: "Starts on Christine's face. By layer 12 it also matches the Phantom's masked face across the panel, though the two look nothing alike pixel for pixel.",
  },
  "bizarre-sex-1-1779570977": {
    both: "Starts near the tip of one horn. By layer 12 it matches the other horn, on the far side of the head, and not the green skin around it.",
  },
  "100-2-1773890854": {
    dino: "Starts inside the “It's… terrible” balloon. By layer 12 it matches the other balloon across the panel, not the dark art in between.",
    siglip: "Starts inside the “It's… terrible” balloon. By layer 12 it also picks out the smaller balloon across the panel.",
  },
  "buzzard-4-1783309323": {
    dino: "Starts on a creature's face in the right-hand panel. By layer 12 it also matches the other creature's face, over in the left-hand panel.",
    siglip: "Starts on a creature's face in the right-hand panel. By layer 12 it matches that face and, more faintly, the other creature's face in the left-hand panel.",
  },
  "red-roots-1-1777758703": {
    both: "Starts on the grey cat's nose. By layer 12 it matches the rest of the cat's face.",
  },
};

function noteFor(id: string, model: PatchModel): string | null {
  const n = EXAMPLE_NOTES[id];
  return n?.[model] ?? n?.both ?? null;
}

function exampleTitle(e: PatchExample): string {
  return e.issue != null ? `${e.title} #${e.issue}` : e.title;
}

/** The example panels: undefined while loading, empty if unavailable. */
function usePatchExamples(): PatchExample[] | undefined {
  const [examples, setExamples] = useState<PatchExample[] | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadPatchExamples().then((e) => {
      if (live) setExamples(e);
    });
    return () => {
      live = false;
    };
  }, []);
  return examples;
}

/**
 * The panel at the model's input shape, with one tint per patch: dark where
 * `strength` is 0, the accent where it's 1. The tints are a cols×rows canvas
 * scaled up with hard edges, so each block is exactly one patch.
 */
function PatchFrame({
  src,
  maps,
  strength,
  focus,
}: {
  src: string;
  maps: ModelMaps;
  strength: Float32Array;
  focus: number | null;
}) {
  const { cols, rows, scratch } = maps;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(cols, rows);
    for (let i = 0; i < cols * rows; i++) {
      const o = i * 4;
      if (i === focus) {
        img.data[o + 3] = 0; // the chosen patch shows clear
        continue;
      }
      if (scratch.has(i)) {
        img.data[o] = img.data[o + 1] = img.data[o + 2] = 12;
        img.data[o + 3] = 235;
        continue;
      }
      const t = strength[i];
      img.data[o] = ACCENT[0] * t;
      img.data[o + 1] = ACCENT[1] * t;
      img.data[o + 2] = ACCENT[2] * t;
      img.data[o + 3] = Math.round(255 * (0.64 - 0.16 * t));
    }
    ctx.putImageData(img, 0, 0);
  }, [cols, rows, scratch, strength, focus]);

  const fc = focus === null ? 0 : focus % cols;
  const fr = focus === null ? 0 : Math.floor(focus / cols);

  return (
    <div
      className="relative w-full overflow-hidden rounded-[2px]"
      style={{ aspectRatio: `${cols} / ${rows}`, outline: "1px solid rgba(255,255,255,0.08)" }}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        decoding="async"
        className="absolute inset-0 block w-full h-full"
        style={{ objectFit: "fill" }}
      />
      <canvas
        ref={canvasRef}
        width={cols}
        height={rows}
        className="absolute inset-0 w-full h-full"
        style={{ imageRendering: "pixelated" }}
      />
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox={`0 0 ${cols} ${rows}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {[...scratch].map((i) => {
          const c = i % cols;
          const r = Math.floor(i / cols);
          return (
            <g key={i} stroke="rgba(255,255,255,0.45)" strokeWidth={1}>
              <line x1={c + 0.2} y1={r + 0.2} x2={c + 0.8} y2={r + 0.8} vectorEffect="non-scaling-stroke" />
              <line x1={c + 0.8} y1={r + 0.2} x2={c + 0.2} y2={r + 0.8} vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {focus !== null && (
          <rect
            x={fc}
            y={fr}
            width={1}
            height={1}
            fill="none"
            stroke="#fff"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </div>
  );
}

/**
 * One patch's similarity to every other patch after an early, a middle,
 * and the final layer. Tapping or dragging across any figure picks the
 * patch for all three; on a mouse, hovering previews without committing.
 * Keyed by the parent per example and model, so `selected` starts fresh on
 * each one's own starting patch.
 */
function LayerFigures({ src, maps, label }: { src: string; maps: ModelMaps; label: string }) {
  const { cols, rows, scratch } = maps;
  const [selected, setSelected] = useState(maps.focus);
  const [hover, setHover] = useState<number | null>(null);
  const pressed = useRef(false);

  const focus = hover ?? selected;

  const strengths = useMemo(
    () => maps.layers.map((_, li) => highlight(similarityMap(maps, li, focus), focus, scratch)),
    [maps, focus, scratch]
  );

  const patchAt = (e: React.PointerEvent<HTMLElement>): number | null => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return null;
    const c = Math.min(cols - 1, Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * cols)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor(((e.clientY - box.top) / box.height) * rows)));
    const i = r * cols + c;
    return scratch.has(i) ? null : i;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    pressed.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const i = patchAt(e);
    if (i !== null) setSelected(i);
    setHover(null);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const i = patchAt(e);
    if (i === null) return;
    if (pressed.current) setSelected(i);
    else if (e.pointerType === "mouse") setHover(i);
  };
  const onPointerEnd = () => {
    pressed.current = false;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols };
    const d = step[e.key];
    if (d === undefined) return;
    e.preventDefault();
    const c = selected % cols;
    if ((d === -1 && c === 0) || (d === 1 && c === cols - 1)) return;
    let next = selected + d;
    while (next >= 0 && next < cols * rows && scratch.has(next)) next += d;
    if (next >= 0 && next < cols * rows) setSelected(next);
  };

  return (
    <div
      className="grid grid-cols-3 gap-2 items-start outline-none
                 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4
                 focus-visible:outline-[var(--color-accent,#e97d62)] rounded-[2px]"
      role="group"
      tabIndex={0}
      aria-label={`${label}: patch similarity after layers ${maps.layers.join(", ")}. Arrow keys move the chosen patch.`}
      onKeyDown={onKeyDown}
      onPointerLeave={() => setHover(null)}
    >
      {maps.layers.map((layer, li) => (
        <figure key={layer} className="m-0 flex flex-col items-center min-w-0">
          <div
            className="w-full cursor-crosshair select-none"
            style={{ touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
          >
            <PatchFrame src={src} maps={maps} strength={strengths[li]} focus={focus} />
          </div>
          <figcaption className="guide-caption mt-1.5 text-center" style={captionStyle}>
            <span style={{ color: "rgba(255,255,255,0.6)" }}>After layer {layer}</span>
            <br />
            of {maps.layers[maps.layers.length - 1]}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/** A row of thumbnails for choosing the example panel. */
function ExamplePicker({
  examples,
  index,
  onPick,
}: {
  examples: PatchExample[];
  index: number;
  onPick: (i: number) => void;
}) {
  return (
    <div className="flex justify-center items-center gap-1.5 flex-wrap" role="radiogroup" aria-label="Example panel">
      {examples.map((e, i) => {
        const on = i === index;
        return (
          <button
            key={e.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={exampleTitle(e)}
            title={exampleTitle(e)}
            onClick={() => onPick(i)}
            className="p-0 m-0 border-0 bg-transparent cursor-pointer rounded-[2px]
                       transition-opacity duration-150 hover:opacity-100
                       focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--color-accent,#e97d62)]"
            style={{ opacity: on ? 1 : 0.45 }}
          >
            <img
              src={panelImageUrl(e.image)}
              alt=""
              draggable={false}
              loading="lazy"
              decoding="async"
              className="block rounded-[2px]"
              style={{
                height: 30,
                maxWidth: 64,
                objectFit: "cover",
                outline: on ? "1px solid var(--color-accent, #e97d62)" : "1px solid rgba(255,255,255,0.1)",
                outlineOffset: 1,
              }}
            />
          </button>
        );
      })}
    </div>
  );
}

/** DINOv2's CLS attention over the panel in the last layer. */
function SummaryFigure({ src, maps }: { src: string; maps: ModelMaps }) {
  const strength = useMemo(() => {
    const s = maps.summary ?? new Float32Array(maps.cols * maps.rows);
    return Float32Array.from(s, (v) => Math.sqrt(v));
  }, [maps]);
  return (
    <figure className="m-0 shrink-0" style={{ width: "34%" }}>
      <PatchFrame src={src} maps={maps} strength={strength} focus={null} />
      <figcaption className="guide-caption mt-1.5 text-center" style={captionStyle}>
        <span style={{ color: "rgba(255,255,255,0.6)" }}>What CLS read</span>
        <br />
        last layer
      </figcaption>
    </figure>
  );
}

/**
 * The transformer section's figures and the text that depends on them,
 * cycling through the example panels.
 */
export function TransformerExamples({ model, modelName, dim }: { model: PatchModel; modelName: string; dim: number }) {
  const examples = usePatchExamples();
  const [index, setIndex] = useState(0);

  if (examples === undefined || examples.length === 0) {
    return (
      <p className="guide-caption my-3 text-center">
        {examples === undefined ? "Loading the examples…" : "The examples couldn't be loaded."}
      </p>
    );
  }

  const example = examples[Math.min(index, examples.length - 1)];
  const maps = example[model];
  const src = panelImageUrl(example.image);
  const note = noteFor(example.id, model);

  return (
    <>
      <p>
        Here's what that does, on {examples.length} panels from the gallery.
        Pick one:
      </p>

      <Wide>
        <ExamplePicker examples={examples} index={index} onPick={setIndex} />
        <p className="guide-caption mt-2 mb-2.5 text-center" style={{ ...captionStyle, color: "rgba(255,255,255,0.6)" }}>
          {exampleTitle(example)}
        </p>
        <LayerFigures key={`${example.id}-${model}`} src={src} maps={maps} label={`${modelName}, ${exampleTitle(example)}`} />
        <p className="guide-caption mt-2 mb-0 text-center" style={captionStyle}>
          Tap or drag across a figure to choose a different patch.
        </p>
      </Wide>

      <p>
        The outlined square is one patch. Every other patch is tinted by how
        much its numbers now resemble that patch's numbers: bright orange is
        very alike, dark is unrelated. After layer 1 a patch mostly matches
        patches that look like it, wherever they are: paper matches paper,
        solid black matches solid black. By layer 6 it leans on its
        neighbours. By layer 12 it tends to match the rest of whatever it
        belongs to, including patches that look quite different from it.
      </p>
      {note && <p>{note}</p>}

      {maps.scratch.size > 0 && (
        <p>
          The crossed-out squares are patches {modelName} has taken over as{" "}
          <Term id="scratch" first>scratch space</Term>. Partway through, it stops using them to describe the
          art and keeps information about the whole panel there instead
          {model === "siglip" && ", often in the same spots whatever the panel"}
          . They're left out of the comparison.
        </p>
      )}

      {model === "dino" ? (
        <div className="mt-3 flex items-start gap-3">
          {maps.summary && <SummaryFigure src={src} maps={maps} />}
          <p>
            DINOv2 also carries one extra token, <Term id="cls" first>CLS</Term>, which has no
            patch of its own and only gathers from the others.
            {maps.summary && " The figure shows how much it drew from each patch of this panel in the last layer."}{" "}
            Half of the arrow in the next step is CLS; the other half is the
            plain average of every patch's final numbers.
          </p>
        </div>
      ) : (
        <p>
          To get from {maps.cols * maps.rows} patches to one list for the
          whole panel, SigLIP ends with one more attention step: a single
          learned question that gathers from all the patches at once. Its
          answer is the {dim} numbers in the next step.
        </p>
      )}
    </>
  );
}
