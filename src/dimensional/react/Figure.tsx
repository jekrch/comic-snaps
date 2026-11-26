import { Component } from "react";
import type { ReactNode } from "react";
import { useDoc } from "./context";

/**
 * A figure slot: a name and a fallback. The host registers components for
 * the names it can render (`figures` on `DimDoc`); anything else shows its
 * fallback, as does a registered figure that throws.
 *
 * Two rules for registered figures. They do no heavy work on mount (see
 * `idleCache`), since a section's figures remount while its glide runs. And
 * the prose around them must read without them, so instructions for an
 * interaction belong in the figure, never in the text.
 */
export function Figure({ id, wide = false, children }: { id: string; wide?: boolean; children?: ReactNode }) {
  const { figures } = useDoc();
  const Registered = figures[id];
  const fallback = <div className="dd-figure-fallback">{children}</div>;
  return (
    <figure className={`dd-figure${wide ? " is-wide" : ""}`} data-figure={id} data-live={Registered ? "" : undefined}>
      {Registered ? (
        <FigureBoundary fallback={fallback}>
          <Registered id={id} fallback={children} />
        </FigureBoundary>
      ) : (
        fallback
      )}
    </figure>
  );
}

class FigureBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("A dimensional figure failed; showing its fallback.", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** A figure, or anything, that breaks out of the column into the margin on wide screens. */
export function Wide({ children }: { children?: ReactNode }) {
  return <div className="dd-wide">{children}</div>;
}
