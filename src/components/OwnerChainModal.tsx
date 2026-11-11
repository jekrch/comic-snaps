import { useMemo } from "react";
import type { Panel } from "../types";
import type { OwnerBadge } from "../utils/owners";
import { ownershipChain } from "../utils/owners";
import { usePublisherIndex, useOwnershipIndex } from "../hooks/useMetadata";
import { formatIssue } from "../utils/issueFormat";
import OwnershipTree from "./OwnershipTree";
import WallModal from "./WallModal";

interface Props {
  panel: Panel;
  badge: OwnerBadge;
  onClose: () => void;
  /** Open a house's page, over this panel in the viewer. */
  onOpenPublisher: (panel: Panel, name: string) => void;
}

/**
 * The ladder behind a card's owner badge: the same tree the publisher page
 * ends on, from the top of the chain down to the house the panel came out
 * under. Any house named on it opens that house's page in the viewer.
 */
export default function OwnerChainModal({ panel, badge, onClose, onOpenPublisher }: Props) {
  const publishers = usePublisherIndex();
  const ownership = useOwnershipIndex();
  const steps = useMemo(
    () => ownershipChain(badge.house, publishers, ownership),
    [badge.house, publishers, ownership]
  );
  const status = steps?.[0]?.owner?.status ?? badge.status;

  return (
    <WallModal
      eyebrow={status ? `Ownership · ${status}` : "Owned by"}
      title={badge.name}
      label={`Who owns ${badge.house.name}`}
      onClose={onClose}
      footer={(close) => (
        <button
          type="button"
          onClick={() => close(() => onOpenPublisher(panel, badge.house.name))}
          className="font-display text-[11px] tracking-wider uppercase text-accent hover:text-accent-dim transition-colors cursor-pointer"
        >
          {badge.house.name} profile →
        </button>
      )}
    >
      {(close) => {
        const openHouse = (name: string) => close(() => onOpenPublisher(panel, name));
        return (
          <>
            <p className="m-0 mb-4 text-[11px] leading-relaxed text-ink-muted">
              <span className="text-ink/80">{panel.title}</span>
              {panel.issue !== "" && <> {formatIssue(panel.issue)}</>}
              {panel.year > 0 && <span className="tabular-nums"> ({panel.year})</span>} came out under{" "}
              <span className="text-ink/80">{badge.house.name}</span>.
            </p>
            {steps ? (
              <OwnershipTree steps={steps} year={panel.year > 0 ? panel.year : null} onOpenPublisher={openHouse} />
            ) : (
              <p className="m-0 text-[11px] text-ink-muted">No owner on record for {badge.house.name}.</p>
            )}
          </>
        );
      }}
    </WallModal>
  );
}
