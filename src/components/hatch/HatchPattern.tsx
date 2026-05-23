interface HatchPatternProps {
  id: string;
  rotation: number;
  color: string;
}

/** A single line repeating at an angle — the building block of the hatch fill. */
export default function HatchPattern({ id, rotation, color }: HatchPatternProps) {
  return (
    <pattern
      id={id}
      width="8"
      height="8"
      patternUnits="userSpaceOnUse"
      patternTransform={`rotate(${rotation})`}
    >
      <line x1="0" y1="0" x2="0" y2="8" stroke={color} strokeWidth="8" />
    </pattern>
  );
}
