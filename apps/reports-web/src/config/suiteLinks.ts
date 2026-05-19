import type { SuiteAppIdentity } from '@alma/ui';

function envUrl(name: string, localFallback: string) {
  const value = import.meta.env[name] as string | undefined;
  if (value) return value;
  if (!import.meta.env.PROD) return localFallback;
  return '';
}

export const COMPLIANCE_WEB_URL = envUrl('VITE_COMPLIANCE_WEB_URL', 'http://localhost:5173');
export const STOCK_WEB_URL = envUrl('VITE_STOCK_WEB_URL', 'http://localhost:5174');
export const STAFF_WEB_URL = envUrl('VITE_STAFF_WEB_URL', 'http://localhost:5175');
export const REPORTS_WEB_URL = envUrl('VITE_REPORTS_WEB_URL', 'http://localhost:5176');
export const RESERVE_WEB_URL = envUrl('VITE_RESERVE_WEB_URL', 'http://localhost:5177');
export const MARKETING_WEB_URL = envUrl('VITE_MARKETING_WEB_URL', 'http://localhost:5178');
export const COMMS_WEB_URL = (import.meta.env.VITE_COMMS_WEB_URL || 'https://alma-comms.web.app').replace(/\/+$/, '');
export const GIFTCARDS_WEB_URL = envUrl('VITE_GIFTCARDS_WEB_URL', 'http://localhost:5179');
export const SETTINGS_WEB_URL = envUrl('VITE_SETTINGS_WEB_URL', '');

function safeProductionUrl(name: string, value: string) {
  if (import.meta.env.PROD && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(value)) {
    console.warn(`${name} points to localhost in production and has been disabled.`);
    return '';
  }
  return value;
}

const suiteUrls = {
  compliance: safeProductionUrl('VITE_COMPLIANCE_WEB_URL', COMPLIANCE_WEB_URL),
  stock: safeProductionUrl('VITE_STOCK_WEB_URL', STOCK_WEB_URL),
  staff: safeProductionUrl('VITE_STAFF_WEB_URL', STAFF_WEB_URL),
  reports: safeProductionUrl('VITE_REPORTS_WEB_URL', REPORTS_WEB_URL),
  reserve: safeProductionUrl('VITE_RESERVE_WEB_URL', RESERVE_WEB_URL),
  marketing: safeProductionUrl('VITE_MARKETING_WEB_URL', MARKETING_WEB_URL),
  giftcards: safeProductionUrl('VITE_GIFTCARDS_WEB_URL', GIFTCARDS_WEB_URL),
  settings: safeProductionUrl('VITE_SETTINGS_WEB_URL', SETTINGS_WEB_URL)
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function adminHref(value: string) {
  const base = trimTrailingSlash(value);
  return base.endsWith('/admin') ? base : `${base}/admin`;
}

export function suiteAppHref(app: SuiteAppIdentity) {
  if (app.id === 'compliance') return suiteUrls.compliance ? `${trimTrailingSlash(suiteUrls.compliance)}/` : undefined;
  if (app.id === 'stock') return suiteUrls.stock ? `${trimTrailingSlash(suiteUrls.stock)}/` : undefined;
  if (app.id === 'staff') return suiteUrls.staff ? `${trimTrailingSlash(suiteUrls.staff)}/` : undefined;
  if (app.id === 'reports') return suiteUrls.reports ? `${trimTrailingSlash(suiteUrls.reports)}/` : undefined;
  if (app.id === 'reserve') return suiteUrls.reserve ? `${trimTrailingSlash(suiteUrls.reserve)}/` : undefined;
  if (app.id === 'marketing') return suiteUrls.marketing ? `${trimTrailingSlash(suiteUrls.marketing)}/` : undefined;
  if (app.id === 'giftcards') return suiteUrls.giftcards ? `${trimTrailingSlash(suiteUrls.giftcards)}/redeem` : undefined;
  if (app.id === 'training' || app.id === 'academy') return suiteUrls.staff ? `${trimTrailingSlash(suiteUrls.staff)}/academy` : undefined;
  if (app.id === 'settings') {
    if (suiteUrls.settings) return adminHref(suiteUrls.settings);
    return suiteUrls.compliance ? adminHref(suiteUrls.compliance) : undefined;
  }
  return suiteUrls.compliance ? `${trimTrailingSlash(suiteUrls.compliance)}/apps/${app.id}/login` : undefined;
}

export function withSuiteAppLinks(apps: SuiteAppIdentity[]) {
  return apps.map((app) => ({
    ...app,
    href: suiteAppHref(app)
  }));
}
