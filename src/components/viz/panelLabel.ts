import type { Panel } from "../../types";
import { formatIssue } from "../../utils/issueFormat";

/** The line that names what is on screen. */
export function panelName(panel: Panel): string {
  return panel.local ? panel.title : `${panel.title} ${formatIssue(panel.issue)}`;
}

/**
 * The line under it: who made it, and when.
 *
 * Null for an image the reader brought themselves — the attribution label is
 * there to credit the artist of a panel, and there is no honest thing to put
 * under a filename. Its absence is the whole label for those runs.
 */
export function panelCredit(panel: Panel): string | null {
  return panel.local ? null : `${panel.artist} · ${panel.year}`;
}
