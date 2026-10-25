"""Shared quadratic-model helpers."""
import unittest

import numpy as np

from server.quantum.qubo import Qubo, bits_from_counts, uniform_counts


class QuboHelpers(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(0)
        self.model = Qubo(3., rng.normal(size=5), np.triu(rng.normal(size=(5, 5)), 1))
        self.bits = ((np.arange(32)[:, None] >> np.arange(5)) & 1)

    def test_unbalanced_penalization_adds_exactly_the_formula(self):
        change, slack, (l1, l2) = np.array([1, -1, 2, 0, 1]), 1, (.5, .1)
        steered = self.model.with_inequality(change, slack, (l1, l2))
        scale = max(float(np.std(self.model.linear)), float(np.max(np.abs(self.model.linear))) / 4, 1.)
        h = slack - self.bits @ change
        np.testing.assert_allclose(steered.evaluate(self.bits) - self.model.evaluate(self.bits), scale * (-l1 * h + l2 * h ** 2 - l2 * slack ** 2 + l1 * slack), atol=1e-9)
        self.assertIs(self.model.with_inequality(change, float('inf'), (l1, l2)), self.model)

    def test_plus_accepts_full_symmetric_quadratics(self):
        full = np.ones((5, 5)) - np.eye(5)
        np.testing.assert_allclose(self.model.plus(quadratic=full).evaluate(self.bits) - self.model.evaluate(self.bits),
                                   [row.sum() * (row.sum() - 1) for row in self.bits])

    def test_counts_round_trip_and_uniform_control(self):
        bits, shots = bits_from_counts({'00101': 3, '10000': 1}, 5)
        np.testing.assert_array_equal(bits, [[1, 0, 1, 0, 0], [0, 0, 0, 0, 1]])
        np.testing.assert_array_equal(shots, [3, 1])
        counts = uniform_counts(5, 400, np.random.default_rng(1))
        self.assertEqual(sum(counts.values()), 400)
        self.assertTrue(all(len(key) == 5 for key in counts))


if __name__ == '__main__':
    unittest.main()
