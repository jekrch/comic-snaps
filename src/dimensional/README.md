# Dimensional UI

A framework for reading dimensional documents on a screen built for them: a
page-wide depth switch, a switch on every section that swaps one layer for
the next in place, a rail that tracks the reader, term sidenotes and
popovers, facets (code) in the margin, and motion that never loses the
reader's place. It is the "HTML renderer" from `docs/dimensional-docs/portable.md`,
built to the plan in `docs/dimensional-docs/framework.md`, and extracted from
the comic-snaps Guide.

It imports nothing from comic-snaps. Its only dependencies are React and React DOM.

## Layout

```text
model.ts      the content model: sections, layers, facets, terms, sources
core/         no React: scroll spy, glide, reveal, overlay stack, route and
              storage adapters, idle cache, overlay-mode app layers, popover placement
parse/        published form (<details> + quotes) and authoring form (::: fences)
              into the model; a dependency-free Markdown subset for the prose
react/        DimDoc, Page, Section, Layer, Term, Figure, Wide, DepthSwitch, Rail,
              FacetPane; markdownPage() maps a parsed document onto them
styles/       dimensional.css: --dd-* tokens and the stylesheet in @layer dd,
              plus @property --dd-glide-fade outside any layer
```

## Use

```tsx
import { DimDoc, Page, Section, Layer, Term, Figure, queryRoute, localStore } from "./dimensional";
import "./dimensional/styles/dimensional.css";

<DimDoc title="Docs" levels={["Essentials", "In depth", "Reference"]}
        route={queryRoute("doc")} storage={localStore("myapp.doc")} figures={FIGURES}>
  <Page id="phash" title="Perceptual Hash" gist="A 64-bit fingerprint…" terms={TERMS}>
    <Section id="luma" title="pHash sees only brightness" code={{ title: "compute_metadata", body: … }}>
      <Layer>The first step throws color away, keeping its <Term id="luma" first>luma</Term>.</Layer>
      <Layer>pHash ignores color… <Figure id="phash-luma">fallback</Figure></Layer>
      <Layer>The weights come from ITU-R BT.601…</Layer>
    </Section>
  </Page>
</DimDoc>
```

From Markdown, call `markdownPage` as a function so the page is a direct
child of `DimDoc`:

```tsx
<DimDoc …>{markdownPage(parseDimensional(src), { id: "phash", resolveUrl, resolveLink })}</DimDoc>
```

### Hosts

- `{ mode: "page" }` (default): owns the window and scrolls with it.
- `{ mode: "overlay", appLayers }`: slides over a running app, moves the app's
  top layers aside and dims them. A route with no page closes it.
- `{ mode: "embedded", sidebar? }`: no masthead, inside someone else's
  layout. The rail can be handed to the host's sidebar.

Routing and storage are adapters: `queryRoute(param)`, `hashRoute()`,
`memoryRoute()`; `localStore(prefix)`, `memoryStore()`.

### Cascade

The stylesheet is in `@layer dd`. A host whose base layer colours every
element (Tailwind's preflight does) should fix the order before anything
else loads, so `dd` sits above the reset and below its components and
utilities:

```css
@layer theme, base, dd, components, utilities;
```

### Figures

`figures` maps names to components. A name with no component shows its
fallback, and so does a component that throws. Figures do no heavy work on
mount (`idleCache` / `imagePixels`), and share choices across sections with
`useDocState(key, initial)`.

## In comic-snaps

- `?dd` renders `docs/dimensional-docs/*` through the framework in page mode
  (`src/components/dimensional/DimensionalPreview.tsx`). `&dd-host=overlay`
  slides it over the gallery, and `&dd-host=embedded` puts it in a
  stand-in host with a light theme. `docs/` is untracked, so CI builds have
  no documents.
- The Guide runs on the framework. `Guide.tsx` renders a `DimDoc` in overlay
  mode, with pages from the lesson registry. It passes in the specimen bar,
  anchor picker, sort button and end note through `slots` and `endNote`.
  Its route, storage, terms and sources come in through
  `guide/guideAdapters.tsx`, and the storage adapter keeps the existing
  localStorage keys. Lessons hold their Essentials and In depth as `Layer`s.
  The Guide's `Section` and `Term` are thin wrappers over the framework's.
  `index.css` keeps only the lessons' own content styles, with the
  `--guide-*` layout variables mapped onto `--dd-*`.

## Not done yet

- A remark/MDX plugin. The parser here does that job without the unified
  stack.
- Filling authoring-form `::: code path#symbol` facets from the repo. Today
  they show the reference and the text only.
- A Web Components build of `core/`.
- Server-rendering deeper layers hidden in the HTML. Today only the default
  level renders on the server.
- Moving to `packages/` (core, react, mdx, styles) and its own repository.
