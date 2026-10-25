"""Quadratic models over bits, the LR-QAOA circuit that samples them, and helpers shared by every encoding."""
from dataclasses import dataclass

import numpy as np
from qiskit import QuantumCircuit


@dataclass
class Qubo:
    """E(z) = constant + linear · z + Σ_{j<l} quadratic[j, l] · z_j z_l, with z ∈ {0, 1}^k."""
    constant: float
    linear: np.ndarray
    quadratic: np.ndarray  # upper triangular, zero diagonal

    @property
    def qubits(self):
        return len(self.linear)

    def evaluate(self, bits):
        z = np.atleast_2d(np.asarray(bits, dtype=float))
        return self.constant + z @ self.linear + np.einsum('bi,ij,bj->b', z, self.quadratic, z)

    def ising(self):
        h = -self.linear / 2 - (self.quadratic.sum(axis=0) + self.quadratic.sum(axis=1)) / 4
        return h, self.quadratic / 4

    def plus(self, linear=None, quadratic=None, constant=0.):
        """A new model with extra terms; quadratic may be full, only its strict upper part is kept (symmetrised)."""
        extra = np.zeros_like(self.quadratic) if quadratic is None else np.triu(quadratic + quadratic.T - np.diag(np.diag(quadratic)), 1)
        return Qubo(self.constant + constant, self.linear + (0 if linear is None else linear), self.quadratic + extra)

    def with_inequality(self, change, slack, weights):
        """Add the unbalanced penalization of change · z ≤ slack: −λ1·h + λ2·h², h = slack − change · z.

        It needs no slack qubits (Montañez-Barrera et al., arXiv:2211.13914) and is still quadratic.
        Only the circuit sees it; decisions always use the real index.
        """
        c = np.asarray(change, dtype=float)
        if not np.isfinite(slack) or not weights or not c.any():
            return self
        l1, l2 = weights
        scale = max(float(np.std(self.linear)), float(np.max(np.abs(self.linear), initial=0)) / 4, 1.)
        linear = scale * ((l1 - 2 * l2 * slack) * c + l2 * c ** 2)
        return self.plus(linear=linear, quadratic=scale * 2 * l2 * np.triu(np.outer(c, c), 1))


def ramp_circuit(model, layers, delta_beta, delta_gamma):
    """LR-QAOA: fixed linear ramps for the mixer and cost angles, no variational loop.

    The mixer is exp(+iβX), i.e. Hamiltonian −X whose ground state is the initial |+⟩, so the ramp follows the
    LOW-energy states of the cost. With exp(−iβX) (rx(+2β), as in demo-almacen) the same ramp tracks the highest
    energies and the samples are worse than uniform.
    """
    h, J = model.ising()
    scale = max(float(np.max(np.abs(h), initial=0)), float(np.max(np.abs(J), initial=0)), 1.)
    qc = QuantumCircuit(model.qubits)
    qc.h(range(model.qubits))
    for layer in range(layers):
        beta, gamma = (1 - layer / layers) * delta_beta, (layer + 1) / layers * delta_gamma
        for j, value in enumerate(h):
            if abs(value) > 1e-12:
                qc.rz(2 * gamma * float(value) / scale, j)
        for j in range(model.qubits):
            for l in range(j + 1, model.qubits):
                if abs(J[j, l]) > 1e-12:
                    qc.rzz(2 * gamma * float(J[j, l]) / scale, j, l)
        qc.rx(-2 * beta, range(model.qubits))
    qc.measure_all()
    return qc


def bits_from_counts(counts, qubits):
    """Distinct bitstrings as rows (column j = qubit j; Qiskit prints qubit 0 rightmost) and their shot counts."""
    keys = list(counts)
    bits = np.array([[(int(key.replace(' ', ''), 2) >> j) & 1 for j in range(qubits)] for key in keys], dtype=int).reshape(len(keys), qubits)
    return bits, np.array([counts[key] for key in keys], dtype=int)


def uniform_counts(qubits, shots, rng):
    """Control sampler: the same number of shots drawn uniformly, to tell the circuit's signal from luck."""
    values = rng.integers(0, 2, size=(shots, qubits))
    keys, counts = np.unique(values, axis=0, return_counts=True)
    return {''.join(str(b) for b in row[::-1]): int(c) for row, c in zip(keys, counts)}
