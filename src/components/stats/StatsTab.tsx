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
import type { Panel, IssueCredits, Series } from "../../types";
import { loadMetadata } from "../../utils/metadata";

// Chart palette — validated against the app surface (#141414) with the
// dataviz six-checks script: accent passes all four; gray is the deliberate
// neutral (B&W split, "Other" fold) and is always paired with direct labels.
const ACCENT = "#e85d3a";
const NEUTRAL = "#8a857f";

const INK_MUTED = "var(--color-ink-muted, rgba(160,155,150,0.7))";
const HAIRLINE = "rgba(255,255,255,0.07)";

// Same threshold the color sort uses to partition chromatic vs achromatic.
const COLORFULNESS_THRESHOLD = 6;

// The creative roles the "most credited" chart counts; editorial/production
// credits (Editor, Designer, Publisher, …) are excluded.
const CREDIT_ROLES = ["Artist", "Writer", "Colorist", "Letterer"];

/** Gallery filter selections a clicked bar can apply — keys match Filters. */
export type StatsFilterPatch = Partial<
  Record<"decades" | "tags" | "artists" | "colorists" | "letterers" | "credits" | "series", string[]>
>;

interface NamedCount {
  name: string;
  count: number;
  roles?: string[];
  isOther?: boolean;
  filter?: StatsFilterPatch;
}

interface ComputedStats {
  decades: { label: string; count: number; filter: StatsFilterPatch }[];
  colorCount: number;
  bwCount: number;
  tags: NamedCount[];
}

interface MetaStats {
  credited: NamedCount[];
  roles: NamedCount[];
  publishers: NamedCount[];
  creditedIssueCount: number;
  creatorCount: number;
}

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
    label: `'${String(d).slice(2)}s`,
    count,
    filter: { decades: [`${d}s`] },
  }));

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

  return { decades, colorCount, bwCount: panels.length - colorCount, tags };
}

function computeMetaStats(
  panels: Panel[],
  series: Series[],
  issues: IssueCredits[],
): MetaStats {
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

  for (const p of panels) {
    allCreators.add(p.artist);

    const issue = issueByKey.get(`${p.slug}|${p.issue}`);
    if (issue) {
      linkedIssueIds.add(issue.id);
      for (const c of issue.credits) {
        allCreators.add(c.name);
        const creativeRoles = c.roles.filter((r) => CREDIT_ROLES.includes(r));
        if (creativeRoles.length === 0) continue;
        personPanels.set(c.name, (personPanels.get(c.name) ?? 0) + 1);
        let roles = personRoles.get(c.name);
        if (!roles) personRoles.set(c.name, (roles = new Set()));
        for (const r of creativeRoles) roles.add(r);
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

  // Role frequency across the linked issues (one count per person per issue).
  const roleCounts = new Map<string, number>();
  for (const i of issues) {
    if (!linkedIssueIds.has(i.id)) continue;
    for (const c of i.credits) {
      for (const r of c.roles) roleCounts.set(r, (roleCounts.get(r) ?? 0) + 1);
    }
  }
  const roles = topWithOther(roleCounts, 8);

  return {
    credited,
    roles,
    publishers,
    creditedIssueCount: linkedIssueIds.size,
    creatorCount: allCreators.size,
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

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const datum = payload[0].payload as NamedCount & { label?: string };
  const title = datum.name ?? label;
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
      <span style={{ color: INK_MUTED }}> · {payload[0].value} panel{payload[0].value === 1 ? "" : "s"}</span>
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
}: {
  data: NamedCount[];
  onFilter?: (patch: StatsFilterPatch) => void;
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
          <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
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

function DecadeChart({
  decades,
  onFilter,
}: {
  decades: ComputedStats["decades"];
  onFilter?: (patch: StatsFilterPatch) => void;
}) {
  return (
    <div style={{ height: 160 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={decades}
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
            cursor={onFilter ? "pointer" : undefined}
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
}: {
  panels: Panel[];
  onFilter?: (patch: StatsFilterPatch) => void;
}) {
  const [meta, setMeta] = useState<MetaStats | null>(null);

  const stats = useMemo(
    () => (panels.length > 0 ? computePanelStats(panels) : null),
    [panels],
  );

  useEffect(() => {
    let cancelled = false;
    loadMetadata()
      .then(({ series, issues }) => {
        if (!cancelled) setMeta(computeMetaStats(panels, series, issues));
      })
      .catch(() => {
        // metadata is optional — panel-derived stats still render
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
        <section>
          <SectionTitle title="PANELS BY DECADE" />
          <DecadeChart decades={stats.decades} onFilter={onFilter} />
        </section>

        <section>
          <SectionTitle title="COLOR VS B&W" note={`colorfulness ≥ ${COLORFULNESS_THRESHOLD}`} />
          <ColorSplit colorCount={stats.colorCount} bwCount={stats.bwCount} />
        </section>

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
