import { ballLook, stripePath } from "../view/ballLook";
import { useDrawStyle } from "../view/drawStyleContext";

/** Fraction of the radius the stripe band extends either side of the middle. */
const STRIPE_HALF_BAND = 0.55;
/** Radius of the white number disc, as a fraction of the ball radius. */
const LABEL_DISC = 0.46;
/** The ball radius in the units the label text is drawn in, before it is scaled to size. */
export const LABEL_UNITS = 32;

export interface BallBodyProps {
  kind: string;
  /** Radius, in the units of the surrounding SVG. The ball is centred on the origin. */
  r: number;
}

/** A ball seen from above, centred on the origin. Used on the table and in the palette. */
export function BallBody({ kind, r }: BallBodyProps) {
  const look = ballLook(kind);
  const { colours, ballLabels } = useDrawStyle();
  return (
    <g aria-hidden="true">
      <circle r={r} fill={look.striped ? "#fbfaf2" : look.colour} />
      {look.striped ? <path d={stripePath(r, r * STRIPE_HALF_BAND)} fill={look.colour} /> : null}
      {look.label && ballLabels ? (
        <>
          <circle r={r * LABEL_DISC} fill="#fbfaf2" />
          {/* Drawn at a normal font size and scaled down: browsers clamp or misdraw the tiny
              font sizes that a drawing in metres would need. */}
          <text
            transform={`scale(${String(r / LABEL_UNITS)})`}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={LABEL_UNITS * (look.label.length > 1 ? 0.5 : 0.62)}
            fontWeight={700}
            fontFamily="system-ui, sans-serif"
            fill="#141414"
          >
            {look.label}
          </text>
        </>
      ) : null}
      <circle
        r={r}
        fill="none"
        stroke={colours.ballOutline}
        strokeOpacity={colours.ballOutlineOpacity}
        strokeWidth={r * colours.ballOutlineWidth}
      />
      <circle cx={-r * 0.3} cy={-r * 0.35} r={r * 0.2} fill="#ffffff" fillOpacity={0.22} />
    </g>
  );
}
