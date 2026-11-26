import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { blockWords, inlineText, sectionLevel, type Block, type DocSection, type Inline, type ParsedDoc } from "../model";
import { useDoc, type TermDef } from "./context";
import { Page, type SourceGroupDef } from "./DimDoc";
import { Figure } from "./Figure";
import { Layer, Section } from "./Section";
import { Term } from "./Term";

/** Where a link in the prose goes: a page and section in this document, an address, or nowhere. */
export type LinkTarget = { page: string; step?: string | null } | { href: string } | null;

export interface MarkdownOptions {
  /** Turns an image's `src`, as written in the file, into an address the page can load. */
  resolveUrl?: (src: string) => string;
  /**
   * Where a link goes. By default: `#id` stays on the page, an absolute URL
   * opens as itself, and anything else (a path in a repository) is shown
   * as text.
   */
  resolveLink?: (href: string) => LinkTarget;
}

const MarkdownContext = createContext<MarkdownOptions>({});

function defaultLink(href: string): LinkTarget {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { href };
  return null;
}

function ResolvedLink({ href, children }: { href: string; children: ReactNode }) {
  const opts = useContext(MarkdownContext);
  const { page, goTo } = useDoc();
  const target = href.startsWith("#") ? { page, step: href.slice(1) } : (opts.resolveLink ?? defaultLink)(href);
  if (!target) {
    return (
      <span className="dd-path" title={href}>
        {children}
      </span>
    );
  }
  if ("href" in target) {
    return (
      <a href={target.href} className="dd-link" target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return (
    <a
      href={href}
      className="dd-link"
      onClick={(e) => {
        e.preventDefault();
        goTo(target.page, target.step ?? null);
      }}
    >
      {children}
    </a>
  );
}

function Img({ src, alt, width }: { src: string; alt: string; width?: string }) {
  const { resolveUrl } = useContext(MarkdownContext);
  const w = width ? (/^\d+$/.test(width) ? `${width}px` : width) : undefined;
  return (
    <img
      className="dd-img"
      src={resolveUrl ? resolveUrl(src) : src}
      alt={alt}
      loading="lazy"
      decoding="async"
      style={w ? { width: w } : undefined}
    />
  );
}

export function Inlines({ c }: { c: Inline[] }) {
  return (
    <>
      {c.map((n, i) => {
        switch (n.t) {
          case "text":
            return n.v;
          case "em":
            return (
              <em key={i}>
                <Inlines c={n.c} />
              </em>
            );
          case "strong":
            return (
              <strong key={i}>
                <Inlines c={n.c} />
              </strong>
            );
          case "code":
            return (
              <code key={i} className="dd-mono">
                {n.v}
              </code>
            );
          case "link":
            return (
              <ResolvedLink key={i} href={n.href}>
                <Inlines c={n.c} />
              </ResolvedLink>
            );
          case "img":
            return <Img key={i} src={n.src} alt={n.alt} width={n.width} />;
          case "term":
            return (
              <Term key={i} id={n.id} first={n.first}>
                {n.c.length ? <Inlines c={n.c} /> : undefined}
              </Term>
            );
          case "br":
            return <br key={i} />;
        }
      })}
    </>
  );
}

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} b={b} />
      ))}
    </>
  );
}

function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case "p":
      return (
        <p>
          <Inlines c={b.c} />
        </p>
      );
    case "h":
      return (
        <p className="dd-subhead">
          <Inlines c={b.c} />
        </p>
      );
    case "code":
      return (
        <pre className="dd-codeblock" data-lang={b.lang || undefined}>
          <code>{b.v}</code>
        </pre>
      );
    case "list": {
      const items = b.items.map((it, i) => (
        <li key={i}>
          <Inlines c={it} />
        </li>
      ));
      return b.ordered ? <ol className="dd-list">{items}</ol> : <ul className="dd-list">{items}</ul>;
    }
    case "table":
      return (
        <div className="dd-table-wrap">
          <table className="dd-table">
            <thead>
              <tr>
                {b.head.map((c, i) => (
                  <th key={i} style={b.align[i] ? { textAlign: b.align[i]! } : undefined}>
                    <Inlines c={c} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, j) => (
                <tr key={j}>
                  {r.map((c, i) => (
                    <td key={i} style={b.align[i] ? { textAlign: b.align[i]! } : undefined}>
                      <Inlines c={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return <hr className="dd-rule" />;
    case "figure":
      return (
        <Figure id={b.id}>
          <Blocks blocks={b.fallback} />
        </Figure>
      );
    case "snippet":
      return (
        <div className="dd-snippet">
          <p className="dd-snippet-ref" title="Quoted from the codebase as of the last refresh">
            {b.ref}
          </p>
          <Blocks blocks={b.fallback} />
        </div>
      );
    case "data":
      return (
        <p className="dd-data" title={b.ref}>
          Numbers as of {b.asOf ?? "the last refresh"}, from <code className="dd-mono">{b.ref.split("#")[0].split("/").pop()}</code>
        </p>
      );
  }
}

/** A section's blocks at one depth: the layer, then the section-level figures when that isn't L1. */
function layerBlocks(s: DocSection, depth: number): Block[] {
  if (depth === 0) return s.layers[0];
  return [...s.layers[depth], ...s.layers[0].filter(sectionLevel)];
}

function sectionWords(s: DocSection): number[] {
  return s.layers.map((_, d) => Math.round(blockWords(layerBlocks(s, d))));
}

function facetTitle(blocks: Block[], name: string): string {
  const snip = blocks.find((b) => b.t === "snippet");
  if (snip && snip.t === "snippet") {
    const [file, symbol] = snip.ref.split("#");
    return symbol ?? file.split("/").pop() ?? name;
  }
  return name[0].toUpperCase() + name.slice(1);
}

export function MarkdownSection({ s }: { s: DocSection }) {
  const facets = s.facets.map((f) => ({ name: f.name, title: facetTitle(f.blocks, f.name), body: <Blocks blocks={f.blocks} /> }));
  return (
    <Section id={s.id} title={s.heading} facets={facets} words={sectionWords(s)}>
      {s.layers.map((_, d) => (
        <Layer key={d}>
          <Blocks blocks={layerBlocks(s, d)} />
        </Layer>
      ))}
    </Section>
  );
}

export interface MarkdownPageOptions extends MarkdownOptions {
  id: string;
  /** The rail's label; the title by default. */
  label?: string;
}

/**
 * A parsed dimensional document as a `Page` of a `DimDoc`. Call it as a
 * function, not a component, so the page is a direct child of `DimDoc`:
 *
 * ```tsx
 * <DimDoc …>{markdownPage(parseDimensional(src), { id: "phash" })}</DimDoc>
 * ```
 *
 * The title line's legend (without its level list) becomes the eyebrow. An
 * intro with one layer becomes the lede; one with more becomes an untitled
 * first section with its own switch.
 */
export function markdownPage(doc: ParsedDoc, opts: MarkdownPageOptions) {
  const { id, label, ...md } = opts;
  const titles = new Map([doc.intro, ...doc.sections].flatMap((s) => (s ? [[s.id, s.heading]] : [])));
  const terms: Record<string, TermDef> = {};
  for (const [tid, body] of Object.entries(doc.terms)) {
    const home = doc.termHome[tid];
    terms[tid] = {
      label: doc.termLabel[tid] ?? tid,
      body: <Inlines c={body} />,
      page: id,
      section: home ?? doc.sections[0]?.id ?? "",
      sectionTitle: home ? titles.get(home) || undefined : undefined,
    };
  }
  const sources: SourceGroupDef[] = doc.sources.map((g) => ({
    id: g.id,
    title: g.title,
    items: g.items.map((it, i) => (
      <p key={i} className="dd-source">
        <Inlines c={it} />
      </p>
    )),
  }));
  const eyebrow = doc.legend?.replace(/\s*·?\s*Levels:.*$/i, "").trim() || undefined;
  const introLede = doc.intro && doc.intro.layers.length === 1;
  return (
    <Page
      key={id}
      id={id}
      title={doc.title}
      label={label}
      eyebrow={eyebrow}
      levels={doc.levels}
      terms={terms}
      sources={sources}
      gist={
        introLede ? (
          <MarkdownContext.Provider value={md}>
            <Blocks blocks={doc.intro!.layers[0]} />
          </MarkdownContext.Provider>
        ) : undefined
      }
    >
      <MarkdownContext.Provider value={md}>
        {doc.intro && !introLede && <MarkdownSection s={doc.intro} />}
        {doc.sections.map((s) => (
          <MarkdownSection key={s.id} s={s} />
        ))}
      </MarkdownContext.Provider>
    </Page>
  );
}

/** The plain text of a parsed document's L1 version, for search or a model's context. */
export function shortVersion(doc: ParsedDoc): string {
  const para = (blocks: Block[]) =>
    blocks.flatMap((b) => (b.t === "p" ? [inlineText(b.c)] : b.t === "list" ? b.items.map((i) => `- ${inlineText(i)}`) : []));
  const out = [`# ${doc.title}`, ...para(doc.intro?.layers[0] ?? [])];
  for (const s of doc.sections) out.push(`## ${s.heading}`, ...para(s.layers[0]));
  return out.join("\n\n");
}
