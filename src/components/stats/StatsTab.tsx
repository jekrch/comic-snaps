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
import { AGE_BIN, ageBinKey, ageBinStart } from "../../utils/artistAge";

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
  Record<"decades" | "tags" | "artists" | "colorists" | "letterers" | "credits" | "series" | "ages", string[]>
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

interface DecadeDatum {
  label: string;
  color: number;
  bw: number;
  count: number;
  filter: StatsFilterPatch;
}

/** One wedge of the hue wheel: the color panels whose leading hue falls in it. */
interface HueBin {
  name: string;
  /** Wedge start, in CIELAB hue degrees. */
  start: number;
  /** An idealized swatch of the wedge's middle hue, not a mean of the panels. */
  css: string;
  /** Members in hue order, so paging through them in the viewer is a sweep. */
  panels: Panel[];
}

interface ComputedStats {
  decades: DecadeDatum[];
  colorCount: number;
  bwCount: number;
  tags: NamedCount[];
  hues: HueBin[];
  huedCount: number;
  oldestPanel: Panel | null;
  career: Career | null;
  ages: ColumnDatum[];
  agedPanelCount: number;
  medianAge: number | null;
  youngest: AgePick | null;
  oldest: AgePick | null;
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
  countries: NamedCount[];
  countryKnown: number;
  countryTotal: number;
}

const decadeLabel = (d: number) => `'${String(d).slice(2)}s`;

const labCss = ([L, a, b]: [number, number, number]) => `lab(${L} ${a} ${b})`;

// Chroma a dominant color needs before it counts as the panel's hue — the same
// cut the COLOR sort uses, so the wheel agrees with that sort's order.
const HUE_CHROMA = 10;

/**
 * CIELAB hue (degrees) of a color panel's first strongly chromatic dominant
 * color, or null for B&W pages and color panels too muted to have one.
 */
function hueOf(p: Panel): number | null {
  if ((p.colorfulness ?? 0) < COLORFULNESS_THRESHOLD) return null;
  for (const [, a, b] of p.dominantColors ?? []) {
    if (Math.hypot(a, b) >= HUE_CHROMA) {
      const h = (Math.atan2(b, a) * 180) / Math.PI;
      return h < 0 ? h + 360 : h;
    }
  }
  return null;
}

// Twelve 30° wedges. Names are for CIELAB hue angles, where red sits near 40°
// and blue near 300°, not the HSL wheel's 0° and 240°.
const HUE_NAMES = [
  "Pink", "Red", "Orange", "Yellow", "Olive", "Green",
  "Teal", "Cyan", "Azure", "Blue", "Violet", "Magenta",
];
const HUE_STEP = 360 / HUE_NAMES.length;

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
  const isColor = (p: Panel) => (p.colorfulness ?? 0) >= COLORFULNESS_THRESHOLD;
  const colorByDecade = new Map<number, number>();
  for (const p of panels) {
    if (p.year > 0 && isColor(p)) {
      const d = Math.floor(p.year / 10) * 10;
      colorByDecade.set(d, (colorByDecade.get(d) ?? 0) + 1);
    }
  }
  const decades = [...byDecade.entries()].map(([d, count]) => {
    const color = colorByDecade.get(d) ?? 0;
    return {
      label: decadeLabel(d),
      color,
      bw: count - color,
      count,
      filter: { decades: [`${d}s`] },
    };
  });

  const binned = HUE_NAMES.map(() => [] as { panel: Panel; hue: number }[]);
  for (const p of panels) {
    const hue = hueOf(p);
    if (hue !== null) binned[Math.floor(hue / HUE_STEP) % HUE_NAMES.length].push({ panel: p, hue });
  }
  const hues = HUE_NAMES.map((name, i) => {
    const mid = ((i + 0.5) * HUE_STEP * Math.PI) / 180;
    return {
      name,
      start: i * HUE_STEP,
      css: labCss([66, 48 * Math.cos(mid), 48 * Math.sin(mid)]),
      panels: binned[i].sort((a, b) => a.hue - b.hue).map((x) => x.panel),
    };
  });
  const huedCount = binned.reduce((sum, list) => sum + list.length, 0);

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
  for (const p of panels) if (isColor(p)) colorCount++;

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
    hues,
    huedCount,
    oldestPanel,
    career,
    ...computeAgeStats(panels),
  };
}

/** Artist's age at publication, from the age each panel carries (see
 *  `artistAgeAt`). Each bar filters the gallery to its age bracket. */
function computeAgeStats(panels: Panel[]) {
  const aged: AgePick[] = [];
  for (const p of panels) {
    if (p.artistAge != null) aged.push({ panel: p, age: p.artistAge });
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

  const lo = ageBinStart(youngest.age);
  const hi = ageBinStart(oldest.age);
  const bins = new Map<number, number>();
  for (let b = lo; b <= hi; b += AGE_BIN) bins.set(b, 0);
  for (const { age } of aged) {
    const b = ageBinStart(age);
    bins.set(b, (bins.get(b) ?? 0) + 1);
  }
  const ages = [...bins.entries()].map(([b, count]) => ({
    label: String(b),
    name: `Age ${b}–${b + AGE_BIN - 1}`,
    count,
    ...(count > 0 && { filter: { ages: [ageBinKey(b)] } }),
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
          <Tooltip content={<ChartTip unit={unit} />} shared={false} cursor={false} />
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
          <Tooltip content={<ChartTip />} shared={false} cursor={false} />
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

/** A bar segment's outline with only its top corners rounded. */
function topRoundedPath(x: number, y: number, w: number, h: number, r: number): string {
  if (!(w > 0) || !(h > 0)) return "";
  const k = Math.min(r, w / 2, h);
  return (
    `M${x},${y + h} L${x},${y + k} Q${x},${y} ${x + k},${y} ` +
    `L${x + w - k},${y} Q${x + w},${y} ${x + w},${y + k} L${x + w},${y + h} Z`
  );
}

// Surface gap between the color and B&W segments of a stacked bar
const SEGMENT_GAP = 2;
const BAR_RADIUS = 3;

function DecadeTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as DecadeDatum;
  return (
    <div
      className="rounded-md px-3 py-2 text-[11px] border"
      style={{
        background: "var(--color-surface-hover, #1a1a1a)",
        borderColor: "var(--color-border, rgba(74,71,69,0.35))",
        color: "var(--color-ink)",
      }}
    >
      <span>{d.label}</span>
      <span style={{ color: INK_MUTED }}> · {d.count} panel{d.count === 1 ? "" : "s"}</span>
      {d.count > 0 && (
        <div className="mt-0.5" style={{ color: INK_MUTED }}>
          {d.color} color · {d.bw} B&amp;W
        </div>
      )}
    </div>
  );
}

/**
 * Panels per decade, each bar split into color (on the baseline) and B&W
 * stacked on top, so the arrival of color reads straight off the decades.
 */
function DecadeColorChart({
  data,
  colorCount,
  bwCount,
  onFilter,
}: {
  data: DecadeDatum[];
  colorCount: number;
  bwCount: number;
  onFilter?: (patch: StatsFilterPatch) => void;
}) {
  const total = colorCount + bwCount;
  const colorPct = total ? Math.round((colorCount / total) * 100) : 0;
  const click = (entry: any) => {
    const filter = entry?.payload?.filter ?? entry?.filter;
    if (filter && onFilter) onFilter(filter);
  };
  const cursor = onFilter ? "pointer" : undefined;
  return (
    <div>
      <div style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -22 }} accessibilityLayer={false}>
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
            <Tooltip content={<DecadeTip />} shared={false} cursor={false} />
            <Bar
              dataKey="color"
              stackId="decade"
              maxBarSize={22}
              isAnimationActive={false}
              cursor={cursor}
              onClick={click}
              shape={(props: any) => (
                <path
                  d={topRoundedPath(
                    props.x, props.y, props.width, props.height,
                    // Rounded only when nothing is stacked on it
                    props.payload?.bw > 0 ? 0 : BAR_RADIUS,
                  )}
                  fill={ACCENT}
                  fillOpacity={0.9}
                />
              )}
            />
            <Bar
              dataKey="bw"
              stackId="decade"
              maxBarSize={22}
              isAnimationActive={false}
              cursor={cursor}
              onClick={click}
              shape={(props: any) => {
                const gap = props.payload?.color > 0 ? SEGMENT_GAP : 0;
                return (
                  <path
                    d={topRoundedPath(props.x, props.y, props.width, props.height - gap, BAR_RADIUS)}
                    fill={NEUTRAL}
                    fillOpacity={0.55}
                  />
                );
              }}
            />
          </BarChart>
        </ResponsiveContainer>
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

/**
 * Color panels by leading hue, as a rose: one wedge per 30° of CIELAB hue,
 * painted in that hue, with area (not radius) proportional to the count. A
 * thin key ring inside shows every hue, so an empty wedge reads as a color the
 * collection lacks rather than as a gap in the chart.
 */
function HueWheel({
  bins,
  total,
  onOpen,
}: {
  bins: HueBin[];
  total: number;
  onOpen?: StatsOpenPanel;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const C = 100;
  const R = 94;
  const R0 = 40;
  const KEY_IN = 34;
  const PAD = 1.2;
  const max = Math.max(1, ...bins.map((b) => b.panels.length));

  const at = (r: number, deg: number) => {
    const t = ((deg - 90) * Math.PI) / 180;
    return `${(C + r * Math.cos(t)).toFixed(2)} ${(C + r * Math.sin(t)).toFixed(2)}`;
  };
  const sector = (rIn: number, rOut: number, a0: number, a1: number) =>
    `M${at(rOut, a0)} A${rOut} ${rOut} 0 0 1 ${at(rOut, a1)} ` +
    `L${at(rIn, a1)} A${rIn} ${rIn} 0 0 0 ${at(rIn, a0)} Z`;

  const open = (i: number) => {
    const group = bins[i].panels;
    if (onOpen && group.length > 0) onOpen(group[0], group);
  };
  const hovered = hover !== null ? bins[hover] : null;
  const ink = { fill: "var(--color-ink)" };
  const muted = { fill: "var(--color-ink-muted, #9e9892)" };

  return (
    <svg
      viewBox="0 0 200 200"
      className="block mx-auto w-full"
      style={{ maxWidth: 230 }}
      onMouseLeave={() => setHover(null)}
      role="group"
      aria-label={`${total} color panels by leading hue`}
    >
      <circle cx={C} cy={C} r={R} fill="none" stroke={HAIRLINE} />
      {bins.map((b, i) => {
        const a0 = b.start + PAD;
        const a1 = b.start + HUE_STEP - PAD;
        const n = b.panels.length;
        // Area-true: the wedge's annular area grows linearly with its count
        const rOut = Math.sqrt(R0 * R0 + ((R * R - R0 * R0) * n) / max);
        const dim = hover !== null && hover !== i;
        return (
          <g key={b.name}>
            <path d={sector(KEY_IN, R0 - 2, a0, a1)} fill={b.css} fillOpacity={dim ? 0.2 : 0.45} />
            {n > 0 && (
              <path
                d={sector(R0, rOut, a0, a1)}
                fill={b.css}
                fillOpacity={dim ? 0.3 : 0.95}
                style={{ transition: "fill-opacity 120ms" }}
                pointerEvents="none"
              />
            )}
            {n > 0 && (
              // Hit target spans the whole wedge, so a one-panel sliver is
              // as easy to point at as the biggest one
              <path
                d={sector(KEY_IN, R, a0, a1)}
                fill="transparent"
                tabIndex={onOpen ? 0 : -1}
                role={onOpen ? "button" : undefined}
                aria-label={`${b.name}: ${n} panel${n === 1 ? "" : "s"}`}
                style={{ cursor: onOpen ? "pointer" : "default", outline: "none" }}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                onClick={() => open(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    open(i);
                  }
                }}
              />
            )}
          </g>
        );
      })}
      <text x={C} y={C - 1} textAnchor="middle" fontSize={hovered ? 13 : 17} style={{ ...ink, fontFamily: "var(--font-display)" }}>
        {hovered ? hovered.name : total}
      </text>
      <text x={C} y={C + 12} textAnchor="middle" fontSize={8} style={muted}>
        {hovered
          ? `${hovered.panels.length} panel${hovered.panels.length === 1 ? "" : "s"}`
          : "color panels"}
      </text>
    </svg>
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
      // metadata is optional — panel-derived stats still render
      .catch(() => {});
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
    ["youngest-artist", "Youngest artist", stats.youngest],
    ["oldest-artist", "Oldest artist", stats.oldest],
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
            </div>
          </section>
        )}

        <section>
          <SectionTitle title="PANELS BY DECADE" note={`color vs B&W at colorfulness ≥ ${COLORFULNESS_THRESHOLD}`} />
          <DecadeColorChart
            data={stats.decades}
            colorCount={stats.colorCount}
            bwCount={stats.bwCount}
            onFilter={onFilter}
          />
        </section>

        {stats.huedCount > 0 && (
          <section>
            <SectionTitle
              title="HUES"
              note={`color panels by leading hue${onOpenPanel ? " · click a wedge to page through it" : ""}`}
            />
            <HueWheel bins={stats.hues} total={stats.huedCount} onOpen={onOpenPanel} />
          </section>
        )}

        {stats.ages.length > 0 && (
          <section>
            <SectionTitle
              title="ARTIST'S AGE AT PUBLICATION"
              note={`median ${stats.medianAge} · ${stats.agedPanelCount} panels with a known birth year`}
            />
            <ColumnChart data={stats.ages} onFilter={onFilter} />
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
