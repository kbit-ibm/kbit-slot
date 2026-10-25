"""Exact MILP: same optimum as enumeration on small warehouses, the engine's bound below it, and size limits."""
import itertools
import unittest

import numpy as np

from server import engine, exact
from server.quantum import swap_qaoa
from server.tests.fixtures import demo

SPEC = {'layout': {'aisles': ['A', 'B'], 'bays': 4, 'reserved': []},
        'products': [{'id': i, 'sku': f'P{i}', 'name': f'Producto {i}', 'family': i % 2} for i in range(6)], 'groups': ['Ligero', 'Pesado']}


def orders(seed):
    rng = np.random.default_rng(seed)
    return [{'id': f'O{k}', 'items': sorted(set(rng.integers(0, 6, size=rng.integers(2, 5)).tolist()))} for k in range(40)]


def enumerate_optimum(problem):
    """Every placement of the 6 products in the 8 slots that passes the rules (20 160 candidates)."""
    candidates = np.array([p for p in itertools.permutations(problem.assignable.tolist(), problem.n)])
    ok = problem.allowed[np.arange(problem.n), candidates].all(axis=1)
    ok &= (candidates != problem.initial).sum(axis=1) <= problem.max_moves
    for i in problem.pinned:
        ok &= candidates[:, i] == problem.initial[i]
    return float(problem.costs(candidates[ok]).min())


class Exact(unittest.TestCase):
    def test_matches_enumeration_with_limits_pinned_and_zones(self):
        for seed in (1, 2):
            data = orders(seed)
            for rules in ({'pinned': []}, {'maxMoves': 2, 'pinned': []}, {'maxMoves': 3, 'pinned': [0]},
                          {'pinned': [1], 'zones': [{'id': 'pesados', 'families': [1], 'aisles': ['B']}]}):
                initial = [0, 4, 1, 5, 2, 6] if rules.get('zones') else list(range(6))  # heavy products start in aisle B
                problem = swap_qaoa.Problem.from_json(engine.problem(SPEC, initial, data, rules))
                target, summary = exact.solve(problem, 30)
                self.assertEqual(summary['status'], 'óptimo')
                self.assertAlmostEqual(summary['value'], enumerate_optimum(problem), places=6)
                problem.check(target)
                plan = engine.plan_from(SPEC, initial, data, rules, target.tolist(), summary)
                self.assertAlmostEqual(plan['after'], summary['value'], places=6)
                self.assertLess(plan['bound']['gap'], 1e-6)
                classical = engine.solve(SPEC, initial, data, rules, {'iterations': 0})
                self.assertLessEqual(classical['bound']['value'], summary['value'] + 1e-9, 'la cota de Gilmore–Lawler supera el óptimo')

    def test_demo_with_pinned_products_is_proven_optimal(self):
        data = demo()
        rules = {'maxMoves': 4, 'pinned': list(range(8, 30)), 'cleaningZone': True}
        problem = swap_qaoa.Problem.from_json(engine.problem({}, data['assignment'], data['orders'], rules))
        target, summary = exact.solve(problem, 60)
        self.assertTrue(summary['optimal'])
        self.assertLessEqual(problem.moved(target), 4)
        annealed = engine.solve({}, data['assignment'], data['orders'], rules)
        self.assertGreaterEqual(annealed['after'], summary['value'] - 1e-9)
        self.assertLessEqual(annealed['bound']['value'], summary['value'] + 1e-9)

    def test_large_instances_are_rejected_with_a_clear_message(self):
        data = demo()
        problem = swap_qaoa.Problem.from_json(engine.problem({}, data['assignment'], data['orders'], {'pinned': []}))
        with self.assertRaisesRegex(exact.TooLarge, 'movibles'):
            exact.model(problem)


if __name__ == '__main__':
    unittest.main()
