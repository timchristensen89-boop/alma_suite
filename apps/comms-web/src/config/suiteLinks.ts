function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function envUrl(names: string[], fallback: string) {
  const value = names.map((name) => import.meta.env[name]).find(Boolean) ?? fallback;
  return trimTrailingSlash(value);
}

export const COMPLIANCE_WEB_URL = envUrl(['VITE_COMPLIANCE_WEB_URL'], 'https://alma-compliance.web.app');
export const STOCK_WEB_URL = envUrl(['VITE_STOCK_WEB_URL'], 'https://alma-stock-v18.web.app');
export const STAFF_WEB_URL = envUrl(['VITE_STAFF_WEB_URL'], 'https://alma-staff.web.app');
export const REPORTS_WEB_URL = envUrl(['VITE_REPORTS_WEB_URL'], 'https://alma-reports.web.app');
export const RESERVE_WEB_URL = envUrl(['VITE_RESERVE_WEB_URL'], 'https://alma-reserve.web.app');
export const MARKETING_WEB_URL = envUrl(['VITE_MARKETING_WEB_URL'], 'https://alma-marketing.web.app');
export const GIFTCARDS_WEB_URL = envUrl(['VITE_GIFTCARDS_WEB_URL', 'VITE_GIFT_CARDS_WEB_URL'], 'https://alma-giftcards.web.app');
export const COMMS_WEB_URL = envUrl(['VITE_COMMS_WEB_URL'], 'https://alma-comms.web.app');
export const ADMIN_WEB_URL = envUrl(['VITE_ADMIN_WEB_URL', 'VITE_SETTINGS_WEB_URL'], 'https://alma-suite-admin.web.app');

type SuiteLikeApp = {
  id: string;
  href?: string;
  url?: string;
  [key: string]: unknown;
};

const APP_URLS: Record<string, string> = {
  compliance: COMPLIANCE_WEB_URL,
  stock: STOCK_WEB_URL,
  staff: STAFF_WEB_URL,
  reports: REPORTS_WEB_URL,
  reserve: RESERVE_WEB_URL,
  marketing: MARKETING_WEB_URL,
  giftcards: GIFTCARDS_WEB_URL,
  'gift-cards': GIFTCARDS_WEB_URL,
  comms: COMMS_WEB_URL,
  settings: ADMIN_WEB_URL,
  admin: ADMIN_WEB_URL
};

export function urlForSuiteApp(appId: string) {
  return APP_URLS[appId] ?? COMPLIANCE_WEB_URL;
}

export function withSuiteAppLinks<T extends SuiteLikeApp>(apps: readonly T[]): T[] {
  return apps.map((app) => {
    const url = urlForSuiteApp(app.id);
    return {
      ...app,
      href: url,
      url
    };
  }) as T[];
}
