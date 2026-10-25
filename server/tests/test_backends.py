"""Simulated backends: catalogue, memory limits and agreement on a known circuit."""
import unittest

from qiskit import QuantumCircuit

from server.quantum import backends


class Simulators(unittest.TestCase):
    def test_catalog_and_limits(self):
        ids = {b.id: b for b in backends.catalog()}
        self.assertTrue({'statevector', 'aer_statevector', 'aer_mps', 'fake_torino', 'fake_fez'} <= set(ids))
        self.assertEqual(ids['fake_torino'].kind, 'noisy')
        self.assertEqual(backends.statevector_limit(16 * 2 ** 20 / backends.MEMORY_SHARE), 20)
        with self.assertRaises(ValueError):
            backends.check_capacity(ids['statevector'], ids['statevector'].max_qubits + 1)

    def test_every_simulator_agrees_on_a_small_circuit(self):
        circuit = QuantumCircuit(3); circuit.x(0); circuit.h(2); circuit.measure_all()
        for backend in ('statevector', 'aer_statevector', 'aer_mps'):
            counts, meta = backends.sample(backend, circuit, 400, 5)
            self.assertEqual(set(counts), {'001', '101'}, backend)
            self.assertTrue(meta['exact'], backend)


    def test_noisy_device_reports_isa_cost_and_degrades_a_known_state(self):
        circuit = QuantumCircuit(3); circuit.x(0); circuit.h(2); circuit.cx(0, 1); circuit.measure_all()
        counts, meta = backends.sample('fake_torino', circuit, 2000, 3)
        self.assertTrue(meta['noisy'])
        self.assertFalse(meta['exact'])
        self.assertGreater(meta['isaTwoQubitGates'], 0)
        self.assertTrue(0 < meta['esp'] < 1)
        self.assertGreater(sum(counts.get(k, 0) for k in ('011', '111')), 1500)  # still mostly right
        self.assertGreater(len(counts), 2)                                     # but noise leaks into other states
        from server.quantum import hybrid
        options = hybrid.settings({'backend': 'fake_torino'})
        self.assertEqual((options['qubits'], options['layers'], options['blocksPerRound']), (8, 2, 4), 'valores de hardware')


if __name__ == '__main__':
    unittest.main()
