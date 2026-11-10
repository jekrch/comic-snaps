import { Fragment } from "react";
import type { ReactNode } from "react";
import type { FormerOwner, MinorityStake } from "../types";
import type { OwnershipStep } from "../utils/owners";
import { describeLink } from "../utils/owners";
import { yearSpan } from "../utils/publishers";

/** How far each rung steps in from the one above. */
const INDENT = 14;
/** Middle of a rung's first line (text-xs on a 16px line), where its dot sits. */
const DOT_Y = 8;

const houseLink =
  "text-white/80 hover:text-accent underline decoration-white/20 decoration-dotted underline-offset-2 hover:decoration-accent transition-colors";

/** Items run together on one wrapping line, with a quiet separator. */
function Run({ label, children }: { label: string; children: ReactNode[] }) {
  return (
    <p className="mt-0.5 text-[11px] leading-relaxed">
      <span className="text-white/30">{label} </span>
      {children.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-white/20"> · </span>}
          {child}
        </Fragment>
      ))}
    </p>
  );
}

function Former({ owner }: { owner: FormerOwner }) {
  const span = yearSpan(owner.from, owner.until);
  return (
    <span>
      <span className="text-white/55">{owner.name}</span>
      {owner.what && <span className="text-white/35"> ({owner.what})</span>}
      {span && <span className="text-white/40 tabular-nums"> {span}</span>}
      {owner.price && <span className="text-white/40">, {owner.price}</span>}
    </span>
  );
}

/** "Savvy Games Group (owned by …) about 7.5% of the shares, since 2022, $1 billion" */
function Stake({ stake }: { stake: MinorityStake }) {
  const span = yearSpan(stake.since, null);
  const tail = [stake.share, span, stake.price].filter(Boolean).join(", ");
  return (
    <span>
      <span className="text-white/60">{stake.name}</span>
      {stake.what && <span className="text-white/35"> ({stake.what})</span>}
      {tail && <span className="text-white/40 tabular-nums"> {tail}</span>}
    </span>
  );
}

/**
 * Who owns a house, as a ladder from the top of the chain down to the house
 * itself, each rung stepped in under the one above. Every company on the way
 * shows what else it holds, the houses on the wall among them, so the page
 * can be read for the kind of family the label sits in.
 */
export default function OwnershipTree({
  steps,
  onOpenPublisher,
  onOpenPerson,
  isPersonInteractive,
}: {
  steps: OwnershipStep[];
  onOpenPublisher: (name: string) => void;
  onOpenPerson?: (name: string, artistId: string | null) => void;
  isPersonInteractive?: (name: string, artistId: string | null) => boolean;
}) {
  // "A, B and C", each a link to their page when there is one.
  const peopleList = (people: { name: string; artistId?: string | null }[]) =>
    people.map((p, i) => {
      const id = p.artistId ?? null;
      const sep = i === 0 ? "" : i === people.length - 1 ? " and " : ", ";
      return (
        <Fragment key={`${p.name}-${i}`}>
          {sep}
          {onOpenPerson && isPersonInteractive?.(p.name, id) ? (
            <button type="button" onClick={() => onOpenPerson(p.name, id)} className={houseLink}>
              {p.name}
            </button>
          ) : (
            p.name
          )}
        </Fragment>
      );
    });

  return (
    <ol aria-label="Ownership">
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        const { owner, publisher } = step;
        const name = owner?.name ?? publisher?.name ?? "";
        const meta = describeLink(step.link);
        const holdings = owner?.holdings ?? [];
        const earlier = step.link?.earlier ?? [];
        const stakes = owner?.stakes ?? [];

        let nameEl: ReactNode;
        if (last) {
          nameEl = <span className="text-white/90">{name}</span>;
        } else if (publisher) {
          nameEl = (
            <button type="button" onClick={() => onOpenPublisher(publisher.name)} className={houseLink}>
              {name}
            </button>
          );
        } else if (owner?.people?.length) {
          nameEl = <span className="text-white/80">{peopleList(owner.people)}</span>;
        } else if (owner?.url) {
          nameEl = (
            <a href={owner.url} target="_blank" rel="noopener noreferrer" className="text-white/80 hover:text-accent transition-colors">
              {name}
            </a>
          );
        } else {
          nameEl = <span className="text-white/80">{name}</span>;
        }

        return (
          <li
            key={step.key}
            className="relative pl-4"
            style={{ marginLeft: i * INDENT, paddingBottom: last ? 0 : 12 }}
          >
            {/* The stem down to the next rung, and the elbow in from the one
                above; the two meet at the boundary between rungs. */}
            {!last && (
              <span aria-hidden className="absolute w-px bg-white/12" style={{ left: 3.5, top: DOT_Y + 5, bottom: 0 }} />
            )}
            {i > 0 && (
              <span
                aria-hidden
                className="absolute border-l border-b border-white/12 rounded-bl-[5px]"
                style={{ left: 3.5 - INDENT, top: 0, width: INDENT - 3, height: DOT_Y }}
              />
            )}
            <span
              aria-hidden
              className={`absolute size-1.75 rounded-full ${last ? "bg-accent" : "bg-white/30"}`}
              style={{ left: 0.5, top: DOT_Y - 3.5 }}
            />

            <p className="text-xs leading-4">
              {nameEl}
              {owner?.kind && <span className="text-white/35"> · {owner.kind}</span>}
            </p>
            {meta && <p className="mt-0.5 text-[10px] text-white/40 tabular-nums">{meta}</p>}
            {owner?.note && <p className="mt-0.5 text-[11px] text-white/45 leading-relaxed">{owner.note}</p>}
            {(step.siblings.length > 0 || holdings.length > 0) && (
              <Run label="also">
                {[
                  ...step.siblings.map((p) => (
                    <button key={p.id} type="button" onClick={() => onOpenPublisher(p.name)} className={houseLink}>
                      {p.name}
                    </button>
                  )),
                  ...holdings.map((h) => (
                    <span key={h.name}>
                      <span className="text-white/60">{h.name}</span>
                      {h.what && <span className="text-white/35"> ({h.what})</span>}
                    </span>
                  )),
                ]}
              </Run>
            )}
            {stakes.length > 0 && (
              <Run label="stakes">
                {stakes.map((s, j) => (
                  <Stake key={`${s.name}-${j}`} stake={s} />
                ))}
              </Run>
            )}
            {earlier.length > 0 && (
              <Run label="before">
                {earlier.map((o, j) => (
                  <Former key={`${o.name}-${j}`} owner={o} />
                ))}
              </Run>
            )}
          </li>
        );
      })}
    </ol>
  );
}
