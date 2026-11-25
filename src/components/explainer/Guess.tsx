import { useId, useState } from "react";
import type { Panel } from "../../types";
import { panelImageUrl } from "../../utils/imageUrl";
import { useGuide } from "../guide/guideContext";
import type { NeighborInfo } from "./explainerConstants";
import { truncate } from "./explainerConstants";
import { bitDistance, type PhashExample } from "./phashExamples";

/**
 * The short lessons' guess-first figures: the reader commits to an answer,
 * then the method's own numbers say whether it agrees. A guess the method
 * disagrees with is often the more interesting outcome, so neither answer is
 * treated as a failure.
 */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A stable coin flip per anchor, so the closer panel isn't always on the left. */
function flipFor(id: string): boolean {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (h & 1) === 1;
}

interface NeighbourGuessProps {
  anchor: Panel;
  closest: NeighborInfo;
  furthest: NeighborInfo;
  /** The method's name, as it reads mid-sentence ("SigLIP", "the Gram model"). */
  method: string;
  /** A distance as it should read. */
  format: (d: number) => string;
  /** One sentence on what the method is looking at, shown with the answer. */
  why?: string;
  /** Shown under the answer once it's given. */
  children?: React.ReactNode;
}

/** "Which of these two does the method put closer?" Resets with a new anchor. */
export function NeighbourGuess(props: NeighbourGuessProps) {
  return <NeighbourGuessInner key={`${props.anchor.id}:${props.closest.panel.id}:${props.furthest.panel.id}`} {...props} />;
}

function NeighbourGuessInner({ anchor, closest, furthest, method, format, why, children }: NeighbourGuessProps) {
  const { shuffleAnchor } = useGuide();
  const [pick, setPick] = useState<"close" | "far" | null>(null);
  const qid = useId();
  const options = [
    { key: "close" as const, n: closest },
    { key: "far" as const, n: furthest },
  ];
  if (flipFor(anchor.id)) options.reverse();
  const answered = pick !== null;
  const right = pick === "close";
  const cname = `“${truncate(closest.panel.title, 28)}”`;
  const fname = `“${truncate(furthest.panel.title, 28)}”`;

  return (
    <figure className="guide-guess" data-answered={answered || undefined}>
      <figcaption id={qid} className="guide-guess-q">
        Which one does {method} put closer to this panel?
      </figcaption>
      <div className="guide-guess-row">
        <div className="guide-guess-anchor">
          <img src={panelImageUrl(anchor.image)} alt={anchor.title} loading="lazy" decoding="async" draggable={false} />
          <span className="guide-guess-tag">this panel</span>
        </div>
        <div className="guide-guess-choices" role="group" aria-labelledby={qid}>
          {options.map((o, i) => {
            const state = !answered ? "open" : o.key === "close" ? "closer" : "further";
            return (
              <button
                key={o.key}
                type="button"
                className="guide-guess-choice"
                data-state={state}
                data-picked={pick === o.key || undefined}
                disabled={answered}
                onClick={() => setPick(o.key)}
                aria-label={answered ? `${o.n.panel.title}: ${state}, ${format(o.n.distance)}` : `Guess ${o.n.panel.title}`}
              >
                <img src={panelImageUrl(o.n.panel.image)} alt="" loading="lazy" decoding="async" draggable={false} />
                <span className="guide-guess-tag">
                  {answered ? (
                    <>
                      {state} <span className="guide-guess-num">{format(o.n.distance)}</span>
                    </>
                  ) : (
                    String.fromCharCode(65 + i)
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="guide-guess-answer" aria-live="polite">
        {!answered ? (
          <p className="guide-guess-hint">Tap your guess, then see what {method} says.</p>
        ) : (
          <div className="guide-guess-reveal">
            <p>
              <span className="guide-guess-verdict">{right ? "Same call." : "Not how it sees it."}</span>{" "}
              {cap(method)} puts {cname} at {format(closest.distance)} and {fname} at {format(furthest.distance)}
              {right ? "." : ": the other way round."}
              {why && <> {why}</>}
            </p>
            {children}
            {shuffleAnchor && (
              <button type="button" className="guide-link" onClick={shuffleAnchor}>
                Try another panel
              </button>
            )}
          </div>
        )}
      </div>
    </figure>
  );
}

/** "How many bits did the restoration flip?" Resets with a new example. */
export function BitsGuess({ example, children }: { example: PhashExample; children?: React.ReactNode }) {
  return <BitsGuessInner key={example.id} example={example}>{children}</BitsGuessInner>;
}

function BitsGuessInner({ example, children }: { example: PhashExample; children?: React.ReactNode }) {
  const [guess, setGuess] = useState(16);
  const [locked, setLocked] = useState(false);
  const id = useId();
  const actual = bitDistance(example.before.bits, example.after.bits);
  const off = Math.abs(guess - actual);
  const verdict = off === 0 ? "Exactly." : off <= 3 ? "Close." : guess > actual ? "Fewer than that." : "More than that.";

  return (
    <figure className="guide-guess" data-answered={locked || undefined}>
      <figcaption className="guide-guess-q">
        <label htmlFor={id}>Out of 64 bits, how many do you think the restoration flipped?</label>
      </figcaption>
      <div className="guide-guess-dial">
        <input
          id={id}
          type="range"
          min={0}
          max={64}
          step={1}
          value={guess}
          disabled={locked}
          onChange={(e) => setGuess(Number(e.target.value))}
          style={{ "--fill": `${(guess / 64) * 100}%` } as React.CSSProperties}
        />
        <output htmlFor={id} className="guide-guess-num">
          {guess}
        </output>
        <button type="button" className="guide-guess-lock" disabled={locked} onClick={() => setLocked(true)}>
          {locked ? "Locked" : "Lock it in"}
        </button>
      </div>
      <div className="guide-guess-answer" aria-live="polite">
        {!locked ? (
          <p className="guide-guess-hint">0 would mean pHash sees no change at all; 32 is what two unrelated panels score.</p>
        ) : (
          <div className="guide-guess-reveal">
            <p>
              <span className="guide-guess-verdict">{verdict}</span> It flipped{" "}
              <span className="guide-guess-num">{actual}</span>
              {off > 0 && <>, and you guessed {guess}</>}. Each orange square below is one that changed.
            </p>
            {children}
          </div>
        )}
      </div>
    </figure>
  );
}
