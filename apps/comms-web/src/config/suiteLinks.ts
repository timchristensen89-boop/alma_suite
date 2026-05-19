const trim = (value: string | undefined, fallback: string) =>
  (value && value.trim() ? value.trim() : fallback).replace(/\/+$/, '');

export const ADMIN_WEB_URL = trim(import.meta.env.VITE_ADMIN_WEB_URL, 'https://alma-suite-admin.web.app');
export const COMPLIANCE_WEB_URL = trim(import.meta.env.VITE_COMPLIANCE_WEB_URL, 'https://alma-compliance.web.app');
export const STAFF_WEB_URL = trim(import.meta.env.VITE_STAFF_WEB_URL, 'https://alma-staff.web.app');
export const STOCK_WEB_URL = trim(import.meta.env.VITE_STOCK_WEB_URL, 'https://alma-stock-v18.web.app');
export const REPORTS_WEB_URL = trim(import.meta.env.VITE_REPORTS_WEB_URL, 'https://alma-reports.web.app');
export const GIFTCARDS_WEB_URL = trim(import.meta.env.VITE_GIFTCARDS_WEB_URL, 'https://alma-giftcards.web.app');
export const RESERVE_WEB_URL = trim(import.meta.env.VITE_RESERVE_WEB_URL, 'https://alma-reserve.web.app');
export const MARKETING_WEB_URL = trim(import.meta.env.VITE_MARKETING_WEB_URL, 'https://alma-marketing.web.app');
export const COMMS_WEB_URL = trim(import.meta.env.VITE_COMMS_WEB_URL, 'https://alma-comms.web.app');
