"""Job API end to end, with the same engine the browser uses."""
import time
import unittest

from fastapi.testclient import TestClient

from server.app import app
from server.tests.fixtures import demo, designed

client = TestClient(app)


def wait(job_id, timeout=120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f'/api/jobs/{job_id}').json()
        if job['status'] in ('done', 'failed', 'cancelled'):
            return job
        time.sleep(.05)
    raise AssertionError('el trabajo no terminó a tiempo')


class Api(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        data = demo()
        cls.body = {'initial': data['assignment'], 'orders': data['orders'], 'rules': {'maxMoves': 8, 'pinned': [10], 'cleaningZone': True}}

    def test_health_lists_versions_solvers_and_simulators(self):
        health = client.get('/api/health').json()
        self.assertEqual(health['status'], 'ok')
        self.assertIn('qaoa', health['solvers'])
        self.assertTrue(health['versions']['qiskit'] and health['versions']['node'])
        self.assertIn('aer_mps', [b['id'] for b in health['backends']])
        self.assertEqual(client.get('/api/backends').json(), health['backends'])

    def test_classical_job_matches_the_browser_engine(self):
        job = wait(client.post('/api/solve', json=self.body).json()['id'])
        self.assertEqual(job['status'], 'done', job['error'])
        plan = job['result']
        self.assertEqual(plan['solver']['id'], 'voraz+recocido')
        self.assertEqual(plan['before'], 4454)
        self.assertLessEqual(plan['after'], 3256)
        self.assertEqual(job['progress']['progress'], 1)

    def test_hybrid_job_returns_a_validated_plan_with_quantum_metrics(self):
        body = {**self.body, 'solver': 'qaoa', 'options': {'backend': 'statevector', 'qubits': 8, 'blocks': 4, 'layers': 2}}
        job = wait(client.post('/api/solve', json=body).json()['id'])
        self.assertEqual(job['status'], 'done', job['error'])
        solver = job['result']['solver']
        self.assertEqual(solver['id'], 'qaoa-intercambios')
        self.assertEqual(solver['start'], 'none')
        self.assertEqual(solver['blocks'], 4)
        self.assertLessEqual(job['result']['after'], 4454)
        self.assertLessEqual(job['result']['moved'], 8)

    def test_cancel_a_running_job(self):
        body = {**self.body, 'solver': 'qaoa', 'options': {'backend': 'statevector', 'qubits': 10, 'blocks': 400, 'seconds': 120}}
        job_id = client.post('/api/solve', json=body).json()['id']
        while client.get(f'/api/jobs/{job_id}').json()['status'] == 'queued':
            time.sleep(.05)
        time.sleep(.5)
        self.assertEqual(client.delete(f'/api/jobs/{job_id}').status_code, 200)
        self.assertEqual(wait(job_id)['status'], 'cancelled')

    def test_invalid_requests_are_rejected(self):
        self.assertEqual(client.post('/api/solve', json={**self.body, 'solver': 'magia'}).status_code, 422)
        self.assertEqual(client.post('/api/solve', json={**self.body, 'extra': 1}).status_code, 422)
        self.assertEqual(client.get('/api/jobs/nada').status_code, 404)
        broken = wait(client.post('/api/solve', json={**self.body, 'rules': {'zones': [{'families': [0], 'aisles': ['Z']}]}}).json()['id'])
        self.assertEqual(broken['status'], 'failed')
        self.assertIn('Z', broken['error'])
        bad_option = wait(client.post('/api/solve', json={**self.body, 'solver': 'qaoa', 'options': {'start': 'magia'}}).json()['id'])
        self.assertEqual(bad_option['status'], 'failed')

    def test_exact_job_proves_the_optimum_of_a_small_instance(self):
        body = {**self.body, 'rules': {'maxMoves': 4, 'pinned': list(range(8, 30)), 'cleaningZone': True}, 'solver': 'exacto', 'options': {'timeLimit': 60}}
        job = wait(client.post('/api/solve', json=body).json()['id'])
        self.assertEqual(job['status'], 'done', job['error'])
        plan = job['result']
        self.assertEqual(plan['solver']['id'], 'exacto')
        self.assertEqual(plan['solver']['status'], 'óptimo')
        self.assertAlmostEqual(plan['bound']['value'], plan['after'], places=6)
        self.assertIn('exacto', client.get('/api/health').json()['solvers'])
        large = wait(client.post('/api/solve', json={**self.body, 'solver': 'exacto'}).json()['id'])
        self.assertEqual(large['status'], 'failed')
        self.assertIn('movibles', large['error'])
        bad = wait(client.post('/api/solve', json={**body, 'options': {'timeLimit': 0}}).json()['id'])
        self.assertIn('límite de tiempo', bad['error'])

    def test_cors_allows_the_app_opened_as_a_file(self):
        response = client.get('/api/health', headers={'Origin': 'null'})
        self.assertEqual(response.headers.get('access-control-allow-origin'), 'null')
        self.assertIsNone(client.get('/api/health', headers={'Origin': 'https://ejemplo.com'}).headers.get('access-control-allow-origin'))

    def test_designed_warehouse_in_complete_mode_runs_classical_and_hybrid(self):
        data = designed()
        rules = {'maxMoves': 6, 'pinned': [], 'zones': []}
        for solver, options in (('clasico', {'iterations': 2000, 'restarts': 2}), ('qaoa', {'backend': 'statevector', 'qubits': 6, 'blocks': 3, 'layers': 2})):
            job = wait(client.post('/api/solve', json={'spec': data['spec'], 'initial': data['assignment'], 'orders': data['orders'], 'rules': rules,
                                                       'solver': solver, 'options': options}).json()['id'])
            self.assertEqual(job['status'], 'done', job['error'])
            self.assertLess(job['result']['after'], job['result']['before'])
            self.assertLessEqual(job['result']['moved'], 6)

    def test_serves_the_app(self):
        self.assertIn('Kbit Slot', client.get('/').text)


if __name__ == '__main__':
    unittest.main()
