import { DEFAULT_CONFIG, cloneConfig, prefersReducedMotion } from "./vizConfig";
import type { VizConfig } from "./vizConfig";
import type { PostParams } from "./engine/types";

type PresetOverrides = Partial<Omit<VizConfig, "post" | "weights">> & {
  post?: Partial<PostParams>;
  weights?: Partial<VizConfig["weights"]>;
};

export interface VizPreset {
  id: string;
  name: string;
  /** One line, shown under the name in the launch modal. */
  blurb: string;
  overrides: PresetOverrides;
}

/**
 * Each preset is a region of the same parameter space, not a separate code
 * path — which is why they can be described as overrides and why a pasted
 * config can start from any of them.
 */
export const VIZ_PRESETS: VizPreset[] = [
  {
    id: "dissolve",
    name: "Dissolve",
    blurb: "Two slow layers, no feedback, no rotation, and reduced motion.",
    overrides: {
      layerCount: 2,
      layerLifetime: 44,
      crossfade: 0.5,
      zoomAmount: 1.06,
      panAmount: 0.04,
      rotateAmount: 0,
      layerOpacity: 0.75,
      beat: 4,
      post: {
        feedbackAmount: 0,
        chroma: 0,
        grain: 0.03,
      },
    },
  },
  {
    id: "zoink",
    name: "Zoink",
    blurb: "Everything cycles: fractal folds, tunnels, prismatic warp and solarised colour.",
    overrides: {
      layerCount: 4,
      layerLifetime: 20,
      crossfade: 0.45,
      zoomAmount: 1.35,
      rotateAmount: 0.08,
      // Four screen-blended layers over a wall of light comic pages pile up
      // toward white, so each one carries less than the default.
      layerOpacity: 0.72,
      tintAmount: 0.3,
      psychedelia: 0.9,
      // Longer again, on the same reasoning as the last two times: the pool has
      // grown by half with the print and field groups, and several of the new
      // entries take the longest ramps in it. At the old spacing most onsets
      // would find every slot full and be dropped, which spends the variety
      // without showing any of it.
      cycleInterval: 16,
      post: {
        feedbackAmount: 0.42,
        chroma: 0.4,
        // Standing dispersion. It refracts what is already bending and does
        // nothing at all otherwise, so it costs nothing at rest and means every
        // warp the cycler brings in arrives through glass rather than needing a
        // pulse of its own to be worth looking at.
        disperse: 0.18,
        solarize: 0.12,
        grain: 0.06,
        vignette: 0.42,
      },
    },
  },
  {
    id: "drift",
    name: "Drift",
    blurb: "Four full-bleed layers on long crossfades. Minimal processing.",
    overrides: {},
  },
  {
    id: "newsprint",
    name: "Newsprint",
    blurb: "Rotated CMY dot screen over a flattened palette.",
    overrides: {
      layerCount: 3,
      layerLifetime: 22,
      tintAmount: 0.1,
      post: {
        feedbackAmount: 0.12,
        halftone: 0.85,
        halftoneScale: 1.1,
        posterize: 0.55,
        chroma: 0.05,
        grain: 0.1,
        vignette: 0.28,
      },
    },
  },
  {
    id: "long-exposure",
    name: "Long Exposure",
    blurb: "Frame feedback dominates: layers smear into trails rather than cut.",
    overrides: {
      layerCount: 3,
      layerLifetime: 34,
      crossfade: 0.55,
      zoomAmount: 1.5,
      panAmount: 0.2,
      post: {
        feedbackAmount: 0.82,
        feedbackScale: 1.012,
        feedbackRotate: 0.002,
        chroma: 0.25,
        vignette: 0.45,
      },
    },
  },
  {
    id: "interference",
    name: "Interference",
    blurb: "Clashing pairs out of a mostly random draw, on subtractive blends with hue drift.",
    overrides: {
      layerCount: 5,
      layerLifetime: 18,
      crossfade: 0.35,
      rotateAmount: 0.09,
      tintAmount: 0.35,
      // Random-dominant like everything else; the tilt that is left over is what
      // still makes this the clash mode rather than the base weights.
      weights: { rhyme: 0.05, clash: 0.25, color: 0.1, random: 0.6 },
      post: {
        feedbackAmount: 0.35,
        chroma: 0.55,
        posterize: 0.2,
        grain: 0.07,
      },
    },
  },
  {
    id: "kaleidoscope",
    name: "Kaleidoscope",
    blurb: "Panels folded into rotating radial symmetry, the fold count drifting.",
    overrides: {
      layerCount: 3,
      layerLifetime: 30,
      crossfade: 0.5,
      zoomAmount: 1.35,
      panAmount: 0.1,
      rotateAmount: 0.12,
      tintAmount: 0.3,
      psychedelia: 0.4,
      cycleInterval: 20,
      post: {
        kaleido: 0.88,
        kaleidoSegments: 6,
        feedbackAmount: 0.5,
        feedbackScale: 1.004,
        chroma: 0.3,
        posterize: 0.25,
        vignette: 0.4,
      },
    },
  },
  {
    id: "tumbler",
    name: "Tumbler",
    blurb: "The same fold, never twice the same: wedge count, tiling, spin and drift all wander.",
    overrides: {
      layerCount: 3,
      layerLifetime: 26,
      crossfade: 0.5,
      zoomAmount: 1.42,
      panAmount: 0.13,
      rotateAmount: 0.1,
      // Three screen-blended layers folded on top of themselves pile up toward
      // white faster than an unfolded stack does — the fold is a copy.
      layerOpacity: 0.76,
      tintAmount: 0.32,
      // The drift is what carries this mode, so the cycler is turned down to
      // occasional punctuation rather than a second thing changing everything —
      // two schedules moving the frame at once is what reads as jerky.
      psychedelia: 0.22,
      cycleInterval: 26,
      wander: 0.85,
      wanderRate: 1,
      post: {
        kaleido: 0.9,
        kaleidoSegments: 6,
        feedbackAmount: 0.48,
        feedbackScale: 1.005,
        chroma: 0.3,
        posterize: 0.2,
        grain: 0.05,
        vignette: 0.42,
      },
    },
  },
  {
    id: "undertow",
    name: "Undertow",
    blurb: "A liquid domain warp with concentric ripples — the frame never sits still.",
    overrides: {
      layerCount: 3,
      layerLifetime: 34,
      crossfade: 0.55,
      zoomAmount: 1.2,
      panAmount: 0.1,
      rotateAmount: 0.03,
      psychedelia: 0.45,
      cycleInterval: 16,
      post: {
        warp: 0.65,
        warpScale: 2.4,
        warpSpeed: 0.3,
        ripple: 0.4,
        rippleFreq: 16,
        feedbackAmount: 0.5,
        feedbackScale: 1.008,
        chroma: 0.35,
        vignette: 0.4,
      },
    },
  },
  {
    id: "press",
    name: "Press",
    blurb: "A misfed press: plates off register, screens beating into rosettes, ink into newsprint.",
    overrides: {
      layerCount: 3,
      layerLifetime: 24,
      crossfade: 0.45,
      zoomAmount: 1.18,
      panAmount: 0.08,
      rotateAmount: 0.03,
      tintAmount: 0.12,
      keyBalance: 0.8,
      // The cycler can run warm here in a way it cannot on the geometric modes.
      // Everything the print group pulls in is a property of the press rather
      // than a motion of the frame, so none of it is a second schedule moving the
      // picture against the first — which is the constraint that keeps psychedelia
      // down everywhere else.
      psychedelia: 0.5,
      cycleInterval: 15,
      post: {
        halftone: 0.8,
        halftoneScale: 1.05,
        // Standing values, all four of them, because none of these is legible as
        // a pulse: a plate drifting off register is a state the press is in, and
        // the cycler's job here is to deepen it rather than to introduce it.
        moire: 0.5,
        moireSpread: 0.07,
        benday: 0.45,
        misreg: 0.55,
        misregSpread: 0.005,
        bleed: 0.4,
        bleedRadius: 1.8,
        paper: 0.55,
        posterize: 0.45,
        // Very low. Newsprint does not have an afterimage, and a trail on top of
        // a dot screen smears the screen into a grey that undoes all of the above.
        feedbackAmount: 0.1,
        chroma: 0.04,
        grain: 0.06,
        vignette: 0.3,
      },
    },
  },
  {
    id: "emulsion",
    name: "Emulsion",
    blurb: "Ink in water, with a reaction spreading through it and the highlights bleeding.",
    overrides: {
      layerCount: 3,
      layerLifetime: 32,
      crossfade: 0.55,
      zoomAmount: 1.15,
      panAmount: 0.09,
      rotateAmount: 0.02,
      tintAmount: 0.28,
      // The drift is deliberately *off* despite the flow field reading its
      // heading. Turning it on would also bring the fold up — that is what the
      // channel does — and this mode is not a kaleidoscope. So the current comes
      // from the director's fallback curve instead, which is slower than the
      // drift's own heading and suits a field that takes half a minute to build.
      wander: 0,
      psychedelia: 0.3,
      cycleInterval: 20,
      post: {
        flow: 0.5,
        flowScale: 2.4,
        flowDecay: 0.975,
        react: 0.4,
        reactFeed: 0.037,
        reactKill: 0.062,
        reactScale: 1.7,
        bloom: 0.35,
        bloomThreshold: 0.66,
        bloomRadius: 0.026,
        // Standing dispersion, on the same reasoning as zoink's: both fields are
        // smooth displacements, so both of them refract.
        disperse: 0.14,
        feedbackAmount: 0.44,
        feedbackScale: 1.005,
        chroma: 0.3,
        grain: 0.045,
        vignette: 0.42,
      },
    },
  },
  {
    id: "chronoscope",
    name: "Chronoscope",
    blurb: "The frame as a solid of time — every band of it read from a different moment.",
    overrides: {
      layerCount: 3,
      layerLifetime: 28,
      crossfade: 0.5,
      zoomAmount: 1.3,
      panAmount: 0.12,
      rotateAmount: 0.04,
      layerOpacity: 0.8,
      tintAmount: 0.25,
      // Low. The frame is already showing several seconds of itself at once, and
      // a cycled effect swelling across that is legible in every band at a
      // different moment — which reads as several effects rather than one.
      psychedelia: 0.35,
      cycleInterval: 18,
      post: {
        // Held under where it could go, because the ring is fed from the finished
        // frame and therefore from the slit-scan's own output. A band reading ten
        // slices back reads a frame whose own bands were reading ten slices back
        // from *there*, so the apparent age compounds well past what slitDepth
        // asks for. That compounding is the effect and it is stable — every
        // generation still takes a third of itself fresh — but at higher standing
        // values the far end of the ramp is much older, and much more smeared,
        // than the setting reads as. The cycler is free to push past this
        // transiently; a preset should not sit there.
        slit: 0.55,
        slitAxis: 0.35,
        slitLuma: 0.25,
        slitDepth: 0.55,
        // The corridor rather than the spiral. With the picture already reading
        // itself out of the past, a trail that recedes and is gone would be the
        // one part of the frame with no depth in time.
        feedbackAmount: 0.5,
        feedbackScale: 1.008,
        feedbackDroste: 0.6,
        drostePeriod: 1.6,
        drosteInner: 0.07,
        chroma: 0.28,
        grain: 0.05,
        vignette: 0.45,
      },
    },
  },
  {
    id: "swarm",
    name: "Swarm",
    blurb: "A few large pages on a spiral that folds into a shell and back.",
    overrides: {
      stageKind: "swarm",
      /**
       * The dwell a slot holds its panel for. Long, and long on purpose.
       *
       * This was briefly shortened on the theory that with only two panels resident
       * the turnover was the only thing showing the gallery, so it had to work
       * harder. Wrong trade: a page in a formation this sparse is the *subject*
       * rather than one contributor to a texture, and replacing the subject is the
       * loudest thing that happens in the scene. With two slots the swap comes round
       * every half a dwell, so this is one page changing somewhere every twenty-odd
       * seconds — and the turn, the fold and the crossfade are all still running
       * underneath it, which is plenty of change without it.
       */
      layerLifetime: 60,
      // Full, and paired with no jitter — the two slots are then exact
      // complements and their opacities sum to a constant, so the frame's total
      // light does not swing as they trade places. Worth having wherever a scene
      // runs on two slots: see the long note in the vault preset for why the sum
      // works out, and `Stage.refill` for the phase discipline that keeps it.
      crossfade: 1,
      layerLifetimeJitter: 0,
      tintAmount: 0.2,
      keyBalance: 0.8,
      // Slow. This and the spin are the scene's whole clock, and both are set to
      // let a page be looked at rather than glimpsed.
      stageMorphRate: 0.0035,
      stageScale: 1,
      // Additive, and the single most important number in the preset: it is what
      // stands between the formation and the washout that bd1d4c5 went in to
      // prevent. What it has to be read against has changed, though. The old
      // crowd stacked a few hundred small quads into five-ish layers of fill over
      // most of the frame; six large ones stack two or three deep in the middle
      // and leave the corners dark, so the same setting now buys a *dimmer* frame
      // rather than a hotter one, and it is set up accordingly.
      stageOpacity: 0.55,
      stageMorph: 0.5,
      // Part way. Fully billboarded, four large quads are four rectangles squarely
      // facing the lens; at this value they lean, and the lean is the depth.
      stageBillboard: 0.4,
      /**
       * Under half what it was: a shade under five minutes for one revolution.
       *
       * The turn is the only reason a page ever leaves the frame, so it is also the
       * thing that decides how long you get to look at one. With a formation of a
       * few large pages there is a great deal to read in each, and the rate that
       * suited a boiling crowd of small crops is far too quick for it — the whole
       * point of the sparse formation is defeated if the pages are hurried past.
       */
      stageSpin: 0.022,
      stageFlight: 0,
      stageSolids: 0,
      // The formation is already the slowest thing in the engine; a cycler
      // pulsing the post chain over the top of it would be the second schedule
      // §6 rules out.
      psychedelia: 0.15,
      cycleInterval: 24,
      post: {
        // Low. The trail is a copy of a frame that is mostly dark with a few
        // bright quads in it, and at the usual retention those quads smear into a
        // haze that fills the dark back in.
        feedbackAmount: 0.28,
        feedbackScale: 1.004,
        // A six-fold fold, which a sparse formation can carry and a dense one
        // could not: mirroring a crowd produces a symmetrical crowd, where
        // mirroring three pages in depth produces a rosette with the parallax
        // still legible inside each wedge.
        kaleido: 0.3,
        kaleidoSegments: 6,
        kaleidoSpin: 0.015,
        chroma: 0.22,
        grain: 0.05,
        vignette: 0.45,
      },
    },
  },
  {
    id: "vault",
    name: "Vault",
    blurb: "Endless flight down a tube papered with one comic page.",
    overrides: {
      stageKind: "vault",
      /**
       * How long one page owns the entire corridor. The longest dwell in the engine.
       *
       * The handover is the largest single event in the scene — the wall *is* the
       * frame, and there is nothing else in it to distract from a wall becoming a
       * different wall — so it should be rare. The scene's slots are sequential, so
       * unlike everywhere else this number is the real interval: a change a little
       * over a minute apart, not one every half-dwell.
       */
      layerLifetime: 80,
      /**
       * Short, and paired with the sequential residency the scene declares.
       *
       * A fifth of the dwell is eight seconds of dissolve at each end of a tenancy,
       * and the stage abuts the outgoing fade against the incoming one — so the two
       * are exact complements for those eight seconds and the wall's brightness
       * never moves, while for the sixty-odd seconds between them there is exactly
       * one page on the tube. That last part is the reason this is not simply 1:
       * two slots crossfading over a *whole* dwell is a corridor permanently
       * papered with two superimposed comic pages, which is not a wallpaper made of
       * one image at all.
       */
      crossfade: 0.2,
      // Zero. The alternation only stays exact while both slots run the same
      // lifetime — any jitter and the fades stop abutting, which puts a notch or a
      // bump in the wall's brightness at every handover.
      layerLifetimeJitter: 0,
      tintAmount: 0.22,
      keyBalance: 0.78,
      // Scales the tube's radius here rather than a quad's size — a wider corridor
      // rather than bigger pages, since the page is already the corridor.
      stageScale: 1,
      // The highest in the engine, and affordable because of the handover above:
      // there is only ever one wall's worth of light in the frame.
      stageOpacity: 0.72,
      // Held nearer the straight corridor. The barrel is where it opens out to,
      // not where it lives — a tube that spends half its time as a cavern stops
      // reading as a tube at all.
      stageMorph: 0.3,
      stageMorphRate: 0.003,
      // Wide. The tunnel's whole effect is in how fast the wall foreshortens, and
      // that is what field of view means.
      stageFov: 74,
      // Spent as a helical twist of the wallpaper rather than a roll of the
      // corridor — see the note in the scene. Slow: the twist is the only thing
      // turning here, and a corridor that spirals briskly is a corridor nobody can
      // read the walls of.
      stageSpin: 0.018,
      // Travel along the tube, in world units per clock second. A page is about
      // eleven units tall on this wall, so this is one passing every fourteen
      // seconds — flight, but at a pace that lets the wall be looked at rather
      // than merely registered as moving.
      stageFlight: 0.8,
      // The corridor breathes: the only motion here that moves geometry rather
      // than texture, and it moves the wall sideways past the eye, never at it.
      stageDisplace: 0.5,
      stageDisplaceRate: 0.1,
      // Nothing to place them in. The scene declares no solid panels — a solid in
      // the middle distance is something the flight closes on, and this corridor is
      // built so that nothing ever arrives.
      stageSolids: 0,
      psychedelia: 0.2,
      cycleInterval: 22,
      post: {
        // Lower than the quad scenes'. The wall fills the frame, so the trail is a
        // copy of a bright frame rather than of a mostly dark one, and the feedback
        // path accumulates with max().
        feedbackAmount: 0.22,
        feedbackScale: 1.006,
        chroma: 0.3,
        grain: 0.05,
        // Modest, and lower than the quad scenes'. The tube's own grazing falloff
        // is already darkening the middle of the frame; a strong vignette darkens
        // the outside as well and leaves the whole picture flat and dim.
        vignette: 0.42,
      },
    },
  },
  {
    id: "sheets",
    name: "Sheets",
    blurb: "Three leaning planes of pages, swelling until they pass through one another.",
    overrides: {
      stageKind: "sheet",
      // Three slots rather than two, so a change comes round every *third* of a
      // dwell — which is why this is the longest dwell of the quad scenes and still
      // has the shortest interval between swaps. Twenty-six seconds or so.
      layerLifetime: 78,
      // Full, and paired with no jitter — the two slots are then exact
      // complements and their opacities sum to a constant, so the frame's total
      // light does not swing as they trade places. Worth having wherever a scene
      // runs on two slots: see the long note in the vault preset for why the sum
      // works out, and `Stage.refill` for the phase discipline that keeps it.
      crossfade: 1,
      layerLifetimeJitter: 0,
      tintAmount: 0.2,
      keyBalance: 0.8,
      stageScale: 1,
      // The lowest in the engine, and it has to be: on every other formation the
      // quads have dark between them, where here they meet to make a surface and
      // three of those surfaces stack — three full-bleed layers of additive load
      // in the middle of the frame, and more wherever two of them cross.
      stageOpacity: 0.42,
      // Held near the flat stack. The shells are where it opens out to, not where
      // it lives — rolled up, the sheets stop being able to intersect, which is
      // the whole reason for the arrangement.
      stageMorph: 0.25,
      stageMorphRate: 0.003,
      // Flat on the plane. A quad turned to face the camera has left the surface
      // it was part of, and a sheet whose quads have all left it is not a sheet.
      stageBillboard: 0,
      stageFov: 58,
      // Very slow, and the slowest in the engine on purpose: the moment worth
      // waiting for here is the stack swinging edge-on, and it comes round twice a
      // revolution whatever the rate. Better to arrive at it rarely and be able to
      // watch it than to be swept through it.
      stageSpin: 0.014,
      stageFlight: 0,
      stageSolids: 0,
      // On top of the scene's own standing displacement, which is what drives the
      // sheets through each other in the first place.
      stageDisplace: 0.15,
      stageDisplaceRate: 0.14,
      psychedelia: 0.15,
      cycleInterval: 24,
      post: {
        feedbackAmount: 0.26,
        feedbackScale: 1.004,
        chroma: 0.24,
        grain: 0.05,
        vignette: 0.46,
      },
    },
  },
  {
    id: "ribbons",
    name: "Ribbons",
    blurb: "Two wide bands of pages braided along a Lissajous figure, winding into a knot.",
    overrides: {
      stageKind: "ribbons",
      // The band alternates between its two panels along its own length, so a swap
      // repaints every other segment of it — a large event, and a rare one.
      layerLifetime: 64,
      // Complementary, as in the swarm: two slots, no jitter, constant total.
      crossfade: 1,
      layerLifetimeJitter: 0,
      tintAmount: 0.26,
      keyBalance: 0.78,
      stageScale: 1,
      // The bands overlap themselves along the curve by design, so a pixel in the
      // middle of one is already two quads deep before the other band crosses it.
      stageOpacity: 0.5,
      stageMorph: 0.4,
      stageMorphRate: 0.0032,
      // The scene caps this anyway; set low here so the tuning panel reads the
      // value the formation is actually using rather than one it is clamping.
      stageBillboard: 0.12,
      stageBreathe: 0.05,
      stageFov: 52,
      // Slow, as everywhere else on this path — the band's own travel through the
      // figure is already motion, and the turn on top of it was too much.
      stageSpin: 0.02,
      stageFlight: 0,
      stageSolids: 1,
      stageDisplaceRate: 0.2,
      psychedelia: 0.18,
      cycleInterval: 22,
      post: {
        feedbackAmount: 0.34,
        feedbackScale: 1.005,
        chroma: 0.28,
        grain: 0.05,
        vignette: 0.44,
      },
    },
  },
  {
    id: "motes",
    name: "Motes",
    blurb: "A page torn into a few large shards, stirred apart on a current and back together.",
    overrides: {
      stageKind: "motes",
      // Long enough that a page survives a full dispersal and reassembly rather
      // than being replaced mid-flight, which is the one thing that would break the
      // reading that these shards were ever one picture.
      layerLifetime: 70,
      // Complementary, as in the swarm: two slots, no jitter, constant total.
      crossfade: 1,
      layerLifetimeJitter: 0,
      tintAmount: 0.3,
      keyBalance: 0.82,
      stageScale: 1,
      // High, but no longer the highest: nine shards leave a lot of dark between
      // them once dispersed, and they overlap most when the slab is assembled —
      // which is exactly when the frame has the least dark left to absorb it. So
      // the setting is governed by one end of the morph and looks generous at the
      // other, which is the right way round for an additive path.
      stageOpacity: 0.6,
      // Centred, so the dissolve runs the full distance in both directions. This
      // is the one formation whose two arrangements are a *statement* — the art
      // assembled and the art dispersed — rather than two shapes.
      stageMorph: 0.5,
      stageMorphRate: 0.0028,
      // Part way, where it used to be pinned at 1. A shard has a legible face, so
      // seeing it at an angle is information rather than loss.
      stageBillboard: 0.6,
      stageBreathe: 0.12,
      stageFov: 62,
      stageSpin: 0.018,
      stageFlight: 0,
      stageSolids: 0,
      stageSwirl: 0.25,
      stageDisplaceRate: 0.1,
      psychedelia: 0.25,
      cycleInterval: 20,
      post: {
        feedbackAmount: 0.4,
        feedbackScale: 1.006,
        chroma: 0.3,
        // Being energy-normalised, the bloom costs a highlight what it spreads
        // around it rather than adding to the frame — so it survives the shards
        // being large, where anything that merely added light would not.
        bloom: 0.2,
        bloomThreshold: 0.66,
        grain: 0.05,
        vignette: 0.42,
      },
    },
  },
];

/** Dissolve leads the list and is what an unqualified launch runs. */
export const DEFAULT_PRESET_ID = "dissolve";

export function findPreset(id: string | null | undefined): VizPreset {
  return VIZ_PRESETS.find((preset) => preset.id === id) ?? VIZ_PRESETS[0];
}

export function presetConfig(id: string | null | undefined): VizConfig {
  const base = cloneConfig(DEFAULT_CONFIG);
  const { post, weights, ...rest } = findPreset(id).overrides;
  return {
    ...base,
    ...rest,
    post: { ...base.post, ...post },
    weights: { ...base.weights, ...weights },
  };
}

/**
 * Dissolve is now the default for everyone, and it is also the calm option, so
 * a reduced-motion preference is already satisfied. Pinned explicitly anyway:
 * if DEFAULT_PRESET_ID is ever pointed at something livelier, that must not
 * quietly become the reduced-motion default too (§7).
 */
export function initialPresetId(): string {
  return prefersReducedMotion() ? "dissolve" : DEFAULT_PRESET_ID;
}
