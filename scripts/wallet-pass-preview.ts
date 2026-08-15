/**
 * Signs a sample .pkpass through the real giftCardWalletService, so the output
 * is the exact pass a customer receives. Temporary preview harness — run with:
 *   ./apps/api/node_modules/.bin/tsx scripts/wallet-pass-preview.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Load .env before anything imports env.ts, which reads process.env at module load.
for (const line of readFileSync(join(process.cwd(), '.env'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const card = {
  id: 'preview-only',
  code: 'ALMA-6DDF2990',
  status: 'ACTIVE' as const,
  initialValueCents: 12000,
  balanceCents: 12000,
  currency: 'aud',
  purchaserName: 'Tim Christensen',
  purchaserEmail: 'tim@almagroup.com.au',
  recipientName: 'Testing',
  message: 'Happy birthday — enjoy a long lunch on us.',
  paidAt: new Date(),
  expiresAt: new Date('2029-08-12T00:00:00Z')
};

async function main() {
  const { giftCardWalletService } = await import('../apps/api/src/services/gift-card-wallet.service.js');
  const buffer = await giftCardWalletService.applePass(card);
  const out = process.argv[2] || '/tmp/alma-preview.pkpass';
  writeFileSync(out, buffer);
  console.log(`signed ${buffer.length} bytes -> ${out}`);
}

main().catch((error) => {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
