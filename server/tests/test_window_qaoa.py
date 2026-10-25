"""Window encoding: exact model on valid assignments, one-hot penalties, Hungarian repair and rules."""
import unittest

import numpy as np
from qiskit.quantum_info import Statevector

from server import engine
from server.quantum import hybrid, swap_qaoa
from server.quantum.qubo import ramp_circuit
from server.quantum.window_qaoa import WindowBlock
from server.tests.fixtures import demo

OPTIONS = {**hybrid.DEFAULTS, 'window': 3, 'freeSlots': 1}


class Window(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        data = demo()
        cls.rules = {'maxMoves': 8, 'pinned': [10], 'cleaningZone': True}
        cls.data = data
        cls.problem = swap_qaoa.Problem.from_json(engine.problem({}, data['assignment'], data['orders'], cls.rules))
        cls.start = np.array(data['assignment'])
        cls.block = WindowBlock(cls.problem, cls.start, OPTIONS, np.random.default_rng(5))

    def all_bits(self):
        q = self.block.qubits
        return ((np.arange(2 ** q)[:, None] >> np.arange(q)) & 1)

    def test_window_respects_pinned_products_and_zones(self):
        self.assertNotIn(10, self.block.products)
        for a, b in self.block.vars:
            self.assertTrue(self.problem.allowed[self.block.products[a], self.block.slots[b]])
        self.assertLessEqual(self.block.qubits, 3 * 4)

    def test_model_is_the_exact_index_on_valid_assignments_and_penalties_vanish_there(self):
        bits = self.all_bits()
        valid = [row for row in bits if self.block.valid(row)[0]]
        self.assertGreater(len(valid), 1)
        for row in valid:
            p = self.block.assignment(self.block.valid(row)[1])
            self.assertAlmostEqual(float(self.block.cost_model.evaluate(row)[0]), self.problem.cost(p), places=6)
            self.assertAlmostEqual(float(self.block.one_hot.evaluate(row)[0]), 0, places=6)
        invalid = [row for row in bits if not self.block.valid(row)[0]]
        self.assertTrue(all(self.block.one_hot.evaluate(row)[0] > 0 for row in invalid[:200]))

    def test_hungarian_repair_returns_valid_assignments_close_to_the_sample(self):
        rng = np.random.default_rng(1)
        for _ in range(30):
            row = rng.integers(0, 2, self.block.qubits)
            pairs = self.block.hungarian(row)
            self.assertEqual(sorted(a for a, _ in pairs), list(range(len(self.block.products))))
            self.assertEqual(len({b for _, b in pairs}), len(pairs))
            for a, b in pairs:
                self.assertTrue(np.isfinite(self.block.linear_cost[a, b]))

    def test_exact_control_beats_any_decided_sample(self):
        best, value, _ = self.block.exact()
        self.problem.check(best)
        counts = {format(int(i), f'0{self.block.qubits}b'): 1 for i in np.random.default_rng(2).integers(0, 2 ** self.block.qubits, 64)}
        _, decided, _ = self.block.decide(counts)
        self.assertLessEqual(value, decided + 1e-9)

    def test_circuit_favours_valid_assignments(self):
        # One-hot constraints need the default p = 4: with p = 2 the valid mass can fall below uniform.
        steered = self.block.steered(OPTIONS['penalty'])
        circuit = ramp_circuit(steered, OPTIONS['layers'], OPTIONS['deltaBeta'], OPTIONS['deltaGamma'])
        circuit.remove_final_measurements()
        probabilities = Statevector(circuit).probabilities()
        bits = self.all_bits()
        valid = np.array([self.block.valid(row)[0] for row in bits])
        self.assertGreater(probabilities[valid].sum(), 3 * valid.mean())

    def test_hybrid_window_and_mixed_runs_respect_the_rules(self):
        for encoding in ('window', 'mixed'):
            target, summary = hybrid.solve(self.problem, self.start, {'backend': 'statevector', 'encoding': encoding, 'window': 3, 'blocks': 4, 'layers': 2, 'seed': 4})
            self.problem.check(target)
            self.assertLessEqual(self.problem.cost(target), self.problem.cost(self.start))
            self.assertEqual(summary['encoding'], encoding)
        plan = engine.plan_from({}, self.data['assignment'], self.data['orders'], self.rules, target, summary)
        self.assertEqual(plan['after'], self.problem.cost(target))


if __name__ == '__main__':
    unittest.main()
