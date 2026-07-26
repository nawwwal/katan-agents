import type { SVGProps } from 'react'
import type { DevelopmentCard, Resource } from '../game/types'

type IconProps = SVGProps<SVGSVGElement>

/**
 * One icon language for the whole interface: a 24-unit grid, a solid
 * `currentColor` silhouette carrying the shape, and a single inset shadow tone
 * (`--icon-shade`) for the engraved detail. That keeps every glyph readable as
 * a 16px pip in a cost row and still detailed as a 64px card face, without
 * hairlines that disappear or strokes that clog.
 */
const Base = ({ children, ...props }: IconProps) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...props}>{children}</svg>
)

const shade = 'var(--icon-shade, rgba(23, 14, 8, .46))'

/* ---------------------------------------------------------------- resources */

export const BrickIcon = (props: IconProps) => <Base {...props}>
  <path d="M2 6.2A1.2 1.2 0 0 1 3.2 5h17.6A1.2 1.2 0 0 1 22 6.2v11.6a1.2 1.2 0 0 1-1.2 1.2H3.2A1.2 1.2 0 0 1 2 17.8V6.2Z" fill="currentColor" />
  <path d="M2 9.4h20v1.1H2V9.4Zm0 4.1h20v1.1H2v-1.1ZM8.6 5v4.4H7.5V5h1.1Zm7 0v4.4h-1.1V5h1.1ZM5.2 10.5v3h-1.1v-3h1.1Zm6.9 0v3H11v-3h1.1Zm7 0v3h-1.1v-3h1.1ZM8.6 14.6V19H7.5v-4.4h1.1Zm7 0V19h-1.1v-4.4h1.1Z" fill={shade} />
</Base>

export const LumberIcon = (props: IconProps) => <Base {...props}>
  <path d="M12 1.6 15 6l-1.5-.3 2.6 4.3-1.6-.4 3 5.1H6.5l3-5.1-1.6.4L10.5 5.7 9 6l3-4.4Z" fill="currentColor" />
  <path d="M10.6 15.1h2.8l.6 5.3a1.4 1.4 0 0 1-1.4 1.6h-1.2a1.4 1.4 0 0 1-1.4-1.6l.6-5.3Z" fill={shade} />
  <path d="M4 21.2h16a.8.8 0 0 1 0 1.6H4a.8.8 0 0 1 0-1.6Z" fill="currentColor" opacity=".55" />
</Base>

export const OreIcon = (props: IconProps) => <Base {...props}>
  <path d="M11.4 2.4a1.2 1.2 0 0 1 1.2 0l8 4.7a1.2 1.2 0 0 1 .6 1V17a1.2 1.2 0 0 1-.6 1l-8 4.7a1.2 1.2 0 0 1-1.2 0l-8-4.7a1.2 1.2 0 0 1-.6-1V8.1a1.2 1.2 0 0 1 .6-1l8-4.7Z" fill="currentColor" />
  <path d="M12 2.9v9.4l-8.6-5 .6-.4L12 2.4l8 4.5.6.4-8.6 5V2.9Zm0 10.6 8.9-5.2v.9L12.6 14v8.7h-1.2V14L2.9 9.2v-.9L12 13.5Z" fill={shade} />
</Base>

export const GrainIcon = (props: IconProps) => <Base {...props}>
  <path d="M11.3 8.6h1.4V22h-1.4V8.6Z" fill="currentColor" />
  <path d="M12 1.4c1.6 1.3 2.4 2.7 2.4 4.2S13.6 8.5 12 9.8C10.4 8.5 9.6 7.1 9.6 5.6S10.4 2.7 12 1.4Zm-3.3 3.9c1.5.5 2.5 1.3 3 2.3.5 1 .4 2.2-.2 3.6-1.5-.5-2.5-1.2-3-2.3-.5-1-.4-2.2.2-3.6Zm6.6 0c.6 1.4.7 2.6.2 3.6-.5 1.1-1.5 1.8-3 2.3-.6-1.4-.7-2.6-.2-3.6.5-1 1.5-1.8 3-2.3ZM8.1 10.7c1.5.5 2.5 1.2 3 2.3.5 1 .4 2.2-.2 3.6-1.5-.5-2.5-1.3-3-2.3-.5-1-.4-2.2.2-3.6Zm7.8 0c.6 1.4.7 2.6.2 3.6-.5 1-1.5 1.8-3 2.3-.6-1.4-.7-2.6-.2-3.6.5-1.1 1.5-1.8 3-2.3Z" fill="currentColor" />
  <path d="M11.3 8.6h1.4V22h-1.4V8.6Z" fill={shade} />
</Base>

export const WoolIcon = (props: IconProps) => <Base {...props}>
  {/* Fleece mass plus a dark head and legs — the silhouette has to read as a sheep at 16px, not a cloud. */}
  <path d="M5.8 16.6h1.9v3.9a1 1 0 1 1-1.9 0v-3.9Zm4.4 0h1.9v3.9a1 1 0 1 1-1.9 0v-3.9Z" fill={shade} />
  <path d="M6.2 6.2a3 3 0 0 1 2.4-1.4 3 3 0 0 1 2.4 1.1 3 3 0 0 1 3.4 1.9 2.9 2.9 0 0 1 .6 5.5 3 3 0 0 1-2.9 3.5H6.4a3 3 0 0 1-2.9-3.5 2.9 2.9 0 0 1 .5-5.6 3 3 0 0 1 2.2-1.5Z" fill="currentColor" />
  <path d="M16.4 5.6a3.6 3.6 0 0 1 3.6 3.6c0 1.4-.8 2.6-2 3.2v2a1 1 0 1 1-2 0v-1.6h-.7v1.6a1 1 0 1 1-2 0v-2.4a3.6 3.6 0 0 1 3.1-6.4Z" fill={shade} />
  <circle cx="18.4" cy="9" r=".85" fill="currentColor" />
</Base>

/* ------------------------------------------------------ pieces and awards */

export const RoadIcon = (props: IconProps) => <Base {...props}>
  <path d="M8.6 2.4h6.8l4.4 19.2H4.2L8.6 2.4Z" fill="currentColor" />
  <path d="M11.2 4.4h1.6l.3 3.2h-2.2l.3-3.2Zm-.5 5.2h2.6l.3 3.4h-3.2l.3-3.4Zm-.6 5.4h3.8l.4 4h-4.6l.4-4Z" fill={shade} />
</Base>

export const SettlementIcon = (props: IconProps) => <Base {...props}>
  <path d="M11.4 2.4a1 1 0 0 1 1.2 0l9 6.3a1 1 0 0 1-.6 1.8h-1.4v10.3a1.2 1.2 0 0 1-1.2 1.2H5.6a1.2 1.2 0 0 1-1.2-1.2V10.5H3a1 1 0 0 1-.6-1.8l9-6.3Z" fill="currentColor" />
  <path d="M9.8 13.4h4.4a.8.8 0 0 1 .8.8V22H9V14.2a.8.8 0 0 1 .8-.8Z" fill={shade} />
</Base>

export const CityIcon = (props: IconProps) => <Base {...props}>
  <path d="M2.6 11.3h8.8a.9.9 0 0 1 .9.9V22H2.6a.9.9 0 0 1-.9-.9v-8.9a.9.9 0 0 1 .9-.9Z" fill="currentColor" />
  <path d="M15.8 1.4a.9.9 0 0 1 1 0l4.9 3.4a.9.9 0 0 1 .4.8V21a.9.9 0 0 1-.9.9h-9.6V5.6a.9.9 0 0 1 .4-.8l3.8-3.4Z" fill="currentColor" />
  <path d="M4.5 14.2h2.6v2.6H4.5v-2.6Zm0 4.6h2.6V22H4.5v-3.2Zm10-11h2.9v2.7h-2.9V7.8Zm0 5h2.9v2.7h-2.9v-2.7Zm0 5h2.9V22h-2.9v-4.2Z" fill={shade} />
</Base>

export const VictoryIcon = (props: IconProps) => <Base {...props}>
  <path d="m12 1.8 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 8.6l6.5-.9L12 1.8Z" fill="currentColor" />
  <path d="m12 5.5 1.8 3.6 4 .6-2.9 2.8.7 4L12 14.6l-3.6 1.9.7-4-2.9-2.8 4-.6L12 5.5Z" fill={shade} opacity=".55" />
</Base>

export const LongestRoadIcon = (props: IconProps) => <Base {...props}>
  <path d="M2.4 18.6c3.6 0 5.4-1.6 7.2-3.2 1.8-1.6 3.6-3.2 7.2-3.2h2.4V8.6l4.4 4-4.4 4v-3.6h-2.4c-2.6 0-3.8 1.1-5.6 2.7-1.9 1.7-4.3 3.7-8.8 3.7v-.8Z" fill="currentColor" />
  <path d="M1.6 15.6h3.2v3.8H1.6a1 1 0 0 1-1-1v-1.8a1 1 0 0 1 1-1Z" fill="currentColor" />
  <path d="M2.4 16.6h1.6v1.8H2.4v-1.8Zm14.4-3.2h2v1.4h-2v-1.4Z" fill={shade} />
</Base>

export const LargestArmyIcon = (props: IconProps) => <Base {...props}>
  <path d="M12 1.6 3.6 4.3v7.1c0 4.6 3.4 8.7 8.4 11 5-2.3 8.4-6.4 8.4-11V4.3L12 1.6Z" fill="currentColor" />
  <path d="M12 5.4a2.4 2.4 0 0 1 2.4 2.4c0 .9-.5 1.7-1.2 2.1l1.6 6.4a.6.6 0 0 1-.6.8h-4.4a.6.6 0 0 1-.6-.8l1.6-6.4a2.4 2.4 0 0 1-1.2-2.1A2.4 2.4 0 0 1 12 5.4Z" fill={shade} />
</Base>

export const RobberIcon = (props: IconProps) => <Base {...props}>
  <path d="M12 1.8a4 4 0 0 1 4 4v1.4a4 4 0 0 1-1.4 3l3.6 2.6a4 4 0 0 1 1.6 3.2V21a1.2 1.2 0 0 1-1.2 1.2H5.4A1.2 1.2 0 0 1 4.2 21v-5a4 4 0 0 1 1.6-3.2l3.6-2.6a4 4 0 0 1-1.4-3V5.8a4 4 0 0 1 4-4Z" fill="currentColor" />
  <path d="M9.4 14.4h5.2a.8.8 0 0 1 .8.9l-.5 5a.8.8 0 0 1-.8.7h-4.2a.8.8 0 0 1-.8-.7l-.5-5a.8.8 0 0 1 .8-.9Z" fill={shade} />
</Base>

export const HarborIcon = (props: IconProps) => <Base {...props}>
  <path d="M11.1 7.4h1.8V21a.9.9 0 0 1-1.8 0V7.4Z" fill="currentColor" />
  <path d="M12 1.6a2.9 2.9 0 1 1 0 5.8 2.9 2.9 0 0 1 0-5.8Zm0 1.8a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z" fill="currentColor" />
  <path d="M7.2 7.4h9.6a.9.9 0 0 1 0 1.8H7.2a.9.9 0 0 1 0-1.8Z" fill="currentColor" />
  <path d="M2.6 12.4h1.9a7.6 7.6 0 0 0 6.6 7.4v1.9A9.5 9.5 0 0 1 2.6 12.4Zm18.8 0a9.5 9.5 0 0 1-8.5 9.3v-1.9a7.6 7.6 0 0 0 6.6-7.4h1.9Z" fill="currentColor" />
  <path d="M11.1 9.2h1.8v3h-1.8v-3Z" fill={shade} />
</Base>

/* ------------------------------------------------------- development cards */

export const KnightIcon = (props: IconProps) => <Base {...props}>
  <path d="M6.6 21.4V17c-1.5-1.2-2.4-3-2.4-5.2 0-1.9.6-3.4 1.7-4.7l-.8-2.2 2.4.6 1.3-2 1.2 2.1 2.4-1.4v2.3l3.2.6c2.4.5 4.2 2.7 4.2 5.2v.4c0 1.9-1 3.6-2.6 4.5l-2.4 1.4v2.8H6.6Z" fill="currentColor" />
  <path d="M8.6 9.7a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Zm7.6 3.1a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM6.6 19h8.6v2.4H6.6V19Z" fill={shade} />
</Base>

export const RoadBuildingIcon = (props: IconProps) => <Base {...props}>
  <path d="M3.1 15.4 12 4.6a1.4 1.4 0 0 1 2-.2l1.1.9a1.4 1.4 0 0 1 .2 2L6.4 18.1a1.4 1.4 0 0 1-2 .2l-1.1-.9a1.4 1.4 0 0 1-.2-2Z" fill="currentColor" />
  <path d="m11.5 12.7 8-9.7 1.5 1.3-8 9.7-1.5-1.3Zm-2 8.7 8-9.7 1.5 1.3-8 9.7-1.5-1.3Z" fill="currentColor" opacity=".72" />
  <path d="m12.1 6.5 1.9 1.5-.9 1.1-1.9-1.5.9-1.1Zm-2.8 3.4 1.9 1.5-.9 1.1-1.9-1.5.9-1.1Zm-2.8 3.4 1.9 1.5-.9 1.1-1.9-1.5.9-1.1Z" fill={shade} />
</Base>

export const YearOfPlentyIcon = (props: IconProps) => <Base {...props}>
  <path d="M12 22a8.2 8.2 0 0 1-8.2-8.2c0-.7.6-1.3 1.3-1.3h13.8c.7 0 1.3.6 1.3 1.3A8.2 8.2 0 0 1 12 22Z" fill="currentColor" />
  <path d="M11.2 11.5c-2.4 0-4.2-.6-5.4-1.8-1.2-1.2-1.7-3-1.5-5.4 2.4-.2 4.2.3 5.4 1.5 1.2 1.2 1.8 3.1 1.8 5.5l-.3.2Zm1.6 0-.3-.2c0-2.4.6-4.3 1.8-5.5 1.2-1.2 3-1.7 5.4-1.5.2 2.4-.3 4.2-1.5 5.4-1.2 1.2-3 1.8-5.4 1.8Z" fill="currentColor" opacity=".78" />
  <path d="M5.5 15h13a6.7 6.7 0 0 1-1.6 3.1H7.1A6.7 6.7 0 0 1 5.5 15Z" fill={shade} />
</Base>

export const MonopolyIcon = (props: IconProps) => <Base {...props}>
  <path d="M4.5 3.4h15a1.3 1.3 0 0 1 1.3 1.3v1.9H3.2V4.7a1.3 1.3 0 0 1 1.3-1.3Z" fill="currentColor" />
  <path d="M3.2 8.4h17.6v10.9a1.3 1.3 0 0 1-1.3 1.3h-15a1.3 1.3 0 0 1-1.3-1.3V8.4Z" fill="currentColor" opacity=".82" />
  <path d="M9.8 8.4h4.4v6.4a2.2 2.2 0 0 1-4.4 0V8.4Zm-6.6 3.9h5.1v2H3.2v-2Zm12.5 0h5.1v2h-5.1v-2Z" fill={shade} />
</Base>

export const VictoryPointCardIcon = (props: IconProps) => <Base {...props}>
  <path d="M12 2.4a6.6 6.6 0 0 1 3.4 12.2l.8 5.6a1 1 0 0 1-1.5 1L12 19.8l-2.7 1.4a1 1 0 0 1-1.5-1l.8-5.6A6.6 6.6 0 0 1 12 2.4Z" fill="currentColor" />
  <path d="M12 5.2a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6Zm0 1.8a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" fill={shade} />
</Base>

/* --------------------------------------------------------------- interface */

export const DiceIcon = (props: IconProps) => <Base {...props}>
  <rect x="2.6" y="2.6" width="18.8" height="18.8" rx="4.6" fill="currentColor" />
  <g fill={shade}>
    <circle cx="8" cy="8" r="1.7" /><circle cx="16" cy="8" r="1.7" /><circle cx="12" cy="12" r="1.7" />
    <circle cx="8" cy="16" r="1.7" /><circle cx="16" cy="16" r="1.7" />
  </g>
</Base>

const DIE_PIPS: Record<number, Array<[number, number]>> = {
  1: [[12, 12]],
  2: [[7.4, 7.4], [16.6, 16.6]],
  3: [[7.4, 7.4], [12, 12], [16.6, 16.6]],
  4: [[7.4, 7.4], [16.6, 7.4], [7.4, 16.6], [16.6, 16.6]],
  5: [[7.4, 7.4], [16.6, 7.4], [12, 12], [7.4, 16.6], [16.6, 16.6]],
  6: [[7.4, 7], [16.6, 7], [7.4, 12], [16.6, 12], [7.4, 17], [16.6, 17]],
}

/** A real die face. Pips read instantly at 30px where a Cinzel numeral turns to mush. */
export const DiePips = ({ value, ...props }: { value: number } & IconProps) => <Base {...props}>
  <g fill="currentColor">{(DIE_PIPS[value] ?? DIE_PIPS[1]).map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.6" />)}</g>
</Base>

export const TradeIcon = (props: IconProps) => <Base {...props}>
  <path d="M3 8.6h11.2V5.1a.9.9 0 0 1 1.5-.7l4.9 4.1a.9.9 0 0 1 0 1.4l-4.9 4.1a.9.9 0 0 1-1.5-.7v-3.5H3a.9.9 0 0 1 0-1.2Z" fill="currentColor" />
  <path d="M21 15.4H9.8v-3.5a.9.9 0 0 0-1.5-.7l-4.9 4.1a.9.9 0 0 0 0 1.4l4.9 4.1a.9.9 0 0 0 1.5-.7v-3.5H21a.9.9 0 0 0 0-1.2Z" fill="currentColor" opacity=".72" />
</Base>

export const CardsIcon = (props: IconProps) => <Base {...props}>
  <path d="M9.2 2.4h9.4a1.6 1.6 0 0 1 1.6 1.6v12.6a1.6 1.6 0 0 1-1.6 1.6H9.2a1.6 1.6 0 0 1-1.6-1.6V4a1.6 1.6 0 0 1 1.6-1.6Z" fill="currentColor" />
  <path d="M4.6 5.6h1.4v13.2a1.4 1.4 0 0 0 1.4 1.4h9.2v1.4H6.2a1.6 1.6 0 0 1-1.6-1.6V5.6Z" fill="currentColor" opacity=".7" />
  <path d="m13.9 5.6 1.5 3 3.3.5-2.4 2.3.6 3.3-3-1.6-3 1.6.6-3.3-2.4-2.3 3.3-.5 1.5-3Z" fill={shade} />
</Base>

/** Resource cards held in hand — deliberately starless so it never reads as a development card. */
export const HandIcon = (props: IconProps) => <Base {...props}>
  <path d="M14.4 3.1a1.5 1.5 0 0 1 1.9 1l3.6 11.4a1.5 1.5 0 0 1-1 1.9l-3.5 1.1V6.2a1.6 1.6 0 0 0-1.6-1.6h-2.2l2.8-1.5Z" fill="currentColor" opacity=".62" />
  <path d="M5.4 4.6h8.4A1.4 1.4 0 0 1 15.2 6v13.6a1.4 1.4 0 0 1-1.4 1.4H5.4A1.4 1.4 0 0 1 4 19.6V6a1.4 1.4 0 0 1 1.4-1.4Z" fill="currentColor" />
  <path d="M6.6 7.6h6v1.5h-6V7.6Zm0 3.6h6v1.5h-6v-1.5Zm0 3.6h3.8v1.5H6.6v-1.5Z" fill={shade} />
</Base>

export const FlagIcon = (props: IconProps) => <Base {...props}>
  <path d="M4 1.8h2.1v20.4H4V1.8Z" fill="currentColor" />
  <path d="M7.4 3.4h11.4a.9.9 0 0 1 .7 1.5L17 8.4l2.5 3.5a.9.9 0 0 1-.7 1.5H7.4V3.4Z" fill="currentColor" opacity=".85" />
  <path d="M7.4 6.4h9.2l-.9 1.3H7.4V6.4Zm0 3.4h8.3l.9 1.3H7.4V9.8Z" fill={shade} />
</Base>

export const BookIcon = (props: IconProps) => <Base {...props}>
  <path d="M2.6 3.8c0-.6.5-1 1-1h4.9a3.5 3.5 0 0 1 3.5 3.5v13.5a2.9 2.9 0 0 0-2.4-1.3H3.6a1 1 0 0 1-1-1V3.8Zm18.8 0a1 1 0 0 0-1-1h-4.9A3.5 3.5 0 0 0 12 6.3v13.5a2.9 2.9 0 0 1 2.4-1.3h6a1 1 0 0 0 1-1V3.8Z" fill="currentColor" />
  <path d="M5.2 6.4h4.2v1.4H5.2V6.4Zm0 3.6h4.2v1.4H5.2V10Zm9.4-3.6h4.2v1.4h-4.2V6.4Zm0 3.6h4.2v1.4h-4.2V10Z" fill={shade} />
</Base>

export const CloseIcon = (props: IconProps) => <Base {...props}>
  <path d="m5.6 4.2 6.4 6.4 6.4-6.4 1.4 1.4-6.4 6.4 6.4 6.4-1.4 1.4-6.4-6.4-6.4 6.4-1.4-1.4 6.4-6.4-6.4-6.4 1.4-1.4Z" fill="currentColor" />
</Base>

export const ScrollIcon = (props: IconProps) => <Base {...props}>
  <path d="M5.4 2.6h13.2a1.4 1.4 0 0 1 1.4 1.4v16a1.4 1.4 0 0 1-1.4 1.4H5.4A1.4 1.4 0 0 1 4 20V4a1.4 1.4 0 0 1 1.4-1.4Z" fill="currentColor" />
  <path d="M7 6.4h10v1.5H7V6.4Zm0 4h10v1.5H7v-1.5Zm0 4h6.6v1.5H7v-1.5Z" fill={shade} />
</Base>

export const SoundOnIcon = (props: IconProps) => <Base {...props}>
  <path d="M11.4 3.4a.9.9 0 0 1 1.5.7v15.8a.9.9 0 0 1-1.5.7L6.6 16.4H3.9a1.2 1.2 0 0 1-1.2-1.2V8.8a1.2 1.2 0 0 1 1.2-1.2h2.7l4.8-4.2Z" fill="currentColor" />
  <path d="M15.7 7.9a5.6 5.6 0 0 1 0 8.2l-1.3-1.4a3.6 3.6 0 0 0 0-5.4l1.3-1.4Zm2.7-2.8a9.5 9.5 0 0 1 0 13.8L17 17.5a7.5 7.5 0 0 0 0-11l1.4-1.4Z" fill="currentColor" opacity=".75" />
</Base>

export const SoundOffIcon = (props: IconProps) => <Base {...props}>
  <path d="M11.4 3.4a.9.9 0 0 1 1.5.7v15.8a.9.9 0 0 1-1.5.7L6.6 16.4H3.9a1.2 1.2 0 0 1-1.2-1.2V8.8a1.2 1.2 0 0 1 1.2-1.2h2.7l4.8-4.2Z" fill="currentColor" />
  <path d="m16.5 10.5 2.1-2.1 1.4 1.4-2.1 2.1 2.1 2.1-1.4 1.4-2.1-2.1-2.1 2.1-1.4-1.4 2.1-2.1-2.1-2.1 1.4-1.4 2.1 2.1Z" fill="currentColor" opacity=".85" />
</Base>

export const HomeIcon = (props: IconProps) => <Base {...props}>
  <path d="M11.3 2.6a1.1 1.1 0 0 1 1.4 0l8.7 7.1a1.1 1.1 0 0 1-.7 2h-1v8.6a1.2 1.2 0 0 1-1.2 1.2H5.5a1.2 1.2 0 0 1-1.2-1.2v-8.6h-1a1.1 1.1 0 0 1-.7-2l8.7-7.1Z" fill="currentColor" />
  <path d="M10.2 14.2h3.6a.7.7 0 0 1 .7.7v6.6H9.5v-6.6a.7.7 0 0 1 .7-.7Z" fill={shade} />
</Base>

export const ChevronLeftIcon = (props: IconProps) => <Base {...props}>
  <path d="M15.3 3.8 7.1 12l8.2 8.2 1.6-1.7L10.4 12l6.5-6.5-1.6-1.7Z" fill="currentColor" />
</Base>

export const CheckIcon = (props: IconProps) => <Base {...props}>
  <path d="M20.3 5.6 9.4 16.5l-5.7-5.7-1.7 1.7 7.4 7.4L22 7.3l-1.7-1.7Z" fill="currentColor" />
</Base>

export const SpinnerIcon = (props: IconProps) => <Base {...props}>
  <path d="M12 2.6a9.4 9.4 0 1 1-9.4 9.4h2.4A7 7 0 1 0 12 5V2.6Z" fill="currentColor" />
</Base>

/* -------------------------------------------------------------- registries */

export const RESOURCE_ICON: Record<Resource, (props: IconProps) => React.JSX.Element> = {
  brick: BrickIcon,
  lumber: LumberIcon,
  ore: OreIcon,
  grain: GrainIcon,
  wool: WoolIcon,
}

export const DEVELOPMENT_ICON: Record<DevelopmentCard, (props: IconProps) => React.JSX.Element> = {
  knight: KnightIcon,
  'road-building': RoadBuildingIcon,
  'year-of-plenty': YearOfPlentyIcon,
  monopoly: MonopolyIcon,
  'victory-point': VictoryPointCardIcon,
}

export const BUILD_ICON = {
  road: RoadIcon,
  settlement: SettlementIcon,
  city: CityIcon,
  development: CardsIcon,
} as const

/** Small tinted resource chip used in cost rows, deltas and trade bundles. */
export function ResourceGlyph({ resource, className = '', ...props }: { resource: Resource } & IconProps) {
  const Glyph = RESOURCE_ICON[resource]
  return <span className={`resource-glyph ${resource} ${className}`.trim()}><Glyph {...props} /></span>
}
