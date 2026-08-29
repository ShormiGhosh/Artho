import crypto from 'crypto';

export interface DebtEdge {
  debtor_id: string;
  creditor_id: string;
  amount_paisa: bigint;
}

export interface PlanLine {
  from: string;
  to: string;
  amount_paisa: bigint;
}

/**
 * Net position per member: (total owed to them) − (total they owe), in paisa.
 * Positive = a creditor, negative = a debtor, absent/zero = settled.
 * The sum over all members is always exactly 0.
 */
export function computeNetBalances(debts: DebtEdge[]): Map<string, bigint> {
  const net = new Map<string, bigint>();
  const bump = (id: string, delta: bigint) => net.set(id, (net.get(id) ?? 0n) + delta);
  for (const d of debts) {
    bump(d.creditor_id, d.amount_paisa);
    bump(d.debtor_id, -d.amount_paisa);
  }
  return net;
}

/**
 * Minimise the number of transfers needed to bring every net balance to zero.
 *
 *  1. Settle any debtor/creditor whose magnitudes match exactly (1 transfer clears 2 people).
 *  2. Greedily match the largest remaining debtor with the largest remaining creditor.
 *
 * Produces at most (nonZeroMembers − 1) transfers, fully settles every balance,
 * and is deterministic (ties broken by user id) so the same inputs always yield
 * the same plan — which the settlement's idempotency depends on.
 */
export function optimizeSettlement(net: Map<string, bigint>): PlanLine[] {
  const debtors = [...net.entries()]
    .filter(([, v]) => v < 0n)
    .map(([id, v]) => ({ id, amt: -v }));
  const creditors = [...net.entries()]
    .filter(([, v]) => v > 0n)
    .map(([id, v]) => ({ id, amt: v }));

  const byAmountThenId = (a: { id: string; amt: bigint }, b: { id: string; amt: bigint }) =>
    a.amt > b.amt ? -1 : a.amt < b.amt ? 1 : a.id < b.id ? -1 : 1;

  const plan: PlanLine[] = [];

  // Pass 1 — exact matches.
  for (const dr of debtors) {
    if (dr.amt === 0n) continue;
    const cr = creditors.find((c) => c.amt === dr.amt);
    if (cr) {
      plan.push({ from: dr.id, to: cr.id, amount_paisa: dr.amt });
      dr.amt = 0n;
      cr.amt = 0n;
    }
  }

  // Pass 2 — greedy: each round pick the largest remaining debtor and creditor.
  const dRem = debtors.filter((d) => d.amt > 0n);
  const cRem = creditors.filter((c) => c.amt > 0n);
  const pickMax = (arr: { id: string; amt: bigint }[]) => {
    let best = -1;
    for (let k = 0; k < arr.length; k++) {
      if (arr[k].amt <= 0n) continue;
      if (best === -1 || byAmountThenId(arr[k], arr[best]) < 0) best = k;
    }
    return best;
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const di = pickMax(dRem);
    const ci = pickMax(cRem);
    if (di === -1 || ci === -1) break;
    const pay = dRem[di].amt < cRem[ci].amt ? dRem[di].amt : cRem[ci].amt;
    plan.push({ from: dRem[di].id, to: cRem[ci].id, amount_paisa: pay });
    dRem[di].amt -= pay;
    cRem[ci].amt -= pay;
  }

  return plan.filter((p) => p.amount_paisa > 0n);
}

/**
 * Apply a plan to a set of net balances and return the residual balances.
 * Used to reconcile a partially-completed settlement.
 */
export function applyPlan(net: Map<string, bigint>, lines: PlanLine[]): Map<string, bigint> {
  const out = new Map(net);
  for (const l of lines) {
    out.set(l.from, (out.get(l.from) ?? 0n) + l.amount_paisa); // debtor pays -> net rises toward 0
    out.set(l.to, (out.get(l.to) ?? 0n) - l.amount_paisa); // creditor received -> net falls toward 0
  }
  return out;
}

/**
 * Stable fingerprint of "the debts being settled" + "the plan". If any debt is
 * added/changed between preview and execute the hash changes, so a stale
 * confirmation is rejected.
 */
export function planHash(debtIds: string[], plan: PlanLine[]): string {
  const debtsPart = [...debtIds].sort().join(',');
  const planPart = plan
    .map((p) => `${p.from}>${p.to}:${p.amount_paisa}`)
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(`${debtsPart}#${planPart}`).digest('hex');
}
