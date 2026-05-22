// Format an issue identifier for display. Numeric issues get a `#` prefix
// (e.g. `#5`); free-form text (e.g. `VOL 1`) is shown verbatim.
export function formatIssue(issue: number | string): string {
  return typeof issue === "number" ? `#${issue}` : issue;
}
