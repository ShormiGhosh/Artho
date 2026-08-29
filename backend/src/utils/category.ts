/**
 * Deterministic spend categorisation.
 *
 * The app has no per-transaction category field, so we derive one from the
 * free-text note using a fixed keyword dictionary. This is pure, rule-based and
 * runs entirely in the backend — the AI never categorises or totals anything, it
 * only narrates the numbers this module (and SQL) produce.
 */

export type SpendCategory =
  | 'Food'
  | 'Transport'
  | 'Housing'
  | 'Utilities'
  | 'Shopping'
  | 'Health'
  | 'Education'
  | 'Entertainment'
  | 'Family & Friends'
  | 'Bills & Fees'
  | 'Uncategorised';

/** Ordered: the first category with a keyword hit wins. */
const RULES: Array<{ category: SpendCategory; keywords: string[] }> = [
  { category: 'Food', keywords: ['lunch', 'dinner', 'breakfast', 'food', 'restaurant', 'cafe', 'coffee', 'grocery', 'groceries', 'bazar', 'bazaar', 'snack', 'meal', 'iftar', 'khabar', 'hotel', 'biryani', 'tea'] },
  { category: 'Transport', keywords: ['uber', 'pathao', 'rickshaw', 'cng', 'bus', 'train', 'taxi', 'fuel', 'petrol', 'gas bill', 'fare', 'ride', 'flight', 'ticket', 'launch'] },
  { category: 'Housing', keywords: ['rent', 'house rent', 'flat', 'apartment', 'landlord', 'deposit', 'mess bill', 'hostel'] },
  { category: 'Utilities', keywords: ['electricity', 'wasa', 'water bill', 'gas', 'internet', 'wifi', 'broadband', 'mobile recharge', 'recharge', 'dish', 'utility'] },
  { category: 'Health', keywords: ['doctor', 'medicine', 'pharmacy', 'hospital', 'clinic', 'medical', 'diagnostic', 'test', 'dentist'] },
  { category: 'Education', keywords: ['tuition', 'school', 'college', 'university', 'course', 'exam fee', 'admission', 'books', 'coaching', 'semester'] },
  { category: 'Entertainment', keywords: ['movie', 'cinema', 'netflix', 'spotify', 'game', 'concert', 'subscription', 'youtube'] },
  { category: 'Shopping', keywords: ['shopping', 'clothes', 'shoe', 'dress', 'daraz', 'amazon', 'gift', 'electronics', 'phone', 'laptop', 'order'] },
  { category: 'Bills & Fees', keywords: ['bill', 'fee', 'fees', 'emi', 'loan', 'installment', 'insurance', 'tax', 'due', 'subscription fee'] },
  { category: 'Family & Friends', keywords: ['family', 'mom', 'dad', 'brother', 'sister', 'friend', 'gift', 'eidi', 'salami', 'help', 'borrow', 'lend', 'return', 'payback', 'settle'] },
];

/** Categorise a single note. Case-insensitive substring match; stable. */
export function categorise(note: string | null | undefined): SpendCategory {
  if (!note) return 'Uncategorised';
  const text = note.toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some((k) => text.includes(k))) return rule.category;
  }
  return 'Uncategorised';
}

export const ALL_CATEGORIES: SpendCategory[] = [
  'Food', 'Transport', 'Housing', 'Utilities', 'Shopping', 'Health',
  'Education', 'Entertainment', 'Family & Friends', 'Bills & Fees', 'Uncategorised',
];
