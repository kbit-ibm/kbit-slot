"""Job API end to end, with the same engine the browser uses."""
import time
import unittest

from fastapi.testclient import TestClient

from server.app import app
from server.tests.fixtures import demo

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
        self.assertEqual(health['solvers'], ['clasico'])
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

    def test_invalid_requests_are_rejected(self):
        self.assertEqual(client.post('/api/solve', json={**self.body, 'solver': 'magia'}).status_code, 422)
        self.assertEqual(client.post('/api/solve', json={**self.body, 'extra': 1}).status_code, 422)
        self.assertEqual(client.get('/api/jobs/nada').status_code, 404)
        broken = wait(client.post('/api/solve', json={**self.body, 'rules': {'zones': [{'families': [0], 'aisles': ['Z']}]}}).json()['id'])
        self.assertEqual(broken['status'], 'failed')
        self.assertIn('Z', broken['error'])

    def test_cors_allows_the_app_opened_as_a_file(self):
        response = client.get('/api/health', headers={'Origin': 'null'})
        self.assertEqual(response.headers.get('access-control-allow-origin'), 'null')
        self.assertIsNone(client.get('/api/health', headers={'Origin': 'https://ejemplo.com'}).headers.get('access-control-allow-origin'))

    def test_serves_the_app(self):
        self.assertIn('Kbit Slot', client.get('/').text)


if __name__ == '__main__':
    unittest.main()
