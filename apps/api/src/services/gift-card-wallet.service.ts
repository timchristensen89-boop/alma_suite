import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { PKPass } from 'passkit-generator';
import { env } from '../env.js';
import { HttpError } from '../lib/http.js';

type WalletGiftCard = {
  id: string;
  code: string;
  status: 'PENDING_PAYMENT' | 'ACTIVE' | 'REDEEMED' | 'CANCELLED' | 'EXPIRED';
  initialValueCents: number;
  balanceCents: number;
  currency: string;
  purchaserName: string;
  purchaserEmail: string;
  recipientName: string | null;
  message: string | null;
  paidAt: Date | null;
  expiresAt: Date | null;
};

const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lYd2GQAAAABJRU5ErkJggg==',
  'base64'
);

function webUrl(path = '') {
  return `${env.giftCards.webUrl.replace(/\/+$/, '')}${path}`;
}

function decodePem(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withNewlines = trimmed.replace(/\\n/g, '\n');
  if (withNewlines.includes('-----BEGIN')) return withNewlines;
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8').replace(/\\n/g, '\n');
    return decoded.includes('-----BEGIN') ? decoded : withNewlines;
  } catch {
    return withNewlines;
  }
}

function requireActiveWalletCard(card: WalletGiftCard) {
  if (!card.paidAt || card.status !== 'ACTIVE' || card.balanceCents <= 0) {
    throw new HttpError(404, 'Only paid active gift cards with a remaining balance can be added to Wallet.');
  }
}

function formatAmount(cents: number) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD'
  }).format(cents / 100);
}

function readableExpiry(card: WalletGiftCard) {
  return card.expiresAt
    ? card.expiresAt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'No expiry set';
}

function assetBuffer(fileName: string) {
  const candidates = [
    join(process.cwd(), 'apps/giftcards-web/public/images', fileName),
    join(process.cwd(), 'apps/giftcards-web/dist/images', fileName)
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    // The blank fallback still signs, so a missing file would otherwise ship a
    // pass with an invisible logo and nobody would know why.
    console.warn('[wallet] Pass asset missing, falling back to a blank image', { fileName });
  }
  return found ? readFileSync(found) : transparentPng;
}

function appleConfig() {
  const config = env.giftCards.appleWallet;
  const signerCert = decodePem(config.signerCert);
  const signerKey = decodePem(config.signerKey);
  const wwdr = decodePem(config.wwdr);
  if (!config.passTypeIdentifier || !config.teamIdentifier || !signerCert || !signerKey || !wwdr) {
    throw new HttpError(
      503,
      'Apple Wallet is not configured yet. Add APPLE_WALLET_PASS_TYPE_IDENTIFIER, APPLE_WALLET_TEAM_IDENTIFIER, APPLE_WALLET_SIGNER_CERT, APPLE_WALLET_SIGNER_KEY, and APPLE_WALLET_WWDR_CERT.'
    );
  }
  return { ...config, signerCert, signerKey, wwdr };
}

function googleConfig() {
  const config = env.giftCards.googleWallet;
  const privateKey = decodePem(config.privateKey);
  if (!config.issuerId || !config.serviceAccountEmail || !privateKey) {
    throw new HttpError(
      503,
      'Google Wallet is not configured yet. Add GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL, and GOOGLE_WALLET_PRIVATE_KEY.'
    );
  }
  return { ...config, privateKey };
}

function googleLocalized(value: string) {
  return {
    defaultValue: {
      language: 'en-AU',
      value
    }
  };
}

function googleImage(uri: string, description: string) {
  return {
    sourceUri: { uri },
    contentDescription: googleLocalized(description)
  };
}

function googleIdPart(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

export const giftCardWalletService = {
  async applePass(card: WalletGiftCard) {
    requireActiveWalletCard(card);
    const config = appleConfig();
    const amount = formatAmount(card.balanceCents);
    const passJson = {
      formatVersion: 1,
      passTypeIdentifier: config.passTypeIdentifier,
      teamIdentifier: config.teamIdentifier,
      serialNumber: card.id,
      organizationName: config.organizationName,
      description: 'ALMA Group Gift Card',
      // Forest green card, cream ink — the dark treatment used on the gift card
      // email panel. No logoText: the logo artwork already carries the wordmark.
      foregroundColor: 'rgb(245, 220, 206)',
      backgroundColor: 'rgb(31, 53, 36)',
      labelColor: 'rgb(159, 153, 138)',
      sharingProhibited: false,
      expirationDate: card.expiresAt?.toISOString(),
      storeCard: {
        // The balance carries the card; everything else earns its place. The
        // code lives under the QR only, so it is never printed twice.
        primaryFields: [
          { key: 'balance', label: 'BALANCE', value: amount }
        ],
        secondaryFields: [
          { key: 'venue', label: 'VENUES', value: 'Alma Avalon + St Alma' },
          { key: 'expires', label: 'EXPIRES', value: readableExpiry(card) }
        ],
        auxiliaryFields: [],
        backFields: [
          { key: 'redeem', label: 'How to redeem', value: 'Show this card to staff at Alma Avalon or St Alma.' },
          { key: 'balanceBack', label: 'Current balance', value: amount },
          { key: 'codeBack', label: 'Card code', value: card.code },
          ...(card.recipientName ? [{ key: 'recipient', label: 'For', value: card.recipientName }] : []),
          { key: 'terms', label: 'Terms', value: 'Gift card balance is checked against the ALMA gift card register before redemption.' },
          ...(card.message ? [{ key: 'message', label: 'Message', value: card.message }] : [])
        ]
      },
      barcodes: [
        {
          format: 'PKBarcodeFormatQR',
          message: card.code,
          messageEncoding: 'iso-8859-1',
          altText: card.code
        }
      ]
    };

    const pass = new PKPass(
      {
        'pass.json': Buffer.from(JSON.stringify(passJson)),
        // Cream-ink artwork sized to Apple's pass dimensions (logo 160x50pt,
        // icon 29x29pt). The stock brand files are dark ink and would vanish
        // against the forest green card.
        'icon.png': assetBuffer('wallet/icon.png'),
        'icon@2x.png': assetBuffer('wallet/icon@2x.png'),
        'icon@3x.png': assetBuffer('wallet/icon@3x.png'),
        'logo.png': assetBuffer('wallet/logo.png'),
        'logo@2x.png': assetBuffer('wallet/logo@2x.png'),
        'logo@3x.png': assetBuffer('wallet/logo@3x.png')
      },
      {
        wwdr: config.wwdr,
        signerCert: config.signerCert,
        signerKey: config.signerKey,
        signerKeyPassphrase: config.signerKeyPassphrase || undefined
      }
    );

    return pass.getAsBuffer();
  },

  googleSaveUrl(card: WalletGiftCard) {
    requireActiveWalletCard(card);
    const config = googleConfig();
    const classId = `${config.issuerId}.${googleIdPart(config.classSuffix)}`;
    const objectId = `${config.issuerId}.alma_gift_card_${googleIdPart(card.code)}`;
    const amount = formatAmount(card.balanceCents);
    const logoUrl = webUrl('/images/alma-group-logo.png');
    const heroUrl = webUrl('/images/alma-avalon-margaritas.jpg');
    const printUrl = webUrl(`/print?code=${encodeURIComponent(card.code)}`);

    const claims = {
      iss: config.serviceAccountEmail,
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(Date.now() / 1000),
      origins: config.origins.length ? config.origins : [webUrl()],
      payload: {
        genericClasses: [
          {
            id: classId,
            issuerName: 'ALMA Group'
          }
        ],
        genericObjects: [
          {
            id: objectId,
            classId,
            state: 'ACTIVE',
            cardTitle: googleLocalized('ALMA Group Gift Card'),
            subheader: googleLocalized('Balance'),
            header: googleLocalized(amount),
            hexBackgroundColor: '#FAF8F3',
            logo: googleImage(logoUrl, 'ALMA Group logo'),
            heroImage: googleImage(heroUrl, 'ALMA Group table'),
            barcode: {
              type: 'QR_CODE',
              value: card.code,
              alternateText: card.code
            },
            textModulesData: [
              {
                id: 'venue',
                header: 'Redeem at',
                body: 'Alma Avalon and St Alma Freshwater'
              },
              {
                id: 'expiry',
                header: 'Expires',
                body: readableExpiry(card)
              }
            ],
            linksModuleData: {
              uris: [
                {
                  id: 'print',
                  uri: printUrl,
                  description: 'Open printable gift card'
                }
              ]
            }
          }
        ]
      }
    };

    const token = jwt.sign(claims, config.privateKey, { algorithm: 'RS256' });
    return `https://pay.google.com/gp/v/save/${token}`;
  }
};
