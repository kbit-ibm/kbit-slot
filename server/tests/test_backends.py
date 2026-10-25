"""Simulated backends: catalogue, memory limits and agreement on a known circuit."""
import unittest

from qiskit import QuantumCircuit

from server.quantum import backends


class Simulators(unittest.TestCase):
    def test_catalog_and_limits(self):
        ids = {b.id: b for b in backends.catalog()}
        self.assertTrue({'statevector', 'aer_statevector', 'aer_mps'} <= set(ids))
        self.assertEqual(backends.statevector_limit(16 * 2 ** 20 / backends.MEMORY_SHARE), 20)
        with self.assertRaises(ValueError):
            backends.check_capacity(ids['statevector'], ids['statevector'].max_qubits + 1)

    def test_every_simulator_agrees_on_a_small_circuit(self):
        circuit = QuantumCircuit(3); circuit.x(0); circuit.h(2); circuit.measure_all()
        for backend in ('statevector', 'aer_statevector', 'aer_mps'):
            counts, meta = backends.sample(backend, circuit, 400, 5)
            self.assertEqual(set(counts), {'001', '101'}, backend)
            self.assertTrue(meta['exact'], backend)


if __name__ == '__main__':
    unittest.main()
