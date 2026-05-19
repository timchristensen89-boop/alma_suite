import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...rest
  };
}

export const IconDashboard = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
);

export const IconIssues = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 2L2 21h20L12 2z" />
    <path d="M12 10v5" />
    <circle cx="12" cy="18" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

export const IconTriangle = IconIssues;

export const IconChecklist = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8l1.5 1.5L13 6" />
    <path d="M8 14l1.5 1.5L13 12" />
    <path d="M16 8.5h2" />
    <path d="M16 14.5h2" />
  </svg>
);

export const IconStaff = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M15.5 13.6c2.7.4 4.8 2.7 4.8 5.4" />
  </svg>
);

export const IconTemperature = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M10 14.8V5a2 2 0 1 1 4 0v9.8a4 4 0 1 1-4 0z" />
    <path d="M12 9v7" />
  </svg>
);

export const IconIncident = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M5 6l7 3 7-3v10l-7 3-7-3z" />
    <path d="M5 6v10" />
    <path d="M19 6v10" />
  </svg>
);

export const IconMap = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
    <path d="M9 4v16" />
    <path d="M15 6v16" />
  </svg>
);

export const IconSearch = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const IconBell = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
);

export const IconPlus = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);

export const IconArrowRight = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </svg>
);

export const IconArrowLeft = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M19 12H5" />
    <path d="m11 6-6 6 6 6" />
  </svg>
);

export const IconChevronDown = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const IconRefresh = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 10a8 8 0 0 1 14-4l2 2" />
    <path d="M20 4v5h-5" />
    <path d="M20 14a8 8 0 0 1-14 4l-2-2" />
    <path d="M4 20v-5h5" />
  </svg>
);

export const IconCheck = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="m5 12 5 5L20 7" />
  </svg>
);

export const IconClock = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const IconInbox = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M3 13h5l2 3h4l2-3h5" />
    <path d="M5 13 6.5 5h11L19 13" />
    <path d="M3 13v6h18v-6" />
  </svg>
);

export const IconEdit = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 20h4l10-10-4-4L4 16v4z" />
    <path d="m14 6 4 4" />
  </svg>
);

export const IconExternalLink = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M14 4h6v6" />
    <path d="M20 4 10 14" />
    <path d="M20 14v6H4V4h6" />
  </svg>
);

export const IconAudit = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 3h10l6 6v12H4z" />
    <path d="M14 3v6h6" />
    <path d="M8 13h8" />
    <path d="M8 17h5" />
  </svg>
);

export const IconTrash = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 7h16" />
    <path d="M10 4h4a1 1 0 0 1 1 1v2H9V5a1 1 0 0 1 1-1z" />
    <path d="M6 7v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
);

export const IconCamera = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 7h3l2-3h6l2 3h3v12H4z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

export const IconSend = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="m4 12 16-8-6 18-3-7z" />
    <path d="m4 12 7 3" />
  </svg>
);

export const IconLink = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M10 14a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7L11.4 7" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 1 0 5.7 5.7L12.6 17" />
  </svg>
);

export const IconHandbook = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

export const IconUsers = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export const IconPhone = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

export const IconMail = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 6-10 7L2 6" />
  </svg>
);

export const IconSettings = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const IconLogout = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export const IconUser = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

export const IconLiquor = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M8 2h8" />
    <path d="M9 2v4c0 1-2 2-2 5v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V11c0-3-2-4-2-5V2" />
    <path d="M7 13h10" />
  </svg>
);

export const IconLicences = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6 3h9l3 3v15H6z" />
    <path d="M15 3v4h4" />
    <path d="M9 11h6" />
    <path d="M9 15h4" />
    <path d="m9 19 1.5 1.5L14 17" />
  </svg>
);

export const IconFileText = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6 3h9l3 3v15H6z" />
    <path d="M15 3v4h4" />
    <path d="M9 11h6" />
    <path d="M9 15h6" />
    <path d="M9 19h4" />
  </svg>
);

export const IconFileSignature = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6 3h9l3 3v15H6z" />
    <path d="M15 3v4h4" />
    <path d="M8 17c2-2 3.5-2 4.5 0 1-2 2.5-2 4 0" />
    <path d="M8 12h7" />
  </svg>
);

export const IconFiles = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M7 7V3h10l4 4v12H7z" />
    <path d="M17 3v5h4" />
    <path d="M4 7v14h13" />
  </svg>
);

export const IconFileLock = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6 3h9l3 3v15H6z" />
    <path d="M15 3v4h4" />
    <rect x="9" y="13" width="6" height="5" rx="1" />
    <path d="M10.5 13v-1.5a1.5 1.5 0 0 1 3 0V13" />
  </svg>
);

export const IconUserPlus = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="9" cy="7" r="4" />
    <path d="M3 21v-2a5 5 0 0 1 10 0v2" />
    <path d="M18 8v6" />
    <path d="M15 11h6" />
  </svg>
);

export const IconBadgeCheck = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 3 4.5 6v5.5c0 4 2.6 7 7.5 9.5 4.9-2.5 7.5-5.5 7.5-9.5V6z" />
    <path d="m8.5 12.5 2.3 2.3 4.7-5" />
  </svg>
);

export const IconKeyRound = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="7.5" cy="14.5" r="4.5" />
    <path d="M11 11 21 1" />
    <path d="m16 6 3 3" />
    <path d="m14 8 2 2" />
  </svg>
);

export const IconBriefcase = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M9 6V4h6v2" />
    <rect x="3" y="6" width="18" height="14" rx="2" />
    <path d="M3 12h18" />
    <path d="M10 12v2h4v-2" />
  </svg>
);

export const IconCalendarCheck = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="4" y="5" width="16" height="16" rx="2" />
    <path d="M8 3v4" />
    <path d="M16 3v4" />
    <path d="M4 10h16" />
    <path d="m8.5 15 2.2 2.2 4.8-5" />
  </svg>
);

export const IconCalendarClock = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="4" y="5" width="16" height="16" rx="2" />
    <path d="M8 3v4" />
    <path d="M16 3v4" />
    <path d="M4 10h16" />
    <circle cx="12" cy="15.5" r="3" />
    <path d="M12 14v1.8l1.3.8" />
  </svg>
);

export const IconWallet = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 7h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12" />
    <path d="M16 13h5" />
    <circle cx="16" cy="13" r="1" />
  </svg>
);

export const IconPlug = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M9 7V3" />
    <path d="M15 7V3" />
    <path d="M7 7h10v4a5 5 0 0 1-10 0z" />
    <path d="M12 16v5" />
  </svg>
);

export const IconReceipt = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6 3h12v18l-2-1-2 1-2-1-2 1-2-1-2 1z" />
    <path d="M9 8h6" />
    <path d="M9 12h6" />
    <path d="M9 16h3" />
  </svg>
);

export const IconUpload = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 3v12" />
    <path d="m7 8 5-5 5 5" />
    <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
  </svg>
);

export const IconStore = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 10h16l-1.5-6h-13z" />
    <path d="M5 10v10h14V10" />
    <path d="M9 20v-6h6v6" />
    <path d="M4 10c0 2 3 2 4 0 1 2 3 2 4 0 1 2 3 2 4 0 1 2 4 2 4 0" />
  </svg>
);

export const IconPackageCheck = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M3 7l9-4 9 4-9 4z" />
    <path d="M3 7v10l9 4 9-4V7" />
    <path d="M12 11v10" />
    <path d="m15 15 1.5 1.5L20 13" />
  </svg>
);

export const IconGift = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="3" y="8" width="18" height="13" rx="2" />
    <path d="M12 8v13" />
    <path d="M3 12h18" />
    <path d="M12 8c-4 0-5-5-2-5 2 0 2 3 2 5z" />
    <path d="M12 8c4 0 5-5 2-5-2 0-2 3-2 5z" />
  </svg>
);

export const IconPieChart = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 3v9h9" />
    <path d="M21 12a9 9 0 1 1-9-9" />
  </svg>
);

export const IconDownload = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M4 21h16" />
  </svg>
);

export const IconScan = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 7V5a1 1 0 0 1 1-1h2" />
    <path d="M17 4h2a1 1 0 0 1 1 1v2" />
    <path d="M20 17v2a1 1 0 0 1-1 1h-2" />
    <path d="M7 20H5a1 1 0 0 1-1-1v-2" />
    <path d="M7 12h10" />
  </svg>
);

export const IconBadgePercent = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 3 4.5 6v6c0 3.7 2.6 6.7 7.5 9 4.9-2.3 7.5-5.3 7.5-9V6z" />
    <path d="m9 15 6-6" />
    <circle cx="9" cy="9" r="1" />
    <circle cx="15" cy="15" r="1" />
  </svg>
);

export const IconMegaphone = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 13h3l10 5V6L7 11H4z" />
    <path d="M7 13v5" />
    <path d="M17 9a4 4 0 0 1 0 6" />
  </svg>
);

export const IconImages = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="3" y="5" width="13" height="13" rx="2" />
    <path d="M8 9h.01" />
    <path d="m4 16 4-4 3 3 2-2 3 3" />
    <path d="M8 3h11a2 2 0 0 1 2 2v11" />
  </svg>
);

export const IconGlobe = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3z" />
  </svg>
);

export const IconShare = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="m8.6 10.6 6.8-4.2" />
    <path d="m8.6 13.4 6.8 4.2" />
  </svg>
);
