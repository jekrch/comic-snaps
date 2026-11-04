import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Artist, Panel, IssueCredits, Series } from "../../types";
import { PRODUCTION_ROLES, loadMetadata } from "../../utils/metadata";
import { normalizeCountry } from "../../utils/country";
import { formatIssue } from "../../utils/issueFormat";
import { panelImageUrl } from "../../utils/imageUrl";

// Chart palette — validated against the app surface (#141414) with the
// dataviz six-checks script: accent passes all four; gray is the deliberate
// neutral (B&W split, "Other" fold) and is always paired with direct labels.
const ACCENT = "#e85d3a";
const NEUTRAL = "#8a857f";

const INK_MUTED = "var(--color-ink-muted, rgba(160,155,150,0.7))";
const HAIRLINE = "rgba(255,255,255,0.07)";

// Same threshold the color sort uses to partition chromatic vs achromatic.
const COLORFULNESS_THRESHOLD = 6;

// Co-creator roles the "most credited" chart counts from issue credits. Artist
// is handled separately — every panel carries its own artist (see below), so
// it's sourced from the panel rather than the issue credits.
const ISSUE_CREDIT_ROLES = ["Writer", "Colorist", "Letterer"];

/** Gallery filter selections a clicked bar can apply — keys match Filters. */
export type StatsFilterPatch = Partial<
  Record<"decades" | "tags" | "artists" | "colorists" | "letterers" | "credits" | "series", string[]>
>;

/** Opens a panel in the viewer; `group` scopes the viewer's prev/next. */
export type StatsOpenPanel = (panel: Panel, group?: Panel[]) => void;

interface NamedCount {
  name: string;
  count: number;
  roles?: string[];
  isOther?: boolean;
  filter?: StatsFilterPatch;
}

interface ColumnDatum {
  label: string;
  /** Tooltip title when the axis label alone is too terse. */
  name?: string;
  count: number;
  filter?: StatsFilterPatch;
}

interface Swatch {
  panel: Panel;
  css: string;
}

interface PaletteRow {
  label: string;
  swatches: Swatch[];
}

interface ComputedStats {
  decades: ColumnDatum[];
  colorCount: number;
  bwCount: number;
  tags: NamedCount[];
  palette: PaletteRow[];
  oldestPanel: Panel | null;
  career: Career | null;
}

/** The artist whose panels here span the most years, first to last. */
interface Career {
  artist: string;
  span: number;
  /** Their panels in publication order, first to last. */
  panels: Panel[];
}

interface AgePick {
  panel: Panel;
  age: number;
}

interface MetaStats {
  credited: NamedCount[];
  roles: NamedCount[];
  publishers: NamedCount[];
  creditedIssueCount: number;
  creatorCount: number;
  ages: ColumnDatum[];
  agedPanelCount: number;
  medianAge: number | null;
  youngest: AgePick | null;
  oldest: AgePick | null;
  countries: NamedCount[];
  countryKnown: number;
  countryTotal: number;
}

const decadeLabel = (d: number) => `'${String(d).slice(2)}s`;

const labCss = ([L, a, b]: [number, number, number]) => `lab(${L} ${a} ${b})`;

// Chroma a dominant color needs before it counts as the panel's hue — the same
// cut the COLOR sort uses, so the palette strip reads in the same order.
const SWATCH_CHROMA = 10;

/**
 * A panel's slice in the palette strip, and where it sorts within its decade.
 *
 * A color panel is placed by the hue of its first strongly chromatic dominant
 * color. Anything without one (B&W pages, near-neutral color) follows all the
 * hues, light to dark, in its leading color, which on an old B&W page is
 * usually the paper. The yellowing is real, so it's shown rather than hidden.
 */
function swatchOf(p: Panel): { css: string; key: number } | null {
  const colors = p.dominantColors;
  if (!colors || colors.length === 0) return null;
  if ((p.colorfulness ?? 0) >= COLORFULNESS_THRESHOLD) {
    for (const c of colors) {
      if (Math.hypot(c[1], c[2]) >= SWATCH_CHROMA) {
        const h = Math.atan2(c[2], c[1]);
        return { css: labCss(c), key: h < 0 ? h + 2 * Math.PI : h };
      }
    }
  }
  const c = colors[0];
  // Hue keys stop at 2π (~6.28), so 10+ places these after every hue
  return { css: labCss(c), key: 10 + (100 - c[0]) / 100 };
}

const describePanel = (p: Panel) =>
  `${p.title} ${formatIssue(p.issue)}${p.year ? ` (${p.year})` : ""}${p.artist ? ` · ${p.artist}` : ""}`;

function topWithOther(counts: Map<string, number>, limit: number): NamedCount[] {
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top: NamedCount[] = sorted.slice(0, limit).map(([name, count]) => ({ name, count }));
  const rest = sorted.slice(limit).reduce((sum, [, c]) => sum + c, 0);
  if (rest > 0) top.push({ name: "Other", count: rest, isOther: true });
  return top;
}

function computePanelStats(panels: Panel[]): ComputedStats {
  const years = panels.map((p) => p.year).filter((y) => y > 0);
  const minDecade = Math.floor(Math.min(...years) / 10) * 10;
  const maxDecade = Math.floor(Math.max(...years) / 10) * 10;

  const byDecade = new Map<number, number>();
  for (let d = minDecade; d <= maxDecade; d += 10) byDecade.set(d, 0);
  for (const y of years) {
    const d = Math.floor(y / 10) * 10;
    byDecade.set(d, (byDecade.get(d) ?? 0) + 1);
  }
  const decades = [...byDecade.entries()].map(([d, count]) => ({
    label: decadeLabel(d),
    count,
    filter: { decades: [`${d}s`] },
  }));

  const paletteByDecade = new Map<number, (Swatch & { key: number })[]>();
  for (const p of panels) {
    if (!(p.year > 0)) continue;
    const s = swatchOf(p);
    if (!s) continue;
    const d = Math.floor(p.year / 10) * 10;
    let list = paletteByDecade.get(d);
    if (!list) paletteByDecade.set(d, (list = []));
    list.push({ panel: p, ...s });
  }
  const palette = [...paletteByDecade.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([d, list]) => ({
      label: decadeLabel(d),
      swatches: list.sort((a, b) => a.key - b.key).map(({ panel, css }) => ({ panel, css })),
    }));

  // Oldest by publication year (ties: first posted)
  let oldestPanel: Panel | null = null;
  for (const p of panels) {
    if (
      p.year > 0 &&
      (!oldestPanel ||
        p.year < oldestPanel.year ||
        (p.year === oldestPanel.year && Date.parse(p.addedAt) < Date.parse(oldestPanel.addedAt)))
    ) {
      oldestPanel = p;
    }
  }

  // Longest career: widest first-to-last publication span among one artist's
  // panels. Ties go to the artist with more panels on the wall.
  const byArtist = new Map<string, Panel[]>();
  for (const p of panels) {
    if (!p.artist || !(p.year > 0)) continue;
    let list = byArtist.get(p.artist);
    if (!list) byArtist.set(p.artist, (list = []));
    list.push(p);
  }
  let career: Career | null = null;
  for (const [artist, list] of byArtist) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(
      (a, b) => a.year - b.year || Date.parse(a.addedAt) - Date.parse(b.addedAt),
    );
    const span = sorted[sorted.length - 1].year - sorted[0].year;
    if (
      span > 0 &&
      (!career || span > career.span || (span === career.span && sorted.length > career.panels.length))
    ) {
      career = { artist, span, panels: sorted };
    }
  }

  let colorCount = 0;
  for (const p of panels) {
    if ((p.colorfulness ?? 0) >= COLORFULNESS_THRESHOLD) colorCount++;
  }

  const tagCounts = new Map<string, number>();
  for (const p of panels) {
    for (const t of p.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const tags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count, filter: { tags: [name] } }));

  return {
    decades,
    colorCount,
    bwCount: panels.length - colorCount,
    tags,
    palette,
    oldestPanel,
    career,
  };
}

// Ages outside this range are bad birth-year records, not prodigies
const MIN_PLAUSIBLE_AGE = 12;
const MAX_PLAUSIBLE_AGE = 100;
const AGE_BIN = 5;

function computeAgeStats(panels: Panel[], artistByName: Map<string, Artist>) {
  const aged: AgePick[] = [];
  for (const p of panels) {
    const a = artistByName.get(p.artist);
    if (!a?.birthYear || !(p.year > 0)) continue;
    // A panel published after its artist died is a posthumous printing or a
    // reprint, so its year isn't when they drew it.
    if (a.deathYear && p.year > a.deathYear) continue;
    const age = p.year - a.birthYear;
    if (age < MIN_PLAUSIBLE_AGE || age > MAX_PLAUSIBLE_AGE) continue;
    aged.push({ panel: p, age });
  }
  if (aged.length === 0) {
    return { ages: [], agedPanelCount: 0, medianAge: null, youngest: null, oldest: null };
  }

  let youngest = aged[0];
  let oldest = aged[0];
  for (const x of aged) {
    // Youngest ties go to the earliest work, oldest ties to the latest
    if (x.age < youngest.age || (x.age === youngest.age && x.panel.year < youngest.panel.year)) youngest = x;
    if (x.age > oldest.age || (x.age === oldest.age && x.panel.year > oldest.panel.year)) oldest = x;
  }

  const sorted = aged.map((x) => x.age).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const medianAge =
    sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);

  const lo = Math.floor(youngest.age / AGE_BIN) * AGE_BIN;
  const hi = Math.floor(oldest.age / AGE_BIN) * AGE_BIN;
  const bins = new Map<number, number>();
  for (let b = lo; b <= hi; b += AGE_BIN) bins.set(b, 0);
  for (const { age } of aged) {
    const b = Math.floor(age / AGE_BIN) * AGE_BIN;
    bins.set(b, (bins.get(b) ?? 0) + 1);
  }
  const ages = [...bins.entries()].map(([b, count]) => ({
    label: String(b),
    name: `Age ${b}–${b + AGE_BIN - 1}`,
    count,
  }));

  return { ages, agedPanelCount: aged.length, medianAge, youngest, oldest };
}

/** Panel artists per country — people, not panels, since it's about where
 *  the artists come from. A bar filters the gallery to those artists. */
function computeCountryStats(panels: Panel[], artistByName: Map<string, Artist>) {
  const names = new Set(panels.map((p) => p.artist).filter(Boolean));
  const byCountry = new Map<string, string[]>();
  for (const name of names) {
    const country = normalizeCountry(artistByName.get(name)?.country);
    if (!country) continue;
    let list = byCountry.get(country);
    if (!list) byCountry.set(country, (list = []));
    list.push(name);
  }
  const counts = new Map([...byCountry].map(([c, list]) => [c, list.length]));
  const countries = topWithOther(counts, 8);
  for (const c of countries) {
    if (!c.isOther) c.filter = { artists: byCountry.get(c.name) ?? [] };
  }
  const countryKnown = [...byCountry.values()].reduce((sum, list) => sum + list.length, 0);
  return { countries, countryKnown, countryTotal: names.size };
}

function computeMetaStats(
  panels: Panel[],
  artists: Artist[],
  series: Series[],
  issues: IssueCredits[],
): MetaStats {
  const artistByName = new Map<string, Artist>();
  for (const a of artists) artistByName.set(a.name, a);
  const issueByKey = new Map<string, IssueCredits>();
  for (const i of issues) issueByKey.set(`${i.series}|${i.issue}`, i);
  const seriesById = new Map<string, Series>();
  for (const s of series) seriesById.set(s.id, s);

  // People weighted by how many collected panels come from issues they're
  // credited on — the panel is the unit of the site, so it's the honest weight.
  const personPanels = new Map<string, number>();
  const personRoles = new Map<string, Set<string>>();
  const linkedIssueIds = new Set<string>();
  const allCreators = new Set<string>();
  const publisherCounts = new Map<string, number>();
  const publisherTitles = new Map<string, Set<string>>();

  const addRole = (name: string, role: string) => {
    let roles = personRoles.get(name);
    if (!roles) personRoles.set(name, (roles = new Set()));
    roles.add(role);
  };

  for (const p of panels) {
    // One panel is one unit of credit per contributor, no matter how many
    // roles they held on it.
    const counted = new Set<string>();
    const credit = (name: string) => {
      if (counted.has(name)) return;
      counted.add(name);
      personPanels.set(name, (personPanels.get(name) ?? 0) + 1);
    };

    // Every panel has an artist, taken directly from the panel itself.
    if (p.artist) {
      allCreators.add(p.artist);
      credit(p.artist);
      addRole(p.artist, "Artist");
    }

    const issue = issueByKey.get(`${p.slug}|${p.issue}`);
    if (issue) {
      linkedIssueIds.add(issue.id);
      for (const c of issue.credits) {
        allCreators.add(c.name);
        const creativeRoles = c.roles.filter((r) => ISSUE_CREDIT_ROLES.includes(r));
        if (creativeRoles.length === 0) continue;
        credit(c.name);
        for (const r of creativeRoles) addRole(c.name, r);
      }
    }

    // Some pipeline runs left a comics.org API URL in the publisher field —
    // treat those like a missing publisher rather than charting the URL.
    const publisherOf = (s?: Series) =>
      s?.publisher && !/^https?:\/\//.test(s.publisher) ? s.publisher : null;

    let s = seriesById.get(p.slug);
    if (s && !publisherOf(s) && s.parentSeries) {
      s = seriesById.get(s.parentSeries) ?? s;
    }
    const pub = publisherOf(s) ?? "Unknown";
    publisherCounts.set(pub, (publisherCounts.get(pub) ?? 0) + 1);
    let titles = publisherTitles.get(pub);
    if (!titles) publisherTitles.set(pub, (titles = new Set()));
    titles.add(p.title);
  }

  const publishers = topWithOther(publisherCounts, 8);
  for (const p of publishers) {
    // "Unknown" is a non-entity like "Other" — render it in the neutral gray
    if (p.name === "Unknown") p.isOther = true;
    // There's no publisher facet, so a label filters as its set of series
    const titles = publisherTitles.get(p.name);
    if (!p.isOther && titles) p.filter = { series: [...titles] };
  }

  const credited: NamedCount[] = [...personPanels.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({
      name,
      count,
      roles: [...(personRoles.get(name) ?? [])],
      filter: { credits: [name] },
    }));

  // Role frequency. Artist is counted once per panel (every panel has one,
  // taken directly from the panel); the remaining roles are counted once per
  // person per linked issue. Editorial/production roles are hidden.
  const roleCounts = new Map<string, number>();
  for (const p of panels) {
    if (p.artist) roleCounts.set("Artist", (roleCounts.get("Artist") ?? 0) + 1);
  }
  for (const i of issues) {
    if (!linkedIssueIds.has(i.id)) continue;
    for (const c of i.credits) {
      for (const r of c.roles) {
        if (r === "Artist" || PRODUCTION_ROLES.has(r)) continue;
        roleCounts.set(r, (roleCounts.get(r) ?? 0) + 1);
      }
    }
  }
  const roles = topWithOther(roleCounts, 8);

  return {
    credited,
    roles,
    publishers,
    creditedIssueCount: linkedIssueIds.size,
    creatorCount: allCreators.size,
    ...computeAgeStats(panels, artistByName),
    ...computeCountryStats(panels, artistByName),
  };
}

// Building blocks

function SectionTitle({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-2">
      <h3
        className="text-[12px] tracking-[0.06em] text-ink m-0 shrink-0"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {title}
      </h3>
      {note && (
        <span className="text-[10px] truncate" style={{ color: INK_MUTED, opacity: 0.8 }}>
          {note}
        </span>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      className="rounded-md px-3.5 py-3 border"
      style={{ borderColor: "var(--color-border, rgba(74,71,69,0.25))" }}
    >
      <div
        className="text-[9px] uppercase tracking-[0.1em] mb-1"
        style={{ color: INK_MUTED }}
      >
        {label}
      </div>
      <div
        className="text-[19px] leading-none text-ink"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {value}
      </div>
    </div>
  );
}

function ChartTip({ active, payload, label, unit = "panel" }: any) {
  if (!active || !payload?.length) return null;
  const datum = payload[0].payload as NamedCount & { label?: string };
  const title = datum.name ?? label;
  const n = payload[0].value;
  return (
    <div
      className="rounded-md px-3 py-2 text-[11px] border"
      style={{
        background: "var(--color-surface-hover, #1a1a1a)",
        borderColor: "var(--color-border, rgba(74,71,69,0.35))",
        color: "var(--color-ink)",
        maxWidth: 220,
      }}
    >
      <span>{title}</span>
      <span style={{ color: INK_MUTED }}> · {n} {unit}{n === 1 ? "" : "s"}</span>
      {datum.roles && datum.roles.length > 0 && (
        <div className="mt-0.5" style={{ color: INK_MUTED }}>
          {datum.roles.join(", ")}
        </div>
      )}
    </div>
  );
}

const truncate = (v: string) => (v.length > 17 ? `${v.slice(0, 16)}…` : v);

function HBars({
  data,
  onFilter,
  unit,
}: {
  data: NamedCount[];
  onFilter?: (patch: StatsFilterPatch) => void;
  unit?: string;
}) {
  return (
    <div style={{ height: data.length * 26 + 8 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 34, bottom: 0, left: 0 }}
          barCategoryGap={6}
          accessibilityLayer={false}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={116}
            tickLine={false}
            axisLine={false}
            tickFormatter={truncate}
            tick={{ fill: "var(--color-ink-muted, #9e9892)", fontSize: 10 }}
          />
          <Tooltip content={<ChartTip unit={unit} />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar
            dataKey="count"
            maxBarSize={13}
            radius={[0, 3, 3, 0]}
            isAnimationActive={false}
            onClick={(entry: any) => {
              const filter = entry?.payload?.filter ?? entry?.filter;
              if (filter && onFilter) onFilter(filter);
            }}
          >
            {data.map((d) => (
              <Cell
                key={d.name}
                fill={d.isOther ? NEUTRAL : ACCENT}
                fillOpacity={d.isOther ? 0.55 : 0.9}
                cursor={d.filter && onFilter ? "pointer" : undefined}
              />
            ))}
            <LabelList
              dataKey="count"
              position="right"
              offset={6}
              style={{ fill: "var(--color-ink-muted, #9e9892)", fontSize: 10 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ColumnChart({
  data,
  onFilter,
}: {
  data: ColumnDatum[];
  onFilter?: (patch: StatsFilterPatch) => void;
}) {
  const clickable = !!onFilter && data.some((d) => d.filter);
  return (
    <div style={{ height: 160 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 6, right: 4, bottom: 0, left: -22 }}
          accessibilityLayer={false}
        >
          <CartesianGrid stroke={HAIRLINE} vertical={false} />
          <XAxis
            dataKey="label"
            interval={0}
            tickLine={false}
            axisLine={{ stroke: HAIRLINE }}
            tick={{ fill: "var(--color-ink-muted, #9e9892)", fontSize: 9 }}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--color-ink-muted, #9e9892)", fontSize: 9 }}
          />
          <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar
            dataKey="count"
            fill={ACCENT}
            fillOpacity={0.9}
            maxBarSize={22}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
            cursor={clickable ? "pointer" : undefined}
            onClick={(entry: any) => {
              const filter = entry?.payload?.filter ?? entry?.filter;
              if (filter && onFilter) onFilter(filter);
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface Superlative {
  key: string;
  label: string;
  value: string;
  unit?: string;
  detail: string;
  panel: Panel;
  /** What the viewer pages through when the tile is opened. */
  group?: Panel[];
}

/** A record-holding panel, shown as its art. Clicking opens it in the viewer. */
function SuperlativeTile({ s, onOpen }: { s: Superlative; onOpen?: StatsOpenPanel }) {
  const lead = s.panel.dominantColors?.[0];
  const body = (
    <>
      <div
        className="aspect-[4/3] overflow-hidden rounded-[3px] mb-2"
        style={{ background: lead ? labCss(lead) : HAIRLINE }}
      >
        <img
          src={panelImageUrl(s.panel.image)}
          alt=""
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover block"
          // A content-warned panel stays veiled here, as it is on the wall
          style={s.panel.blur ? { filter: "blur(14px)", transform: "scale(1.15)" } : undefined}
        />
      </div>
      <div className="text-[9px] uppercase tracking-[0.1em] mb-1 truncate" style={{ color: INK_MUTED }}>
        {s.label}
      </div>
      <div className="text-[17px] leading-none text-ink truncate" style={{ fontFamily: "var(--font-display)" }}>
        {s.value}
        {s.unit && (
          <span className="text-[10px] ml-1" style={{ color: INK_MUTED, fontFamily: "inherit" }}>
            {s.unit}
          </span>
        )}
      </div>
      <div className="text-[10px] mt-1 truncate" style={{ color: INK_MUTED }} title={s.detail}>
        {s.detail}
      </div>
    </>
  );
  const frame = "rounded-md p-2 border text-left block w-full min-w-0";
  const border = { borderColor: "var(--color-border, rgba(74,71,69,0.25))" };
  if (!onOpen) return <div className={frame} style={border}>{body}</div>;
  return (
    <button
      type="button"
      className={`${frame} cursor-pointer transition-colors hover:bg-white/[0.03]`}
      style={border}
      aria-label={`${s.label}: ${s.value}${s.unit ? ` ${s.unit}` : ""}, ${describePanel(s.panel)}`}
      onClick={() => onOpen(s.panel, s.group)}
    >
      {body}
    </button>
  );
}

/** Same footprint as a SuperlativeTile, held while the metadata loads so the
 *  grid doesn't grow a row under the reader. */
function SuperlativePlaceholder() {
  return (
    <div
      className="rounded-md p-2 border"
      style={{ borderColor: "var(--color-border, rgba(74,71,69,0.25))" }}
      aria-hidden
    >
      <div className="aspect-[4/3] rounded-[3px] mb-2" style={{ background: HAIRLINE }} />
      <div className="h-[9px] mb-1" />
      <div className="h-[17px]" />
      <div className="h-[10px] mt-1" />
    </div>
  );
}

/**
 * One strip per decade, one slice per panel in that decade, sorted by hue with
 * the B&W pages trailing. Every strip is full width, so a strip shows what
 * share of the decade is which color, not how many panels it holds; the count
 * at the end says that.
 */
function DecadePalette({ rows, onOpen }: { rows: PaletteRow[]; onOpen?: StatsOpenPanel }) {
  const [hover, setHover] = useState<Panel | null>(null);
  return (
    <div onMouseLeave={() => setHover(null)}>
      <div className="flex flex-col gap-[3px]">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2">
            <span className="w-7 shrink-0 text-[9px] tabular-nums" style={{ color: INK_MUTED }}>
              {row.label}
            </span>
            <div className="flex flex-1 min-w-0 h-[14px] rounded-[3px] overflow-hidden">
              {row.swatches.map((s) => (
                <button
                  key={s.panel.id}
                  type="button"
                  tabIndex={onOpen ? 0 : -1}
                  aria-label={describePanel(s.panel)}
                  className="flex-1 min-w-0 p-0 m-0 border-0 transition-opacity hover:opacity-60 focus-visible:opacity-60 outline-none"
                  style={{ background: s.css, cursor: onOpen ? "pointer" : "default" }}
                  onMouseEnter={() => setHover(s.panel)}
                  onFocus={() => setHover(s.panel)}
                  onBlur={() => setHover(null)}
                  onClick={() => onOpen?.(s.panel, row.swatches.map((x) => x.panel))}
                />
              ))}
            </div>
            <span className="w-6 shrink-0 text-right text-[9px] tabular-nums" style={{ color: INK_MUTED }}>
              {row.swatches.length}
            </span>
          </div>
        ))}
      </div>
      {/* Fixed height, one line: the readout never shifts the charts below */}
      <div className="mt-1.5 h-[14px] leading-[14px] text-[10px] truncate" style={{ color: INK_MUTED }}>
        {hover
          ? describePanel(hover)
          : `Each slice is one panel's leading color.${onOpen ? " Click to page through a decade in color order." : ""}`}
      </div>
    </div>
  );
}

function ColorSplit({ colorCount, bwCount }: { colorCount: number; bwCount: number }) {
  const total = colorCount + bwCount;
  if (total === 0) return null;
  const colorPct = Math.round((colorCount / total) * 100);
  return (
    <div>
      <div className="flex rounded-sm overflow-hidden" style={{ gap: 2, height: 13 }}>
        <div style={{ flex: Math.max(colorCount, 1), background: ACCENT, opacity: 0.9, borderRadius: "2px 3px 3px 2px" }} />
        <div style={{ flex: Math.max(bwCount, 1), background: NEUTRAL, opacity: 0.55, borderRadius: "3px 2px 2px 3px" }} />
      </div>
      <div className="flex justify-between mt-1.5 text-[10px]" style={{ color: INK_MUTED }}>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-[2px]" style={{ background: ACCENT, opacity: 0.9 }} />
          Color · {colorCount} ({colorPct}%)
        </span>
        <span className="inline-flex items-center gap-1.5">
          B&amp;W · {bwCount} ({100 - colorPct}%)
          <span className="inline-block w-2 h-2 rounded-[2px]" style={{ background: NEUTRAL, opacity: 0.55 }} />
        </span>
      </div>
    </div>
  );
}

// Tab

export default function StatsTab({
  panels,
  onFilter,
  onOpenPanel,
}: {
  panels: Panel[];
  onFilter?: (patch: StatsFilterPatch) => void;
  onOpenPanel?: StatsOpenPanel;
}) {
  const [meta, setMeta] = useState<MetaStats | null>(null);
  const [metaFailed, setMetaFailed] = useState(false);

  const stats = useMemo(
    () => (panels.length > 0 ? computePanelStats(panels) : null),
    [panels],
  );

  useEffect(() => {
    let cancelled = false;
    loadMetadata()
      .then(({ artists, series, issues }) => {
        if (!cancelled) setMeta(computeMetaStats(panels, artists, series, issues));
      })
      .catch(() => {
        // metadata is optional — panel-derived stats still render
        if (!cancelled) setMetaFailed(true);
      });
    return () => { cancelled = true; };
  }, [panels]);

  if (!stats) {
    return (
      <p className="px-6 pt-5 text-[12px]" style={{ color: INK_MUTED }}>
        No panels loaded yet.
      </p>
    );
  }

  const seriesCount = new Set(panels.map((p) => p.slug)).size;
  const years = panels.map((p) => p.year).filter((y) => y > 0);
  const yearSpan = `${Math.min(...years)}–${Math.max(...years)}`;

  const superlatives: Superlative[] = [];
  if (stats.oldestPanel) {
    const p = stats.oldestPanel;
    superlatives.push({
      key: "oldest-panel",
      label: "Oldest panel",
      value: String(p.year),
      detail: `${p.title} ${formatIssue(p.issue)} · ${p.artist}`,
      panel: p,
    });
  }
  if (stats.career) {
    const { artist, span, panels: work } = stats.career;
    // Shown by the earliest panel; opening it pages through the career in order
    superlatives.push({
      key: "longest-career",
      label: "Longest career",
      value: String(span),
      unit: "years",
      detail: `${artist}, ${work[0].year}–${work[work.length - 1].year}`,
      panel: work[0],
      group: work,
    });
  }
  for (const [key, label, pick] of [
    ["youngest-artist", "Youngest artist", meta?.youngest],
    ["oldest-artist", "Oldest artist", meta?.oldest],
  ] as const) {
    if (!pick) continue;
    superlatives.push({
      key,
      label,
      value: String(pick.age),
      unit: "years old",
      detail: `${pick.panel.artist}, ${pick.panel.title} (${pick.panel.year})`,
      panel: pick.panel,
    });
  }
  const agePending = !meta && !metaFailed;

  return (
    <div className="px-6 pt-5 pb-6">
      <p className="text-[12px] leading-relaxed mb-5" style={{ color: INK_MUTED }}>
        A running census of the collection: where the panels come from, who made
        them, and when.{onFilter ? " Click a bar to filter the gallery by it." : ""}
      </p>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-2.5 mb-7">
        <StatTile label="Panels" value={panels.length} />
        <StatTile label="Series" value={seriesCount} />
        <StatTile label="Creators credited" value={meta ? meta.creatorCount : "…"} />
        <StatTile label="Years spanned" value={yearSpan} />
      </div>

      <div className="flex flex-col gap-7">
        {superlatives.length > 0 && (
          <section>
            <SectionTitle
              title="RECORD HOLDERS"
              note={onOpenPanel ? "click one to open it" : undefined}
            />
            <div className="grid grid-cols-2 gap-2.5">
              {superlatives.map((s) => (
                <SuperlativeTile key={s.key} s={s} onOpen={onOpenPanel} />
              ))}
              {agePending && (
                <>
                  <SuperlativePlaceholder />
                  <SuperlativePlaceholder />
                </>
              )}
            </div>
          </section>
        )}

        <section>
          <SectionTitle title="PANELS BY DECADE" />
          <ColumnChart data={stats.decades} onFilter={onFilter} />
        </section>

        {stats.palette.length > 0 && (
          <section>
            <SectionTitle title="PALETTE BY DECADE" note="sorted by hue, B&W last" />
            <DecadePalette rows={stats.palette} onOpen={onOpenPanel} />
          </section>
        )}

        <section>
          <SectionTitle title="COLOR VS B&W" note={`colorfulness ≥ ${COLORFULNESS_THRESHOLD}`} />
          <ColorSplit colorCount={stats.colorCount} bwCount={stats.bwCount} />
        </section>

        {meta && meta.ages.length > 0 && (
          <section>
            <SectionTitle
              title="ARTIST'S AGE AT PUBLICATION"
              note={`median ${meta.medianAge} · ${meta.agedPanelCount} panels with a known birth year`}
            />
            <ColumnChart data={meta.ages} />
          </section>
        )}

        {meta && meta.credited.length > 0 && (
          <section>
            <SectionTitle
              title="MOST CREDITED"
              note="art, writing, colors & letters"
            />
            <HBars data={meta.credited} onFilter={onFilter} />
          </section>
        )}

        {meta && meta.roles.length > 0 && (
          <section>
            <SectionTitle
              title="CREDITS BY ROLE"
              note={`across ${meta.creditedIssueCount} documented issues`}
            />
            <HBars data={meta.roles} />
          </section>
        )}

        {meta && meta.countries.length > 0 && (
          <section>
            <SectionTitle
              title="ARTISTS BY COUNTRY"
              note={`${meta.countryKnown} of ${meta.countryTotal} artists known`}
            />
            <HBars data={meta.countries} onFilter={onFilter} unit="artist" />
          </section>
        )}

        {meta && meta.publishers.length > 0 && (
          <section>
            <SectionTitle title="PUBLISHERS" note="panels per label" />
            <HBars data={meta.publishers} onFilter={onFilter} />
          </section>
        )}

        {stats.tags.length > 0 && (
          <section>
            <SectionTitle title="TOP TAGS" />
            <HBars data={stats.tags} onFilter={onFilter} />
          </section>
        )}
      </div>
    </div>
  );
}
