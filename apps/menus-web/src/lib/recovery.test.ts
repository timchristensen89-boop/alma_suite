import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { MenuDocument } from '@alma/shared';

/**
 * The kept-copy store behind "Apply to this draft". Runs in Node with an
 * in-memory localStorage; the editor wiring is covered end to end by
 * e2e/recovery-apply.e2e.mjs.
 */

class MemoryStorage {
  private values = new Map<string, string>();
  failWrites = false;
  getItem(key: string) {
    return this.values.has(key) ? this.values.get(key)! : null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const storage = new MemoryStorage();
(globalThis as unknown as { window: { localStorage: MemoryStorage } }).window = { localStorage: storage };

const { forgetUnsavedChanges, keepUnsavedChanges, newRecoveryId, readUnsavedChanges, saveConfirmsApply } = await import('./recovery.js');

const doc = (heading: string): MenuDocument => ({ heading, dietaryNote: '', surchargeLine: '', sections: [] });
const copy = (id: string, heading: string) => ({ id, menuId: 'm1', menuLabel: 'St Alma · Tuesday', draftVersionNumber: 2, keptAt: '2026-10-08T12:00:00.000Z', document: doc(heading) });

describe('kept copies of unsaved edits', () => {
  beforeEach(() => {
    storage.failWrites = false;
    forgetUnsavedChanges('m1');
  });

  it('keeps and reads back a copy, id included', () => {
    assert.equal(keepUnsavedChanges(copy('r1', 'Taco Tuesday')), true);
    const read = readUnsavedChanges('m1');
    assert.equal(read?.id, 'r1');
    assert.equal(read?.document.heading, 'Taco Tuesday');
    assert.equal(readUnsavedChanges('another-menu'), null);
  });

  it('clearing by id removes only that copy: an older apply cannot remove a newer copy', () => {
    keepUnsavedChanges(copy('older', 'First kept'));
    keepUnsavedChanges(copy('newer', 'Kept again later'));
    forgetUnsavedChanges('m1', 'older');
    assert.equal(readUnsavedChanges('m1')?.id, 'newer', 'the newer copy survives');
    forgetUnsavedChanges('m1', 'newer');
    assert.equal(readUnsavedChanges('m1'), null);
  });

  it('clearing without an id removes whatever is kept', () => {
    keepUnsavedChanges(copy('r1', 'x'));
    forgetUnsavedChanges('m1');
    assert.equal(readUnsavedChanges('m1'), null);
  });

  it('a copy kept before ids existed is identified by when it was kept, and can still be cleared by that', () => {
    const { id: _dropped, ...legacy } = copy('ignored', 'Legacy');
    storage.setItem('alma.menus.unsaved.m1', JSON.stringify(legacy));
    const read = readUnsavedChanges('m1');
    assert.equal(read?.id, legacy.keptAt);
    forgetUnsavedChanges('m1', read!.id);
    assert.equal(readUnsavedChanges('m1'), null);
  });

  it('says so when the browser cannot keep the copy, and ignores unreadable data', () => {
    storage.failWrites = true;
    assert.equal(keepUnsavedChanges(copy('r1', 'x')), false);
    storage.failWrites = false;
    storage.setItem('alma.menus.unsaved.m1', '{not json');
    assert.equal(readUnsavedChanges('m1'), null);
  });

  it('mints distinct ids', () => {
    assert.notEqual(newRecoveryId(), newRecoveryId());
  });
});

describe('saveConfirmsApply — which save may clear an applied copy', () => {
  const pending = { recoveryId: 'r1', editSeq: 7 };

  it('no apply pending: nothing to confirm', () => {
    assert.equal(saveConfirmsApply(null, 99), false);
  });

  it('a save that sent a document from before the apply does not confirm it', () => {
    assert.equal(saveConfirmsApply(pending, 6), false);
  });

  it('a save that sent the applied document, or a later one, does', () => {
    assert.equal(saveConfirmsApply(pending, 7), true);
    assert.equal(saveConfirmsApply(pending, 9), true);
  });
});
