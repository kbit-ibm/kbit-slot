"""Swap model exactness, rule handling, circuit direction and the hybrid loop. Run: python -m unittest discover -s server/tests -t ."""
import threading
import unittest

import numpy as np
from qiskit.quantum_info import Statevector

from server import engine
from server.quantum import backends, swap_qaoa
from server.tests.fixtures import demo


class SwapModel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = demo()
        cls.rules = {'maxMoves': 8, 'pinned': [10], 'cleaningZone': True}
        cls.problem = swap_qaoa.Problem.from_json(engine.problem({}, cls.data['assignment'], cls.data['orders'], cls.rules))
        cls.start = np.array(cls.data['assignment'])

    def test_problem_matches_the_javascript_engine(self):
        self.assertEqual(self.problem.cost(self.start), 4454)
        self.assertEqual(self.problem.n, 30)
        self.assertFalse(self.problem.allowed[:, 31].any(), 'D08 está reservada')

    def test_single_swap_deltas_and_relocation_changes_are_exact(self):
        positions, pairs, deltas, changes = swap_qaoa.candidate_pairs(self.problem, self.start)
        base = self.problem.cost(self.start)
        for (u, v), delta, change in list(zip(pairs, deltas, changes))[::7]:
            p = positions.copy(); p[u], p[v] = p[v], p[u]
            self.assertAlmostEqual(self.problem.cost(p[:30]) - base, delta, places=6)
            self.assertEqual(self.problem.moved(p[:30]) - self.problem.moved(self.start), change)
        self.assertFalse(any(10 in pair for pair in pairs), 'el producto fijo no entra en pares')
        for u, v in pairs:  # zones: cleaning products (10–14) only trade places inside aisle D
            for item, other in ((u, v), (v, u)):
                if 10 <= item < 15:
                    self.assertGreaterEqual(positions[other], 24)

    def test_quadratic_model_is_exact_for_every_bitstring(self):
        positions, pairs, changes = swap_qaoa.select_pairs(self.problem, self.start, 8, np.random.default_rng(1), .5)
        model = swap_qaoa.build_model(self.problem, positions, pairs, changes)
        bits = ((np.arange(2 ** model.qubits)[:, None] >> np.arange(model.qubits)) & 1)
        real = self.problem.costs([model.decode(z) for z in bits])
        np.testing.assert_allclose(model.evaluate(bits), real, atol=1e-6)
        moved = [self.problem.moved(model.decode(z)) for z in bits]
        np.testing.assert_array_equal(self.problem.moved(self.start) + bits @ model.moved_change, moved)

    def test_circuit_concentrates_on_low_energies(self):
        positions, pairs, changes = swap_qaoa.select_pairs(self.problem, self.start, 10, np.random.default_rng(3), .5)
        model = swap_qaoa.build_model(self.problem, positions, pairs, changes)
        bits = ((np.arange(2 ** model.qubits)[:, None] >> np.arange(model.qubits)) & 1)
        energy = model.evaluate(bits)
        circuit = swap_qaoa.ramp_circuit(model, 4, .75, 1.5)
        circuit.remove_final_measurements()
        probabilities = Statevector(circuit).probabilities()
        self.assertLess(probabilities @ energy, energy.mean())
        self.assertGreater(probabilities[energy <= np.quantile(energy, .01)].sum(), .2)

    def test_repair_always_meets_the_relocation_limit(self):
        positions, pairs, changes = swap_qaoa.select_pairs(self.problem, self.start, 10, np.random.default_rng(4), .5)
        model = swap_qaoa.build_model(self.problem, positions, pairs, changes)
        for budget in (0, 2, 5):
            ones = np.ones(model.qubits, dtype=int)
            fixed = swap_qaoa.repair(model, ones, int(ones @ model.moved_change), budget)
            self.assertLessEqual(int(fixed @ model.moved_change), budget)

    def test_hybrid_respects_rules_and_reports_its_work(self):
        target, summary = swap_qaoa.solve(self.problem, self.start, {'backend': 'statevector', 'qubits': 8, 'blocks': 6, 'seed': 2})
        self.problem.check(target)
        self.assertLessEqual(self.problem.cost(target), 4454)
        self.assertEqual(summary['blocks'], 6)
        self.assertAlmostEqual(summary['qiskitGain'], 4454 - self.problem.cost(target))
        plan = engine.plan_from({}, self.data['assignment'], self.data['orders'], self.rules, target, summary)
        self.assertEqual(plan['after'], self.problem.cost(target))
        self.assertEqual(plan['solver']['id'], 'qaoa-intercambios')

    def test_cancellation_and_invalid_options(self):
        cancel = threading.Event(); cancel.set()
        with self.assertRaises(swap_qaoa.Cancelled):
            swap_qaoa.solve(self.problem, self.start, {'backend': 'statevector', 'qubits': 6, 'blocks': 3}, cancel=cancel)
        with self.assertRaises(ValueError):
            swap_qaoa.solve(self.problem, self.start, {'qubits': 0})
        with self.assertRaises(ValueError):
            swap_qaoa.solve(self.problem, self.start, {'backend': 'inexistente'})

    def test_mps_reaches_more_qubits_on_a_two_level_warehouse(self):
        data = demo(levels=2)
        rules = {'maxMoves': 20, 'pinned': [10], 'cleaningZone': True}
        problem = swap_qaoa.Problem.from_json(engine.problem(data['spec'], data['assignment'], data['orders'], rules))
        target, summary = swap_qaoa.solve(problem, data['assignment'], {'backend': 'aer_mps', 'qubits': 28, 'blocks': 1, 'layers': 1, 'shots': 256})
        problem.check(target)
        self.assertGreater(summary['qubits'], backends.find('statevector').max_qubits)
        self.assertFalse(summary['exact'], 'enlace 16 con 28 qubits es aproximado')


if __name__ == '__main__':
    unittest.main()
