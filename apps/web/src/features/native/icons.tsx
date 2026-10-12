// The app's icon set: 24px grid, 1.75 stroke, round joins. One family, so glyphs on
// rows, tabs and actions read as the same system.
import type { ReactNode, SVGProps } from 'react'

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" {...props}>
      {children}
    </svg>
  )
}

export const InboxIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M4 13.5 6.2 6.4A2 2 0 0 1 8.1 5h7.8a2 2 0 0 1 1.9 1.4L20 13.5V18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /><path d="M4 13.5h4.5l1.2 2h4.6l1.2-2H20" /></Icon>
export const GridIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></Icon>
export const GearIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M12 3v2.2M12 18.8V21M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.5l1.9-1.1M17.9 8.6l1.9-1.1" /><circle cx="12" cy="12" r="7" /></Icon>
export const CheckAllIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="m2.5 12.5 4 4L15 8" /><path d="m11.5 16.5 1 0L21 8" /></Icon>
export const ChevronIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="m9.5 6 6 6-6 6" /></Icon>
export const CloseIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></Icon>
export const BellIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></Icon>
export const PhoneIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="M11 18h2" /></Icon>

// What a notice is about: one glyph per kind.
export const AtIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><circle cx="12" cy="12" r="3.5" /><path d="M15.5 12v1.2a2.3 2.3 0 0 0 4.5.6A8.5 8.5 0 1 0 16.6 19" /></Icon>
export const ReplyIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M9.5 6 4 11.5 9.5 17" /><path d="M4.5 11.5H14a6 6 0 0 1 6 6V19" /></Icon>
export const AssignIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><circle cx="10" cy="8" r="3.5" /><path d="M3.5 19.5a6.5 6.5 0 0 1 11-4.7" /><path d="m15 18 2 2 4-4.5" /></Icon>
export const BlockedIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M8.3 3.5h7.4l5 5v7.2l-5 5H8.3l-5-5V8.5z" /><path d="M8.5 12h7" /></Icon>
export const ClockIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Icon>
export const ChatIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17H10l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z" /></Icon>
export const PulseIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M3.5 12h4l2-5 4 10 2-5h5" /></Icon>
export const HashIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M9.5 4 7.5 20M16.5 4l-2 16M4.5 9h15.5M4 15h15.5" /></Icon>
