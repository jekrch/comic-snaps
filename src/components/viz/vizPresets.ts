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
  /*
   * Temporarily withheld from the list. Kept whole, and in place, so they can be
   * put back by deleting these comment markers.
   *
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
  */
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
    id: "fractal",
    name: "Fractal",
    blurb: "Endless flight into a Julia set the panels themselves are bending.",
    overrides: {
      /*
       * The one mode here whose figure is not a symmetry of the frame but a set
       * in its own right: every pixel's orbit is followed under z -> z^2 + c, and
       * the page is read where that orbit passes closest to a ring. So the
       * filaments carry detail at every scale rather than at the four a fold
       * stops at, and what is *in* them is comic art rather than a colour ramp.
       *
       * Everything below is in service of two things the fold modes never had to
       * answer for. The figure is drawn at wildly different magnifications across
       * one frame, so the frame it is drawn from has to be simple, level and slow
       * or the detail is noise. And the walk — the seed crossing the Mandelbrot
       * cardioid — is not a motion of the picture but a *replacement* of it, one
       * set at a time, so it has to be the only schedule of consequence running.
       */
      /*
       * One, which is the whole stack, and the only preset here that runs the
       * flat path this way.
       *
       * It buys the vault's arrangement on a path that was not built for it: the
       * director spawns a replacement when the resident layer enters its fade,
       * so a page holds the frame alone for its whole dwell and the two fades
       * abut at the handover. That matters more here than anywhere else, because
       * the page is not what the frame is showing — it is what the figure is
       * *made of*, and two of them superimposed is a seed field driven by a
       * mixture of two comics, which is a figure shaped by neither.
       *
       * The dwell that falls out of the three numbers below is a little under a
       * minute of one page, which is the vault's pace.
       */
      layerCount: 1,
      layerLifetime: 76,
      // A fifth of the dwell at each end. Long, because a handover here is not a
      // change of what the figure is filled with — the page drives the seed, so
      // a new panel *bends the boundary* — and slow is what makes that read as
      // the fractal being reshaped rather than as a cut to a different one.
      crossfade: 0.45,
      // Some, but well under the default. There is only one slot, so a jitter
      // cannot pull two of them out of step here; all it does is keep the
      // handovers off a metronome.
      layerLifetimeJitter: 0.2,
      // Fine, where every other preset leaves this at seconds. Births quantise
      // to this grid, and with a single resident layer the wait between the
      // outgoing fade starting and its replacement being born is a dip in the
      // whole frame rather than in one of four layers. At half a second it is
      // three percent of the fade and gone.
      beat: 0.5,
      // Nearly still, and the strictest budget in the file. The fractal's own
      // magnification multiplies whatever the layer beneath is doing — a pan of a
      // few percent arrives in the deep filaments as a sweep — so the stack holds
      // almost still and every visible motion in this mode comes from the walk.
      zoomAmount: 1.12,
      panAmount: 0.03,
      rotateAmount: 0,
      // High, and higher than it could be with a stack: nothing is composited
      // over anything else here except during the handover, so the number that
      // would wash out four screened layers is simply how bright the page is.
      layerOpacity: 0.92,
      // The highest of the flat presets. The trap samples a small region of the
      // page and spreads it along a filament, so a bright patch is not a bright
      // patch here — it is a bright *thread*, repeated wherever the orbit passes
      // near it, and levelling the pages is the only thing that keeps the figure
      // from being read as a diagram of the brightest thing on screen.
      keyBalance: 0.9,
      tintAmount: 0.26,
      // Zero. The drift's fold channel is the kaleidoscope's — see `Wander` — so
      // it would lay a second symmetry over a figure that has its own.
      wander: 0,
      // Low, and lower than any other mode that has a subject. The walk is
      // already replacing the picture continuously; an effect swelling on top of
      // that is a second thing changing everything, which is what §6 rules out.
      // What is left through is punctuation — a fold or a mirror over the set for
      // a while — never a competing schedule.
      psychedelia: 0.18,
      cycleInterval: 26,
      post: {
        // High and standing. Also above the 0.8 the cycler's own julia pulse can
        // reach, which is deliberate: a pulse would re-seed the set mid-run, and
        // where a re-rolled fold is a new arrangement of the same picture, a
        // re-seeded Julia set is a different figure arriving in one step.
        julia: 0.85,
        /*
         * Deep, because this preset flies. The frame is a neighbourhood of the
         * fixed point rather than a view of the whole set — which is what the
         * seamless wrap is a statement about, and also the more interesting
         * picture: at this altitude the boundary is filigree across the frame
         * instead of a shape with the plane around it.
         *
         * Deeper than it needs to be for that, and the extra is bought for
         * nothing. The chart that makes the wrap invisible is a series about the
         * fixed point, so its error falls with the *cube* of the frame's radius:
         * halving this took the worst-case mismatch at a wrap from around two
         * percent of the frame to under a fifth of one — a couple of pixels.
         * What it costs is supposed to be a narrower view, except that the thing
         * being viewed is self-similar, so a frame half as wide around the same
         * point is the same picture. There is no third side to that trade.
         */
        juliaZoom: 0.05,
        // Out at the filigree end of the walk. Lower is a rounder set with a
        // large interior, and an interior is the one place orbits converge —
        // which on screen is a wide flat region the anchor then has to rescue.
        juliaShape: 0.88,
        // Forward, at six percent a second — the figure doubles about every
        // twelve. This is the mode's principal motion and everything else here
        // is budgeted under it.
        //
        // Set from the calm end of the speed control rather than the middle of
        // it: watched on the ladder, the rung worth staying on was the slowest,
        // so that rung is what the middle does now and what the ladder's reach
        // buys is speed rather than calm. Which is the §6 rule arriving where it
        // always does — a piece slowly becoming something else — by way of a
        // mode that had to be flown at to find out how slowly.
        juliaFlight: 0.06,
        // The walk, at about a tenth of the flight's rate rather than level with
        // it. Two schedules changing the figure at once is the thing §6 does
        // rule out — so the flight travels and the walk merely ages: a full
        // circuit takes a quarter of an hour, which reads as the country
        // changing rather than as a second motion.
        juliaSpin: 0.007,
        // A ring rather than a point. A point trap draws the page in a spray of
        // dots where orbits happen to pass the origin; opened to a ring, the trap
        // set is a curve, and a curve is what the filaments are drawn along.
        juliaTrap: 0.55,
        // Under 1, so each filament carries a region of the page rather than the
        // whole of it. That is what makes a filament read as being *made of*
        // something — the crop is coherent along its length instead of being a
        // whole page compressed into a hair.
        juliaSpread: 0.55,
        /*
         * The escape-time banding, and the answer to a flight that read as the
         * picture merely getting bigger.
         *
         * This is the only term in the map that is not affine anywhere. Its
         * contours wrap the set at every scale, the flight sweeps them outward
         * and replaces them from the middle, and each one carries a different
         * crop — so what passes the eye is layers of comic arriving out of the
         * centre rather than one image being enlarged.
         *
         * Held under what it could be, because it is also the steepest gradient
         * in the map: depth runs away at the boundary of the set, so a large
         * excursion here is a sampling rate no pixel can follow and the page
         * arrives averaged rather than drawn. Surveyed across the frame, a half
         * is about where a fifth of the picture is still being averaged away and
         * half of it is legible as artwork.
         */
        juliaDepth: 0.5,
        /*
         * Half, which is the number that decides how blurry this mode is
         * allowed to get, and it is worth being explicit about the direction.
         *
         * The anchor is a fraction of the plain frame added to the sampling
         * coordinate, so it is also the floor under the map's derivative — and
         * the largest enlargement anything can suffer is its reciprocal. At a
         * fifth that was five times, on a page the compositor has usually
         * already enlarged once, which is the soft over-blown patch. At a half
         * it is two, and a crop at two times is still a face or a balloon that
         * can be read as one. That legibility is the whole reason for the value:
         * it is what puts recognisable comic in the frame rather than an
         * ornament made out of comic.
         *
         * What it costs is travel. This is the one term that cannot move with
         * the flight — it would have to jump by a whole factor of lambda at the
         * wrap — so every part of it is frame that does not fly. The banding
         * carries the motion instead, and the mirror turns even this slowly.
         */
        juliaAnchor: 0.5,
        /*
         * Large, and it is the other half of the anchor's argument — the half the
         * anchor could not make on its own.
         *
         * The anchor decides how far the page may be enlarged. What it cannot
         * decide is whether any of it can be *read*, and that is a question about
         * regions rather than about pixels: the trap and the band rewrite the
         * crop by a tenth of the page across the width of a face, so every
         * sample was a true sample of the panel and no feature of the panel ever
         * survived. A fractal painted in a comic's colours, which is precisely
         * the wallpaper the bind exists to prevent, arriving by the other road.
         *
         * Flattened into facets this size — a sixth of the frame, so a handful
         * of them across it rather than a mosaic — each one is an affine crop at
         * twice its own size, which is a face or a balloon and unmistakably one.
         * The excursion between facets is untouched, so the figure still runs
         * through as much of the page as it did; it is only inside a facet that
         * the page now holds still long enough to be seen.
         *
         * Large rather than middling on the same reasoning as the panel scale
         * everywhere else in this file: a few big crops read as comic, a field
         * of small ones reads as texture, and texture is what this preset had.
         */
        juliaFacet: 0.85,
        /*
         * Getting on for a third of the frame, which is a lot, and it is the
         * number this preset was missing rather than a decoration on it.
         *
         * Everything else here works on the figure's own sampling and every bit
         * of it helps and none of it was enough. The reason is not the sampling.
         * It is that a crop at twice its size, folded into a wedge of a six-fold
         * mirror with a trail over it, is an ornament however coherent it is —
         * the mirror and the magnification *are* the mode, so there is no value
         * of anything above that gets a face through them intact.
         *
         * These stop trying. A third of the frame carries no figure at all; it
         * carries the frame's own coordinate, so what is inside them is the panel
         * where the panel is, the size it is, the way up it is. And because
         * every one of them carries the *same* coordinate they are not a scatter
         * of crops but a single image behind a fractal stencil — the eye joins
         * them up across the figure between them, which is the thing that makes
         * a run legible as a comic rather than as a texture derived from one.
         *
         * A third rather than a half because the plates have to read as windows
         * cut in a figure. Past about that the figure is what is left over.
         */
        juliaPlate: 0.32,
        /*
         * A third of a half-frame, which is as much as this can be without
         * costing the thing it is decorating.
         *
         * The flight descends onto one point and the frame was pinned to it, so
         * there was one still place on screen and it was the middle, forever.
         * Drifting the frame across the point leaves the descent exactly as it
         * was and moves only where it is happening — the vanishing point wanders,
         * the material being magnified is not the same material all run, and
         * under the six-fold mirror above it wanders in every wedge at once.
         *
         * Not further, because the two correction terms that make the flight's
         * wrap invisible are a series about the fixed point, and drift is radius
         * for that series to be wrong over. At a third the seam's mismatch is
         * still inside a pixel or two; at the top of the slider it is a smudge
         * once a minute.
         */
        juliaDrift: 0.34,
        /*
         * Square, nearly. The dynamics decide where the filaments *are*; this
         * decides what they are made of, because the trap set is the curve the
         * page is picked up along. Against the round norm every filament is an
         * arc and the picture reads as something poured; against the Chebyshev
         * norm the same orbits trap on straight sides meeting at corners.
         *
         * Not the whole way: at exactly 1 the corners of the trap square land
         * hard, and a little of the round norm left in is what keeps the joins
         * from ringing at the scale the mip chain cannot help with.
         */
        juliaEdge: 0.85,
        // High. This is what makes the panels the fractal's material rather than
        // its paint: the page's own shapes decide where along each orbit it is
        // picked up and which contour carries which crop, so a change of panel
        // redraws the figure. It is deliberately barred from the seed — see the
        // note in the shader — which is the one coupling that would have made the
        // flight unable to close.
        juliaBind: 0.75,
        /*
         * The mirror, and it is placed *before* the set rather than over it.
         *
         * Everything in the coordinate chain ahead of the fractal is inherited by
         * it, so folding here does not lay a kaleidoscope on top of a finished
         * picture — the set itself is drawn in folded coordinates and comes out
         * as six mirrored wedges of genuine fractal, seams and all. Which is also
         * what stops the figure living in one corner: the flight has a single
         * centre and the interesting side of the boundary is wherever it is, and
         * six-fold symmetry puts that side in every sector of the frame at once.
         *
         * Deep enough to read as a mirror rather than as a suggestion of one — a
         * partial fold is a smear, and a smear over a flowing map is exactly the
         * liquid this is here to firm up.
         */
        kaleido: 0.8,
        kaleidoSegments: 6,
        // Slow, and the only rotation in the mode. The flight travels straight
        // out of the centre, so this is what turns that into a spiral and walks
        // the energy round the frame — a turn every four minutes or so.
        kaleidoSpin: 0.026,
        // Modest, and pushed outward. The set is already a thicket of thin bright
        // lines, and a long trail over that fills the gaps between them with grey.
        feedbackAmount: 0.32,
        feedbackScale: 1.005,
        chroma: 0.26,
        // A little, where this preset had none. Between the bands and the fold
        // the frame now has edges in it, and flattening the tones inside each one
        // is what keeps them reading as edges rather than as a gradient that
        // happens to turn — which was the liquid look.
        posterize: 0.16,
        grain: 0.045,
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
  /*
   * Temporarily withheld, as above.
   *
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
  */
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
  /*
   * Temporarily withheld, as above.
   *
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
  */
  {
    id: "prism",
    name: "Prism",
    blurb: "A turning many-sided body, a different detail of one page on every face.",
    overrides: {
      stageKind: "prism",
      /**
       * How long one page owns every face of the body.
       *
       * The scene's slots are sequential, so unlike the quad scenes this number is
       * the real interval between changes rather than half of one — a little over a
       * minute of a page being turned around and read from every side. The handover
       * repaints the whole object, which is the largest event in the scene and
       * should therefore be the rarest.
       */
      layerLifetime: 74,
      /**
       * Short, and paired with the sequential residency the scene declares.
       *
       * A sixth of the dwell is twelve seconds of dissolve at each end of a tenancy,
       * with the outgoing fade abutting the incoming one so the two are exact
       * complements and the body's brightness never moves. For the minute between
       * them there is exactly one page on the object — which is the reason this is
       * not simply 1, and the same reason the vault's is not.
       */
      crossfade: 0.18,
      // Zero. The alternation only stays exact while both slots run the same
      // lifetime; any jitter and the fades stop abutting, which puts a notch in the
      // frame's brightness at every handover.
      layerLifetimeJitter: 0,
      tintAmount: 0.22,
      keyBalance: 0.8,
      stageScale: 1,
      // High, and affordable for the vault's reason: the body is drawn once per
      // pixel — only its near side, and only one page at a time — so there is never
      // more than one surface worth of light in the frame.
      stageOpacity: 0.68,
      // Held toward the gem. The drum is where it opens out to, not where it lives:
      // rounded off, the body loses its corners, and a body with no corners has no
      // faces for the crops to hand over at.
      stageMorph: 0.32,
      stageMorphRate: 0.0032,
      // Wide enough that the near face foreshortens visibly against the two beside
      // it. That difference is the whole of what says this is a solid.
      stageFov: 62,
      // Slow. This is the only thing that brings a new face round, so it is also
      // what decides how long you get to look at one — about four minutes for a
      // full revolution, or forty seconds a face.
      stageSpin: 0.026,
      stageFlight: 0,
      stageSolids: 0,
      // On top of the scene's own standing undulation, which is what keeps the body
      // from ever settling into the ideal solid it is heading toward.
      stageDisplace: 0.2,
      stageDisplaceRate: 0.11,
      psychedelia: 0.15,
      cycleInterval: 24,
      post: {
        // Low. The body fills the middle of the frame, so the trail is a copy of a
        // bright frame rather than of a mostly dark one, and the feedback path
        // accumulates with max().
        feedbackAmount: 0.24,
        feedbackScale: 1.004,
        // A six-fold fold against a six-sided body. The two agree, so the rosette
        // lands on the object's own symmetry rather than cutting across it.
        kaleido: 0.26,
        kaleidoSegments: 6,
        kaleidoSpin: 0.012,
        chroma: 0.24,
        grain: 0.05,
        vignette: 0.44,
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
    id: "drape",
    name: "Drape",
    blurb: "One page on a vast cloth, thrown into slow folds and curling past every edge.",
    overrides: {
      stageKind: "drape",
      // As long as the vault's, and for the same reason: the cloth is the frame,
      // there is nothing else in the picture to distract from it becoming a
      // different picture, so the change should be rare.
      layerLifetime: 82,
      crossfade: 0.2,
      layerLifetimeJitter: 0,
      tintAmount: 0.2,
      keyBalance: 0.8,
      stageScale: 1,
      // The highest in the engine. The cloth is full bleed and single-layered — one
      // page, one surface, no overlap anywhere — so the number that would wash out
      // a stack of quads is simply how bright the picture is here.
      stageOpacity: 0.74,
      // Held nearer the flat sheet. The deep curl is where it swings to; lived in,
      // it would put the viewer inside a tube of paper and lose the folds, which
      // are the subject.
      stageMorph: 0.3,
      stageMorphRate: 0.0028,
      // Wide. The folds only read as folds because the near crests foreshorten
      // hard against the far ones, and that is what field of view means.
      stageFov: 64,
      // Spent as a slow rock rather than a turn — see the note in the scene. A
      // plane rotated a quarter turn is edge-on, which is to say gone.
      stageSpin: 0.019,
      stageFlight: 0,
      stageSolids: 0,
      // On top of the scene's own standing folds. This is the knob that takes the
      // cloth from a sheet with a bow in it to one in a gale.
      stageDisplace: 0.3,
      // The one rate that matters here: how fast the folds travel across the cloth.
      // Slow enough to watch a crest cross the frame.
      stageDisplaceRate: 0.12,
      psychedelia: 0.18,
      cycleInterval: 22,
      post: {
        feedbackAmount: 0.2,
        feedbackScale: 1.005,
        chroma: 0.26,
        grain: 0.05,
        // Modest. The curl already darkens the edges of the frame by turning the
        // cloth away there; a strong vignette on top leaves the picture dim all
        // round its border.
        vignette: 0.4,
      },
    },
  },
  {
    id: "band",
    name: "Band",
    blurb: "A broad strip of comic wound on a trefoil knot, rolling as it travels.",
    overrides: {
      stageKind: "band",
      layerLifetime: 68,
      crossfade: 0.22,
      layerLifetimeJitter: 0,
      tintAmount: 0.26,
      keyBalance: 0.78,
      stageScale: 1,
      // Lower than the closed bodies', and the difference is the knot: a trefoil
      // crosses itself, so wherever the band passes in front of its own far side
      // the frame carries two thicknesses of it rather than one.
      // The lowest of the spatial presets, and the reason is the figure: a
      // trefoil crosses itself, and a strip this wide crosses itself several
      // passes deep wherever it does — so a pixel in the middle of the knot is
      // carrying three or four thicknesses of additive comic where every other
      // scene here carries exactly one.
      stageOpacity: 0.32,
      // Centred, so the strip runs the full distance in both directions — a ribbon
      // threading the figure at one end and a folded sheet of comic at the other.
      // This is the one preset whose morph is a change of *width*.
      stageMorph: 0.5,
      stageMorphRate: 0.003,
      stageFov: 60,
      // Slow, as everywhere on this path: a stretch of the band is a page and a
      // half of comic, and hurrying it past defeats the width it was given.
      stageSpin: 0.022,
      stageFlight: 0,
      // One, as the core the strip winds around — it occupies the middle of the
      // knot, which is the one part of the frame the band itself never reaches.
      stageSolids: 1,
      stageDisplace: 0.25,
      stageDisplaceRate: 0.16,
      psychedelia: 0.18,
      cycleInterval: 22,
      post: {
        // The heaviest of the four, and it is answering the one thing a knot
        // cannot fix about itself: a band is an open figure, so however wide the
        // strip gets there is space between its passes and space in the corners
        // of the frame. A long trail and a six-fold mirror put the figure's own
        // content in both, which is cheaper and better than winding the knot
        // tighter until it is a lumpy donut.
        feedbackAmount: 0.28,
        feedbackScale: 1.005,
        kaleido: 0.24,
        kaleidoSegments: 6,
        kaleidoSpin: 0.01,
        chroma: 0.28,
        grain: 0.05,
        vignette: 0.44,
      },
    },
  },
  {
    id: "shatter",
    name: "Shatter",
    blurb: "A globe of one page that opens along its seams, throws off shards, and closes.",
    overrides: {
      stageKind: "shatter",
      // Long enough that a page survives a full break and reassembly rather than
      // being replaced mid-flight, which is the one thing that would break the
      // reading that the shards and the body were ever one picture.
      layerLifetime: 76,
      crossfade: 0.2,
      layerLifetimeJitter: 0,
      tintAmount: 0.3,
      keyBalance: 0.82,
      stageScale: 1,
      // Under the sealed bodies' by a margin, because this one is not only a body:
      // at the open end of the morph there are four large shards adding over it,
      // and the shards are brightest exactly where they cross the globe.
      stageOpacity: 0.58,
      // Centred, so the break runs the full distance in both directions. This is
      // the one formation whose two ends are a *statement* — the page sealed and
      // the page in pieces — rather than two shapes.
      stageMorph: 0.5,
      stageMorphRate: 0.0026,
      // Part way. A shard has a legible face, so seeing it at an angle is
      // information rather than loss.
      stageBillboard: 0.55,
      stageBreathe: 0.1,
      stageFov: 66,
      stageSpin: 0.02,
      stageFlight: 0,
      stageSolids: 0,
      // The current the loose shards ride, on top of the scene's own standing one.
      stageSwirl: 0.2,
      stageDisplaceRate: 0.1,
      psychedelia: 0.25,
      cycleInterval: 20,
      post: {
        feedbackAmount: 0.34,
        feedbackScale: 1.006,
        chroma: 0.3,
        // Being energy-normalised, the bloom costs a highlight what it spreads
        // around it rather than adding to the frame — so it survives a scene whose
        // subject fills the middle of the picture, where anything that merely added
        // light would not.
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
