import { sha256, stableStringify } from '../src/common/hash';

describe('hash utilities', () => {
  it('stableStringify sorts object keys recursively', () => {
    expect(stableStringify({ b: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":1}');
  });

  it('stableStringify preserves array order', () => {
    expect(stableStringify([{ b: 2, a: 1 }, 'x', null])).toBe('[{"a":1,"b":2},"x",null]');
  });

  it('sha256 is deterministic for semantically identical object payloads', () => {
    const first = sha256({ employeeId: 'emp-1', locationId: 'loc-1', days: 2 });
    const second = sha256({ days: 2, locationId: 'loc-1', employeeId: 'emp-1' });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});
