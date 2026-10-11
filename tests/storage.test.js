import { describe, expect, it } from 'vitest';
import './testDb.js';
import { saveDbToBrowser } from '../src/dbStorage.js';

describe('saveDbToBrowser', () => {
  it('coalesces overlapping saves into one follow-up export', async () => {
    let exports = 0;
    const db = { export: async () => { exports += 1; await new Promise((r) => setTimeout(r, 5)); return new Uint8Array([exports]); } };
    const saves = [saveDbToBrowser(db), saveDbToBrowser(db), saveDbToBrowser(db), saveDbToBrowser(db)];
    const results = await Promise.all(saves);
    expect(exports).toBe(2);
    expect(results[0]).toEqual(new Uint8Array([1]));
    expect(results[3]).toEqual(new Uint8Array([2]));
    await saveDbToBrowser(db);
    expect(exports).toBe(3);
  });
});
