import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const Base = ({ children, ...props }: IconProps) => <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...props}>{children}</svg>

export const DiceIcon = (props: IconProps) => <Base {...props}><rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" /><g fill="#342113"><circle cx="8" cy="8" r="1.3" /><circle cx="16" cy="8" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="8" cy="16" r="1.3" /><circle cx="16" cy="16" r="1.3" /></g></Base>
export const TradeIcon = (props: IconProps) => <Base {...props}><path d="M4 8h12l-3-3 1.7-1.7L21 9.5l-6.3 6.2L13 14l3-3H4V8Zm16 8H8l3 3-1.7 1.7L3 14.5l6.3-6.2L11 10l-3 3h12v3Z" fill="currentColor" /></Base>
export const HammerIcon = (props: IconProps) => <Base {...props}><path d="m4.7 3.3 5.6 5.6-2.1 2.2-2-2L3 12.3.7 10l4-4-2-2 2-2.1Zm7.6 6.3 2.1 2.1-9.7 9.7-2.1-2.1 9.7-9.7Zm1.4-7.3 8 8-3.6 3.6-8-8 3.6-3.6Z" fill="currentColor" /></Base>
export const CardsIcon = (props: IconProps) => <Base {...props}><rect x="6" y="3" width="13" height="17" rx="2" fill="currentColor" /><rect x="2" y="6" width="12" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m12.5 7 1.4 2.7 3 .5-2.2 2.1.5 3-2.7-1.4-2.7 1.4.5-3-2.2-2.1 3-.5L12.5 7Z" fill="#342113" /></Base>
export const FlagIcon = (props: IconProps) => <Base {...props}><path d="M5 2h2v20H5V2Zm3 2h12l-3 4 3 4H8V4Z" fill="currentColor" /></Base>
export const EyeIcon = (props: IconProps) => <Base {...props}><path d="M12 4C6.6 4 2.3 7.3.7 12 2.3 16.7 6.6 20 12 20s9.7-3.3 11.3-8C21.7 7.3 17.4 4 12 4Zm0 13a5 5 0 1 1 0-10 5 5 0 0 1 0 10Z" fill="currentColor" /><circle cx="12" cy="12" r="2.5" fill="currentColor" /></Base>
export const BookIcon = (props: IconProps) => <Base {...props}><path d="M3 4.5A3.5 3.5 0 0 1 6.5 1H11v18H6.5A3.5 3.5 0 0 0 3 22.5v-18Zm18 0A3.5 3.5 0 0 0 17.5 1H13v18h4.5a3.5 3.5 0 0 1 3.5 3.5v-18Z" fill="currentColor" /></Base>
export const CloseIcon = (props: IconProps) => <Base {...props}><path d="m5.6 4.2 6.4 6.4 6.4-6.4 1.4 1.4-6.4 6.4 6.4 6.4-1.4 1.4-6.4-6.4-6.4 6.4-1.4-1.4 6.4-6.4-6.4-6.4 1.4-1.4Z" fill="currentColor" /></Base>
