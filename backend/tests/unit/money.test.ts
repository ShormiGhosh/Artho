import { describe, expect, it } from 'vitest';
import { bdtToPaisa, formatBdt, MoneyError, paisaToBdtString } from '../../src/utils/money';

describe('bdtToPaisa', () => {
  it('converts whole and fractional BDT precisely', () => {
    expect(bdtToPaisa('2500')).toBe(250000n);
    expect(bdtToPaisa('2500.5')).toBe(250050n);
    expect(bdtToPaisa('2500.75')).toBe(250075n);
    expect(bdtToPaisa('0.01')).toBe(1n);
    expect(bdtToPaisa(1234.56)).toBe(123456n);
  });

  it('rejects invalid amounts', () => {
    for (const bad of ['0', '-1', '2500.555', 'abc', '', '1e3', '2,500', ' ']) {
      expect(() => bdtToPaisa(bad)).toThrow(MoneyError);
    }
  });

  it('has no floating point drift on classic cases', () => {
    // 0.1 + 0.2 in paisa space
    expect(bdtToPaisa('0.10') + bdtToPaisa('0.20')).toBe(bdtToPaisa('0.30'));
    expect(bdtToPaisa('2500.10') + bdtToPaisa('3400.20')).toBe(bdtToPaisa('5900.30'));
  });
});

describe('paisaToBdtString / formatBdt', () => {
  it('round-trips', () => {
    expect(paisaToBdtString(250075n)).toBe('2500.75');
    expect(paisaToBdtString(1n)).toBe('0.01');
    expect(paisaToBdtString(0n)).toBe('0.00');
  });

  it('formats with a currency symbol and thousands separators', () => {
    expect(formatBdt(10000000n)).toBe('৳100,000.00');
    expect(formatBdt(250075n)).toBe('৳2,500.75');
  });
});
