import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveVenueLabel, isConfiguredVenueLabel, VENUE_ALIASES } from '@alma/shared';

const VENUES = ['Alma Avalon', 'St Alma'];

describe('an unknown venue is unattributed data, not a new restaurant', () => {
  it('canonical names resolve to themselves, formatting differences forgiven', () => {
    assert.deepEqual(resolveVenueLabel('Alma Avalon', VENUES), { venue: 'Alma Avalon', status: 'canonical', sourceLabel: 'Alma Avalon' });
    assert.deepEqual(resolveVenueLabel('  st alma ', VENUES), { venue: 'St Alma', status: 'canonical', sourceLabel: 'st alma' });
    assert.equal(resolveVenueLabel('ST. ALMA', VENUES).venue, 'St Alma');
    assert.equal(resolveVenueLabel('ALMA_AVALON', VENUES).venue, 'Alma Avalon');
  });

  it('known aliases resolve, with their evidence on record, to the configured name not the label', () => {
    for (const alias of VENUE_ALIASES) assert.ok(alias.evidence.length > 10, `${alias.label} needs evidence`);
    assert.deepEqual(resolveVenueLabel('Alma Freshwater Pty Ltd', VENUES), { venue: 'St Alma', status: 'alias', sourceLabel: 'Alma Freshwater Pty Ltd' });
    assert.deepEqual(resolveVenueLabel('Alma Avalon Pty Ltd', VENUES), { venue: 'Alma Avalon', status: 'alias', sourceLabel: 'Alma Avalon Pty Ltd' });
    assert.equal(resolveVenueLabel('St Alma, Freshwater', VENUES).venue, 'St Alma');
  });

  it('"Both" is a marker, not a venue, and is never split between the two', () => {
    assert.deepEqual(resolveVenueLabel('Both', VENUES), { venue: null, status: 'pseudo', sourceLabel: 'Both' });
    assert.equal(resolveVenueLabel('All venues', VENUES).status, 'pseudo');
  });

  it('blank and Unspecified stay unattributed', () => {
    assert.deepEqual(resolveVenueLabel('', VENUES), { venue: null, status: 'blank', sourceLabel: '' });
    assert.deepEqual(resolveVenueLabel(null, VENUES), { venue: null, status: 'blank', sourceLabel: '' });
    assert.deepEqual(resolveVenueLabel('Unspecified', VENUES), { venue: null, status: 'unknown', sourceLabel: 'Unspecified' });
  });

  it('a genuinely unknown location is unknown — similarity is not evidence', () => {
    // "St View" and "Alma" are what a Loaded print-out can carry; both look
    // like our venues and neither is one.
    assert.deepEqual(resolveVenueLabel('St View', VENUES), { venue: null, status: 'unknown', sourceLabel: 'St View' });
    assert.deepEqual(resolveVenueLabel('Alma', VENUES), { venue: null, status: 'unknown', sourceLabel: 'Alma' });
    assert.equal(resolveVenueLabel('St Almo', VENUES).venue, null);
    assert.equal(resolveVenueLabel('Avalon Beach RSL', VENUES).venue, null);
    assert.equal(isConfiguredVenueLabel('St View', VENUES), false);
  });

  it('an alias for a venue that is not configured resolves to nothing', () => {
    assert.equal(resolveVenueLabel('Alma Freshwater Pty Ltd', ['Alma Avalon']).venue, null);
    assert.equal(resolveVenueLabel('Alma Freshwater Pty Ltd', ['Alma Avalon']).status, 'unknown');
  });
});
