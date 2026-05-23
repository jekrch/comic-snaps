import { useEffect, useRef, useState } from "react";
import {
  COVERAGE_TOTAL,
  FLIP_THRESHOLD,
  MAX_LAYERS,
  REST_MAX_SEC,
} from "./constants";
import { coverageRatio, markCoverage } from "./coverage";
import { generateSplashEvent, generateTakeoverEvent } from "./events";
import type { LiquidPhase, SettledGlob, SplashEvent, SplashLayer } from "./types";

interface UseLiquidAnimationOptions {
  enabled: boolean;
  width: number;
  height: number;
  baseRadius: number;
}

interface UseLiquidAnimationResult {
  event: SplashEvent | null;
  layers: SplashLayer[];
}

/**
 * Drives the splash lifecycle: timed events, coverage tracking, phase flips,
 * and the periodic full-tile "takeover" that clears the accumulated layers.
 *
 * State machine:
 *   dark splashes accumulate → 80% dark coverage → flip to light phase
 *   → light splashes paint over the dark → 80% light coverage → flip to dark
 *   → after MAX_LAYERS layers, next phase change fires a takeover that
 *     engulfs the tile in the base color and resets everything.
 */
export function useLiquidAnimation({
  enabled,
  width,
  height,
  baseRadius,
}: UseLiquidAnimationOptions): UseLiquidAnimationResult {
  const [event, setEvent] = useState<SplashEvent | null>(null);
  /**
   * Phase: 'dark' globs accumulate first; once dark coverage hits the flip
   * threshold, 'light' globs start forming in the dark areas. When the light
   * layer restores enough of the screen to light, the cycle starts over.
   *
   * Phase state is held by the caller via a ref-mirror so phase flips can
   * happen mid-effect without restarting the whole timer chain.
   */
  const [, setPhase] = useState<LiquidPhase>("dark");
  // Chronological layers — newest is on top, so each phase visibly overpaints
  // the previous one.
  const [layers, setLayers] = useState<SplashLayer[]>([]);
  // Mirror of `layers` for the timer closure, which can't read state directly.
  const layersRef = useRef<SplashLayer[]>([]);
  useEffect(() => { layersRef.current = layers; }, [layers]);

  const nextLayerIdRef = useRef(0);
  // Grids are refs (not state): read inside the lifecycle timer and don't
  // need to drive re-renders on their own.
  const darkGridRef = useRef<Uint8Array>(new Uint8Array(COVERAGE_TOTAL));
  const lightGridRef = useRef<Uint8Array>(new Uint8Array(COVERAGE_TOTAL));

  useEffect(() => {
    if (!enabled || width <= 0 || height <= 0) {
      setEvent(null);
      return;
    }

    let activeTimer: ReturnType<typeof setTimeout> | null = null;
    let nextTimer: ReturnType<typeof setTimeout> | null = null;
    let nextId = 0;
    let currentPhase: LiquidPhase = "dark";

    const scheduleTakeover = () => {
      nextId += 1;
      const takeover = generateTakeoverEvent(nextId, width, height);
      setEvent(takeover);
      activeTimer = setTimeout(() => {
        setLayers([]);
        darkGridRef.current = new Uint8Array(COVERAGE_TOTAL);
        lightGridRef.current = new Uint8Array(COVERAGE_TOTAL);
        currentPhase = "dark";
        setPhase("dark");
        setEvent(null);
      }, takeover.activeSec * 1000);
      nextTimer = setTimeout(fire, (takeover.activeSec + takeover.restSec) * 1000);
    };

    const commitSettledLayer = (e: SplashEvent) => {
      const ownGrid = e.phase === "dark" ? darkGridRef.current : lightGridRef.current;
      const newSettled: SettledGlob[] = e.droplets.map((d) => ({
        x: d.finalX,
        y: d.finalY,
        rx: d.rx,
        ry: d.ry,
      }));
      for (const g of newSettled) {
        markCoverage(ownGrid, g, width, height);
      }
      setLayers((prev) => {
        const last = prev[prev.length - 1];
        let next: SplashLayer[];
        if (last && last.phase === e.phase) {
          // Same phase — merge into the most recent layer so the whole phase
          // shares one gooey-blurred silhouette.
          next = [
            ...prev.slice(0, -1),
            { ...last, globs: [...last.globs, ...newSettled] },
          ];
        } else {
          // Phase changed — start a new top layer. Renders above all earlier
          // layers, so each cycle visibly overpaints the last.
          nextLayerIdRef.current += 1;
          next = [
            ...prev,
            { id: nextLayerIdRef.current, phase: e.phase, globs: newSettled },
          ];
        }
        while (next.length > MAX_LAYERS) next = next.slice(1);
        return next;
      });
      // Drop the active mask in the same batched update — the layer now owns
      // these globs. Leaving the active mask up during rest would double-
      // render the same area, compounding with strokeOpacity into a darker
      // patch that would blink away when the next event swapped the mask.
      setEvent(null);
    };

    const maybeFlipPhase = () => {
      const grid = currentPhase === "dark" ? darkGridRef.current : lightGridRef.current;
      if (coverageRatio(grid) < FLIP_THRESHOLD) return;
      // Reset the *other* phase's grid so the new phase tracks fresh coverage.
      // The grid we just filled stays — light placement biases toward dark
      // territory; the next dark cycle should likewise treat the (now-stale)
      // light coverage as untouched ground.
      if (currentPhase === "dark") {
        currentPhase = "light";
        lightGridRef.current = new Uint8Array(COVERAGE_TOTAL);
        setPhase("light");
      } else {
        currentPhase = "dark";
        darkGridRef.current = new Uint8Array(COVERAGE_TOTAL);
        setPhase("dark");
      }
    };

    const fire = () => {
      // Once MAX_LAYERS have settled and the next event would start a new
      // layer (i.e. the phase has flipped since the topmost layer was laid),
      // emit the takeover instead.
      const top = layersRef.current[layersRef.current.length - 1];
      const startingNewLayer = !top || top.phase !== currentPhase;
      if (layersRef.current.length >= MAX_LAYERS && startingNewLayer) {
        scheduleTakeover();
        return;
      }

      nextId += 1;
      // Dark phase targets the whole tile (no mask). Light phase scores only
      // cells already dark, so light blobs bias toward landing in the dark.
      const ownGrid = currentPhase === "dark" ? darkGridRef.current : lightGridRef.current;
      const targetMask = currentPhase === "dark" ? null : darkGridRef.current;
      const e = generateSplashEvent(nextId, currentPhase, width, height, baseRadius, ownGrid, targetMask);
      setEvent(e);

      activeTimer = setTimeout(() => {
        commitSettledLayer(e);
        maybeFlipPhase();
      }, e.activeSec * 1000);

      nextTimer = setTimeout(fire, (e.activeSec + e.restSec) * 1000);
    };

    // Initial offset 0–restMax so different tiles don't all start in sync.
    nextTimer = setTimeout(fire, Math.random() * REST_MAX_SEC * 1000);
    return () => {
      if (activeTimer) clearTimeout(activeTimer);
      if (nextTimer) clearTimeout(nextTimer);
    };
  }, [enabled, baseRadius, width, height]);

  return { event, layers };
}
