import { describe, expect, it } from 'vitest';
import { categorise } from '../../src/utils/category';

describe('categorise (deterministic spend categorisation)', () => {
  it('maps food-related notes to Food', () => {
    expect(categorise('Lunch with team')).toBe('Food');
    expect(categorise('grocery shopping at bazar')).toBe('Food');
    expect(categorise('Coffee')).toBe('Food');
  });

  it('maps transport notes to Transport', () => {
    expect(categorise('Uber to office')).toBe('Transport');
    expect(categorise('CNG fare')).toBe('Transport');
  });

  it('maps rent to Housing', () => {
    expect(categorise('October house rent')).toBe('Housing');
  });

  it('maps utility notes to Utilities', () => {
    expect(categorise('electricity bill')).toBe('Utilities');
    expect(categorise('internet recharge')).toBe('Utilities');
  });

  it('returns Uncategorised for empty / unknown notes', () => {
    expect(categorise(null)).toBe('Uncategorised');
    expect(categorise('')).toBe('Uncategorised');
    expect(categorise('xyz random text 123')).toBe('Uncategorised');
  });

  it('is case-insensitive and stable across calls', () => {
    expect(categorise('DINNER')).toBe('Food');
    expect(categorise('dinner')).toBe(categorise('Dinner'));
  });

  it('respects rule ordering (first match wins)', () => {
    // "food" (Food) is checked before "gift" (Family & Friends)
    expect(categorise('food gift for friend')).toBe('Food');
  });
});
