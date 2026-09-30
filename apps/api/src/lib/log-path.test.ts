import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loggablePath, maskCardCodesInPath } from './log-path.js';

describe('loggablePath', () => {
  it('masks the card code in the invoice gift card routes, keeping the last four', () => {
    assert.equal(loggablePath('/api/invoices/gift-cards/ALMA-22480BB1'), '/api/invoices/gift-cards/***0BB1');
    assert.equal(loggablePath('/api/invoices/gift-cards/ALMA-22480BB1/issue'), '/api/invoices/gift-cards/***0BB1/issue');
  });

  it('drops the query string', () => {
    assert.equal(loggablePath('/api/invoices/gift-cards/alma-22480bb1/issue?x=1'), '/api/invoices/gift-cards/***0bb1/issue');
    assert.equal(loggablePath('/api/invoices?query=ALMA-22480BB1'), '/api/invoices');
  });

  it('leaves every other path as it was', () => {
    assert.equal(loggablePath('/api/invoices/settings'), '/api/invoices/settings');
    assert.equal(loggablePath('/api/invoices/cm1abc/credit-notes'), '/api/invoices/cm1abc/credit-notes');
    assert.equal(loggablePath('/api/gift-cards/redeem'), '/api/gift-cards/redeem');
  });
});

describe('maskCardCodesInPath', () => {
  it('masks a code inside a full URL, as monitoring records it', () => {
    assert.equal(
      maskCardCodesInPath('https://api.example.com/api/invoices/gift-cards/ALMA-22480BB1/issue?x=1'),
      'https://api.example.com/api/invoices/gift-cards/***0BB1/issue?x=1'
    );
  });
});
