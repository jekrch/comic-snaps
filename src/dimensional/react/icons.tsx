/**
 * The few icons the shell uses, inline so the framework carries no icon
 * library. Stroked at 1.5 on a 24 grid, sized by `size`.
 */
type IconProps = { size?: number; className?: string };

function Icon({ size = 16, className, d }: IconProps & { d: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export const ArrowLeft = (p: IconProps) => <Icon {...p} d="M19 12H5M12 19l-7-7 7-7" />;
export const ArrowRight = (p: IconProps) => <Icon {...p} d="M5 12h14M12 5l7 7-7 7" />;
export const Menu = (p: IconProps) => <Icon {...p} d="M4 6h16M4 12h16M4 18h16" />;
export const Close = (p: IconProps) => <Icon {...p} d="M18 6 6 18M6 6l12 12" />;
export const Check = (p: IconProps) => <Icon {...p} d="M20 6 9 17l-5-5" />;
export const ChevronDown = (p: IconProps) => <Icon {...p} d="m6 9 6 6 6-6" />;
export const ChevronUp = (p: IconProps) => <Icon {...p} d="m18 15-6-6-6 6" />;
export const Expand = (p: IconProps) => <Icon {...p} d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />;
export const Collapse = (p: IconProps) => <Icon {...p} d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />;
