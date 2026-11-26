import { useState } from "react";
import { CodeBlock, Layer, Section } from "../explainerPrimitives";
import { BitsGuess } from "../Guess";
import { Term } from "../../guide/Term";
import { PHASH_CODE } from "../code/snippets";
import { bitDistance, exampleLabel } from "../phashExamples";
import {
  BitsFigure,
  DistanceRanges,
  ExampleFigure,
  GridFigure,
  HammingFigure,
  LumaFigure,
  PairFigure,
  PatternFigure,
  usePhashExamples,
} from "../PhashFigures";

/**
 * The pHash lesson. pHash is the Guide's special case: a duplicate
 * detector, not a ranking. It says little about how two different panels
 * relate (they all land near 32 bits), so rather than the Guide's anchor
 * and neighbours, it follows one panel photographed and then restored,
 * which is the job pHash is built for: recognising the same picture again.
 * The page opts out of the anchor strip (`ownExample` in lessons.ts).
 *
 * Each step holds both of its versions as layers, Essentials first, so one
 * picked example holds at every depth.
 */
export function PhashExplanation() {
  const data = usePhashExamples();
  const [index, setIndex] = useState(0);
  const figure = (render: Parameters<typeof ExampleFigure>[0]["children"]) => (
    <ExampleFigure data={data} index={index} onPick={setIndex}>
      {render}
    </ExampleFigure>
  );
  const example = data?.examples[Math.min(index, data.examples.length - 1)];
  const stats = data?.stats;
  const pair = example ? bitDistance(example.before.bits, example.after.bits) : null;

  return (
    <>
      <Section step="pair">
        <Layer>
          <p>
            A <Term id="phash">perceptual hash</Term> is a fingerprint of how a picture looks at a glance. The gallery
            uses it for one job: catching duplicates and near-duplicates. To test it, here's one panel photographed
            and then restored. Anyone would call these the same picture, and the steps
            below check whether pHash does too.
          </p>
          {figure((e) => (
            <PairFigure example={e} />
          ))}
        </Layer>
        <Layer>
          <p>
            A <Term id="phash" first>perceptual hash</Term> is a fingerprint of
            what a picture looks like at a glance. Two copies of the same picture
            should get the same fingerprint, or nearly, even after one has been
            resized, recompressed or brightened.
          </p>
          <p>
            That makes pHash a different kind of tool from the other methods in
            this guide. They rank panels by how alike they are; pHash only
            answers whether two images are the same picture. The gallery uses
            it to catch duplicates and near-duplicates, such as a panel posted
            twice.
          </p>
          <p>
            The gallery's restorations make a good test. Each example below is
            one panel twice: the phone photo as first posted, and the restored
            image that replaced it. The restoration evened out the lamp, lifted
            the paper and seated the ink at black. Both examples were also
            cropped tighter and straightened along the way. The dashed outline shows where the
            restored frame sits in the photo.
          </p>
          {figure((e) => (
            <PairFigure example={e} />
          ))}
          <p>
            Anyone would call these the same panel. The rest of this lesson
            follows both images through pHash, one step at a time, to see
            whether it agrees.
          </p>
        </Layer>
      </Section>

      <Section step="luma" code={PHASH_CODE.hash}>
        <Layer>
          <p>
            First it throws away color, keeping only each pixel's <Term id="luminance">brightness</Term>.
          </p>
        </Layer>
        <Layer>
          <p>
            pHash ignores color. Its first step reduces every pixel to its{" "}
            <Term id="luminance" first>luma</Term>, a single brightness
            number from 0 (black) to 255 (white), by weighting the red, green
            and blue values and adding them up. (It's often called luminance,
            though strictly luminance is the same kind of sum taken on linear
            light, before a file's brightness curve is applied.)
          </p>
          <CodeBlock>{`L = 0.299 × R  +  0.587 × G  +  0.114 × B`}</CodeBlock>
          <p>
            Green counts most and blue least, roughly in line with how bright
            each looks to the eye. These are the weights Pillow's{" "}
            <code className="guide-mono">convert("L")</code> uses, which is
            what the gallery's hashing code calls.
          </p>
          {figure((e) => (
            <LumaFigure example={e} />
          ))}
          <p>
            Drag the slider to trade color for brightness, and point at either
            image to watch the sum worked out for one spot. Hue drops out
            entirely here, so a color cast only matters as far as it made
            things lighter or darker. The restoration's other changes, whiter
            paper, blacker ink and the new crop, all come through.
          </p>
        </Layer>
      </Section>

      <Section step="shrink" code={PHASH_CODE.hash}>
        <Layer>
          <p>Then it shrinks the picture to a 32 × 32 square, so fine detail can't matter.</p>
        </Layer>
        <Layer>
          <p>
            Next the brightness image is resized to 32 × 32 pixels, whatever its
            shape. That keeps 1,024 numbers out of the photo's hundreds of
            thousands of pixels and squashes the panel into a square. Resizing and recompression mostly
            disturb fine detail, so throwing it away is deliberate.
          </p>
          {figure((e) => (
            <GridFigure example={e} />
          ))}
          <p>
            The third square shows how far each pixel moved between the two.
            Relighting shifts whole areas lighter or darker together. The crop
            does something else: the tighter frame is stretched to fill the
            same square, so every edge in it lands a little further from the
            middle, and the difference picks out outlines all over the grid.
          </p>
        </Layer>
      </Section>

      <Section step="patterns">
        <Layer>
          <p>
            It describes that square as a mix of 64 broad light-and-dark patterns (a <Term id="dct">DCT</Term>): where
            the big masses of light and dark sit.
          </p>
        </Layer>
        <Layer>
          <p>
            Then comes a <Term id="dct" first>discrete cosine transform</Term>{" "}
            (DCT). It rewrites the 32 × 32 grid as a mix of 1,024 striped
            patterns, from a flat field to a fine checkerboard, with one number
            for how much of each the image contains. pHash keeps only the 64
            smoothest, the top-left 8 × 8 corner, shown on the left below.
          </p>
          <p>
            The top-left pattern is flat, so its number is the overall
            brightness. Moving right, the stripes stand upright and get closer
            together; moving down, they lie flat. Together these 64 describe the
            picture's broad layout: where the big light and dark masses sit.
          </p>
          {figure((e) => (
            <PatternFigure example={e} />
          ))}
          <p>
            A big orange number means the image looks like that pattern; a big
            blue one means it looks like the pattern with light and dark
            swapped. The lamp's falloff, a smooth darkening toward one side, is
            itself one of these broad patterns, so evening it out is one of the
            few lighting fixes that pHash does notice.
          </p>
        </Layer>
      </Section>

      <Section step="bits" code={PHASH_CODE.hash}>
        <Layer>
          <p>Each pattern becomes one bit of the fingerprint: 1 if its number is above the median of all 64, 0 if not.</p>
        </Layer>
        <Layer>
          <p>
            Each of the 64 numbers becomes one bit: 1 if it's above the{" "}
            <Term id="median" first>median</Term> of the 64, 0 if not. Splitting at the median makes the hash ignore
            two things restorations change most. Brightening the whole image
            only moves the flat pattern's number, and that one, the image's
            overall brightness, is always far above the median. Stretching the contrast evenly multiplies every
            other number by the same amount, which leaves their order alone.
          </p>
          {figure((e) => (
            <BitsFigure example={e} />
          ))}
          <p>
            Read across in rows of eight, the 64 bits are the 16{" "}
            <Term id="hex" first>hex digits</Term> the gallery stores for each
            panel. Because the split is at the median,
            every hash has exactly 32 ones and 32 zeros.
          </p>
        </Layer>
      </Section>

      <Section step="count" code={PHASH_CODE.distance}>
        <Layer>
          <p>
            Two fingerprints are compared by counting the bits that differ, the <Term id="hamming">Hamming distance</Term>.
          </p>
          {figure((e) => (
            <BitsGuess example={e}>
              <HammingFigure example={e} />
            </BitsGuess>
          ))}
        </Layer>
        <Layer>
          <p>
            To compare two hashes, line them up and count the positions where
            the bits differ. That count is the{" "}
            <Term id="hamming" first>Hamming distance</Term>: 0 for identical
            hashes, 64 for opposite ones.
          </p>
          {figure((e) => (
            <HammingFigure example={e} />
          ))}
          {example && pair !== null && (
            <p>
              For {exampleLabel(example)}, {pair} of the 64 patterns landed on
              the other side of the median after restoration. The other{" "}
              {64 - pair} came through unchanged.
            </p>
          )}
        </Layer>
      </Section>

      <Section step="result">
        <Layer>
          <p>
            To judge whether {pair !== null ? `${pair} bits is` : "that's"} a lot, here's this pair beside every
            restoration in the gallery and beside panels that have nothing to do with each other.
          </p>
          {figure((e, d) => (
            <DistanceRanges stats={d.stats} example={e} />
          ))}
          <p>
            Relighting barely moves the hash, but a new crop can move it as far as a different panel would. Any two
            unrelated panels land near 32, so only a low count means anything: it flags the same picture, and says
            little about panels that differ.
          </p>
        </Layer>
        <Layer>
          <p>
            Whether {pair ?? "that many"} bits is small depends on what else is
            that far away. The chart puts this pair beside every restoration in
            the gallery, and beside pairs of panels that have nothing to do
            with each other.
          </p>
          {figure((e, d) => (
            <DistanceRanges stats={d.stats} example={e} />
          ))}
          {stats && (
            <>
              <p>
                Relighting alone is easy for pHash. The{" "}
                {stats.restoredKeptFrame.n} restorations that kept the photo's
                framing moved their hash by {stats.restoredKeptFrame.min} to{" "}
                {stats.restoredKeptFrame.max} bits, far closer than any two
                different panels in the gallery.
              </p>
              <p>
                A new crop is harder. Reframing moved a hash by up to{" "}
                {stats.restoredReframed.max} bits, while every panel in the
                gallery has some unrelated panel between{" "}
                {stats.nearest.min} and {stats.nearest.max} bits away. A tight
                crop of one panel can land as far from its original as a
                different panel altogether.
              </p>
            </>
          )}
          <p>
            Unrelated panels cluster around 32 bits. With 32 ones in every hash,
            two hashes that have nothing in common still agree on about half
            their positions by chance. So only the low end of the scale carries
            meaning. Under{" "}
            {stats ? `about ${stats.nearest.min} bits` : "a dozen or so bits"},
            two images are very likely the same picture. Above that, the number
            says little about how two different panels relate, which is why
            pHash is for catching duplicates and not for sorting.
          </p>
        </Layer>
      </Section>
    </>
  );
}
