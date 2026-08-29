import { describe, expect, it } from 'vitest';
import {
  applyPlan,
  computeNetBalances,
  optimizeSettlement,
  planHash,
  type DebtEdge,
} from '../../src/utils/settlement';

const edge = (debtor: string, creditor: string, amt: number): DebtEdge => ({
  debtor_id: debtor,
  creditor_id: creditor,
  amount_paisa: BigInt(amt),
});

function assertFullySettles(debts: DebtEdge[]) {
  const net = computeNetBalances(debts);
  const plan = optimizeSettlement(net);
  const residual = applyPlan(net, plan);
  for (const [, v] of residual) expect(v).toBe(0n);
  for (const p of plan) expect(p.amount_paisa > 0n).toBe(true);
  const nonZero = [...net.values()].filter((v) => v !== 0n).length;
  expect(plan.length).toBeLessThanOrEqual(Math.max(nonZero - 1, 0));
  return plan;
}

describe('computeNetBalances', () => {
  it('sums to zero and matches the classic example', () => {
    const debts = [edge('A', 'B', 500), edge('B', 'C', 800), edge('C', 'A', 300)];
    const net = computeNetBalances(debts);
    expect(net.get('A')).toBe(-200n);
    expect(net.get('B')).toBe(-300n);
    expect(net.get('C')).toBe(500n);
    expect([...net.values()].reduce((a, b) => a + b, 0n)).toBe(0n);
  });
});

describe('optimizeSettlement', () => {
  it('produces the expected plan for the spec example', () => {
    const debts = [edge('A', 'B', 500), edge('B', 'C', 800), edge('C', 'A', 300)];
    const plan = optimizeSettlement(computeNetBalances(debts));
    const norm = plan
      .map((p) => `${p.from}->${p.to}:${p.amount_paisa}`)
      .sort();
    expect(norm).toEqual(['A->C:200', 'B->C:300']);
    expect(plan.length).toBe(2); // down from 3 original debts
  });

  it('collapses a chain of equal debts into one transfer', () => {
    // A->B 100, B->C 100, C->D 100  => net: A -100, D +100, B/C zero
    const debts = [edge('A', 'B', 100), edge('B', 'C', 100), edge('C', 'D', 100)];
    const plan = assertFullySettles(debts);
    expect(plan).toEqual([{ from: 'A', to: 'D', amount_paisa: 100n }]);
  });

  it('excludes zero-balance members entirely', () => {
    // X and Y net out to zero, only P and Q have balances
    const debts = [edge('X', 'Y', 50), edge('Y', 'X', 50), edge('P', 'Q', 400)];
    const plan = assertFullySettles(debts);
    expect(plan).toEqual([{ from: 'P', to: 'Q', amount_paisa: 400n }]);
    for (const p of plan) {
      expect(p.from === 'X' || p.from === 'Y' || p.to === 'X' || p.to === 'Y').toBe(false);
    }
  });

  it('uses the exact-match pass to clear pairs in one hop', () => {
    // debtors A(-300) B(-200) ; creditors C(+300) D(+200)  -> 2 transfers, exact
    const net = new Map<string, bigint>([
      ['A', -300n],
      ['B', -200n],
      ['C', 300n],
      ['D', 200n],
    ]);
    const plan = optimizeSettlement(net);
    expect(plan.length).toBe(2);
    const norm = plan.map((p) => `${p.from}->${p.to}:${p.amount_paisa}`).sort();
    expect(norm).toEqual(['A->C:300', 'B->D:200']);
  });

  it('handles multiple debtors and multiple creditors', () => {
    const debts = [
      edge('A', 'E', 1000),
      edge('B', 'E', 500),
      edge('C', 'D', 700),
      edge('B', 'D', 300),
      edge('A', 'D', 200),
    ];
    // net: A -1200, B -800, C -700, D +1200, E +1500  (sum 0)
    const plan = assertFullySettles(debts);
    expect(plan.length).toBeLessThanOrEqual(4); // n-1 for 5 non-zero members
  });

  it('is empty when everyone is square', () => {
    expect(optimizeSettlement(computeNetBalances([edge('A', 'B', 10), edge('B', 'A', 10)]))).toEqual(
      []
    );
  });

  it('is deterministic and correct on random groups of arbitrary size', () => {
    let seed = 987654321;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let trial = 0; trial < 200; trial++) {
      const n = 2 + Math.floor(rand() * 12);
      const members = Array.from({ length: n }, (_, i) => `U${i}`);
      const debts: DebtEdge[] = [];
      const edges = 1 + Math.floor(rand() * (n * 2));
      for (let e = 0; e < edges; e++) {
        let a = Math.floor(rand() * n);
        let b = Math.floor(rand() * n);
        if (a === b) b = (b + 1) % n;
        debts.push(edge(members[a], members[b], 1 + Math.floor(rand() * 5000)));
      }
      const net = computeNetBalances(debts);
      const plan1 = optimizeSettlement(net);
      const plan2 = optimizeSettlement(computeNetBalances(debts));
      expect(plan2).toEqual(plan1); // deterministic
      const residual = applyPlan(net, plan1);
      for (const [, v] of residual) expect(v).toBe(0n); // fully settles
      const nonZero = [...net.values()].filter((v) => v !== 0n).length;
      expect(plan1.length).toBeLessThanOrEqual(Math.max(nonZero - 1, 0)); // minimal bound
      for (const p of plan1) expect(p.amount_paisa > 0n).toBe(true);
    }
  });
});

describe('planHash', () => {
  it('changes when the debt set or plan changes, stable otherwise', () => {
    const p = [{ from: 'A', to: 'C', amount_paisa: 200n }];
    const h1 = planHash(['d1', 'd2'], p);
    expect(planHash(['d2', 'd1'], p)).toBe(h1); // order-independent
    expect(planHash(['d1', 'd2', 'd3'], p)).not.toBe(h1); // new debt
    expect(planHash(['d1', 'd2'], [{ from: 'A', to: 'C', amount_paisa: 201n }])).not.toBe(h1);
  });
});
