import { Mono } from "../../explainer/explainerPrimitives";
import { CONCEPTS } from "../concepts";
import { GuideLink } from "../GuideLink";
import { pageDef, stepDef } from "../lessons";

/** Every concept the Guide defines, with the way back to where it's introduced. */
export function Glossary() {
  const sorted = [...CONCEPTS].sort((a, b) => a.label.localeCompare(b.label));
  return (
    <dl className="guide-glossary">
      {sorted.map((c) => {
        const home = pageDef(c.lesson);
        const step = stepDef(c.lesson, c.step);
        return (
          <div key={c.id} id={`term-${c.id}`} className="guide-glossary-entry">
            <dt>{c.label}</dt>
            <dd>
              <p>{c.short}</p>
              <p className="guide-caption">
                Introduced in{" "}
                <GuideLink to={c.lesson} step={c.step}>
                  {home.label} › {step?.short ?? step?.title ?? c.step}
                </GuideLink>
                {c.code && c.code.length > 0 && (
                  <>
                    {" · in the code: "}
                    {c.code.map((name, i) => (
                      <span key={name}>
                        {i > 0 && ", "}
                        <Mono>{name}</Mono>
                      </span>
                    ))}
                  </>
                )}
              </p>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
