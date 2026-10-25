"""IBM hardware path in local mode (no account): same transpilation, Sampler options, job polling and API key checks."""
import os
import time
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from server import engine
from server.app import app
from server.quantum import backends, hybrid, ibm
from server.quantum.swap_qaoa import Problem
from server.tests.fixtures import demo

LOCAL = {'KBIT_IBM_LOCAL': '1', 'KBIT_API_KEY': 'clave-de-prueba'}


class Hardware(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = demo()
        cls.rules = {'maxMoves': 8, 'pinned': [10], 'cleaningZone': True}

    def test_devices_need_an_account_or_local_mode_and_the_service_key(self):
        with mock.patch.dict(os.environ, {'KBIT_IBM_LOCAL': '0'}):
            self.assertFalse(ibm.has_account())
            self.assertEqual(ibm.catalog(), [])
        with mock.patch.dict(os.environ, {'KBIT_IBM_LOCAL': '1', 'KBIT_API_KEY': ''}):
            entry = next(b for b in backends.catalog() if b.id == 'ibm:fake_torino')
            self.assertFalse(entry.available)
            self.assertIn('KBIT_API_KEY', entry.reason)
        with mock.patch.dict(os.environ, LOCAL):
            entry = backends.find('ibm:fake_torino')
            self.assertEqual((entry.kind, entry.max_qubits), ('ibm', ibm.HARDWARE_QUBITS))

    def test_runner_transpiles_mitigates_and_reports_each_job(self):
        with mock.patch.dict(os.environ, LOCAL):
            runner = backends.open_runner('ibm:fake_torino', {})
            self.assertTrue(runner.sampler.options.dynamical_decoupling.enable)
            self.assertTrue(runner.sampler.options.twirling.enable_gates)
            from qiskit import QuantumCircuit
            circuit = QuantumCircuit(2); circuit.x(0); circuit.measure_all()
            (counts, meta), (other, _) = runner.run([circuit, circuit], 300, 1)
            total = sum(counts.values())  # twirling rounds the shots up to whole randomizations
            self.assertGreaterEqual(total, 300)
            self.assertGreater(counts.get('01', 0), .8 * total)
            self.assertEqual(len(runner.usage['jobs']), 1, 'los circuitos de una ronda van en un trabajo')
            self.assertTrue(meta['jobId'] and meta['noisy'] and 0 < meta['esp'] <= 1)

    def test_hybrid_uses_hardware_defaults_and_one_job_per_round(self):
        with mock.patch.dict(os.environ, LOCAL):
            problem = Problem.from_json(engine.problem({}, self.data['assignment'], self.data['orders'], self.rules))
            options = hybrid.settings({'backend': 'ibm:fake_torino'})
            self.assertEqual((options['qubits'], options['layers'], options['blocksPerRound']), (8, 2, 4))
            target, summary = hybrid.solve(problem, self.data['assignment'], {'backend': 'ibm:fake_torino', 'qubits': 6, 'blocks': 4, 'blocksPerRound': 2})
            problem.check(target)
            self.assertEqual(summary['rounds'], 2)
            self.assertEqual(len(summary['jobs']), 2)
            self.assertTrue(summary['noisy'])

    def test_api_requires_the_service_key_for_hardware(self):
        client = TestClient(app)
        body = {'initial': self.data['assignment'], 'orders': self.data['orders'], 'rules': self.rules, 'solver': 'qaoa',
                'options': {'backend': 'ibm:fake_torino', 'qubits': 4, 'blocks': 1, 'blocksPerRound': 1, 'layers': 1, 'shots': 128}}
        with mock.patch.dict(os.environ, {'KBIT_IBM_LOCAL': '1', 'KBIT_API_KEY': ''}):
            self.assertEqual(client.post('/api/solve', json=body).status_code, 403)
        with mock.patch.dict(os.environ, LOCAL):
            self.assertEqual(client.post('/api/solve', json=body).status_code, 401)
            self.assertEqual(client.post('/api/solve', json=body, headers={'X-Kbit-Key': 'otra'}).status_code, 401)
            job = client.post('/api/solve', json=body, headers={'X-Kbit-Key': LOCAL['KBIT_API_KEY']}).json()
            deadline = time.time() + 120
            while job['status'] in ('queued', 'running') and time.time() < deadline:
                time.sleep(.2)
                job = client.get(f"/api/jobs/{job['id']}").json()
            self.assertEqual(job['status'], 'done', job['error'])
            self.assertEqual(len(job['result']['solver']['jobs']), 1)
            health = client.get('/api/health').json()
            self.assertEqual(health['hardware'], {'account': True, 'keyConfigured': True})


if __name__ == '__main__':
    unittest.main()
