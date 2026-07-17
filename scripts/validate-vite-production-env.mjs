import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const URLS = {
  admin: 'https://alma-suite-admin.web.app',
  compliance: 'https://alma-compliance.web.app',
  staff: 'https://alma-staff.web.app',
  stock: 'https://alma-stock-v18.web.app',
  reports: 'https://alma-reports.web.app',
  giftcards: 'https://alma-giftcards.web.app',
  reserve: 'https://alma-reserve.web.app',
  marketing: 'https://alma-marketing.web.app',
  comms: 'https://alma-comms.web.app',
  home: 'https://alma-home.web.app'
};

// The APIs moved off Cloud Run to the VPS (Caddy-fronted). All apps now use
// the absolute API domains instead of same-origin /api rewrites — the
// Firebase Hosting → Cloud Run rewrites no longer exist.
const API_URL = 'https://api.almagroup.com.au';
const STOCK_API_URL = 'https://stock-api.almagroup.com.au';

const APP_CONFIG = {
  'admin-web': { apiBase: API_URL },
  web: { apiBase: API_URL },
  'staff-web': { apiBase: API_URL },
  'stock-web': { apiBase: API_URL, stockApiBase: STOCK_API_URL },
  'reports-web': { apiBase: API_URL, stockApiBase: STOCK_API_URL },
  'giftcards-web': { apiBase: API_URL },
  'reserve-web': { apiBase: API_URL },
  'marketing-web': { apiBase: API_URL },
  comms: { apiBase: API_URL },
  'comms-web': { apiBase: API_URL },
  'home-web': { apiBase: API_URL }
};

const CROSS_APP_URLS = {
  VITE_ADMIN_WEB_URL: URLS.admin,
  VITE_SETTINGS_WEB_URL: URLS.admin,
  VITE_COMPLIANCE_WEB_URL: URLS.compliance,
  VITE_STAFF_WEB_URL: URLS.staff,
  VITE_STOCK_WEB_URL: URLS.stock,
  VITE_REPORTS_WEB_URL: URLS.reports,
  VITE_GIFTCARDS_WEB_URL: URLS.giftcards,
  VITE_RESERVE_WEB_URL: URLS.reserve,
  VITE_MARKETING_WEB_URL: URLS.marketing,
  VITE_COMMS_WEB_URL: URLS.comms
};

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const env = {};
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equalsAt = line.indexOf('=');
    if (equalsAt === -1) continue;
    const key = line.slice(0, equalsAt).trim();
    let value = line.slice(equalsAt + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function fail(message) {
  console.error(`\nProduction env validation failed:\n${message}\n`);
  process.exit(1);
}

const appName = process.argv[2] ?? basename(process.cwd());
const config = APP_CONFIG[appName];
if (!config) {
  fail(`Unknown app "${appName}". Add it to scripts/validate-vite-production-env.mjs before building for production.`);
}

const fileEnv = parseEnvFile(resolve(process.cwd(), '.env.production'));
const env = { ...fileEnv, ...process.env };
const errors = [];

function requireExact(name, expected) {
  const value = env[name];
  if (!value) {
    errors.push(`${name} is missing. Expected ${name}=${expected}`);
    return;
  }
  const normalized = value.replace(/\/+$/, '');
  if (normalized !== expected) {
    errors.push(`${name} must be ${expected}; found ${value}`);
  }
}

requireExact('VITE_API_URL', config.apiBase);
requireExact('VITE_API_BASE_URL', config.apiBase);

if (config.stockApiBase) {
  requireExact('VITE_STOCK_API_URL', config.stockApiBase);
  requireExact('VITE_STOCK_API_BASE_URL', config.stockApiBase);
}

for (const [name, expected] of Object.entries(CROSS_APP_URLS)) {
  requireExact(name, expected);
}

if (errors.length > 0) {
  fail(errors.map((error) => `- ${error}`).join('\n'));
}

console.log(`Production env OK for ${appName}`);
