"""Simulated quantum backends for the QAOA solver.

Each backend samples a measured circuit and reports what it cost. Limits are explicit:
an exact statevector needs 16 · 2^q bytes, so beyond ~27 qubits on a 15 GB machine only the
matrix-product-state (MPS) method fits. MPS is exact only when the bond dimension reaches 2^(q/2);
below that it truncates, and Aer does not report whether it did, so such runs are labelled approximate.
Measured on this project's dense QAOA circuits (p = 2, 1024 shots): statevector 24 qubits ≈ 8 s, 26 ≈ 34 s;
MPS with bond 16 and 30 qubits ≈ 0.6 s.
"""
from dataclasses import dataclass
from functools import cache
from math import floor, log2
from time import perf_counter

import psutil
from qiskit import QuantumCircuit, transpile
from qiskit.primitives import StatevectorSampler

try:
    from qiskit_aer import AerSimulator
except ImportError:  # Aer is optional: the reference sampler still works.
    AerSimulator = None

STATEVECTOR_BYTES = 16  # complex128 amplitude
MEMORY_SHARE = .6       # never plan to use more than this share of the free memory
DEFAULT_BOND = 16


@dataclass(frozen=True)
class Backend:
    id: str
    label: str
    description: str
    exact: bool
    max_qubits: int
    available: bool
    reason: str = ''

    def public(self):
        return {'id': self.id, 'label': self.label, 'description': self.description, 'exact': self.exact,
                'maxQubits': self.max_qubits, 'available': self.available, 'reason': self.reason}


def statevector_limit(memory=None):
    """Largest qubit count whose full statevector fits in the allowed share of free memory."""
    free = psutil.virtual_memory().available if memory is None else memory
    return max(1, floor(log2(free * MEMORY_SHARE / STATEVECTOR_BYTES)))


@cache
def devices():
    return AerSimulator().available_devices() if AerSimulator is not None else ()


def catalog():
    limit = statevector_limit()
    aer = AerSimulator is not None
    devices_found = devices()
    missing = '' if aer else 'Instala qiskit-aer para usar este simulador.'
    backends = [
        Backend('statevector', 'Qiskit Statevector', 'Referencia exacta de Qiskit en Python. Lenta desde ~20 qubits.', True, min(22, limit), True),
        Backend('aer_statevector', 'Aer · statevector', 'Simulación exacta en C++. El límite depende de la memoria libre.', True, min(32, limit), aer, missing),
        Backend('aer_mps', 'Aer · MPS', 'Producto de matrices: muchos más qubits en poco tiempo; aproximado salvo con enlace ≥ 2^(q/2).', False, 64, aer, missing),
    ]
    if 'GPU' in devices_found:
        backends.append(Backend('aer_gpu', 'Aer · GPU', 'Statevector exacto en la GPU.', True, min(34, limit + 2), True))
    return backends


def find(backend_id):
    backend = next((b for b in catalog() if b.id == backend_id), None)
    if backend is None:
        raise ValueError(f'El simulador {backend_id} no existe.')
    if not backend.available:
        raise ValueError(backend.reason or f'El simulador {backend.label} no está disponible.')
    return backend


def check_capacity(backend, qubits):
    if qubits > backend.max_qubits:
        hint = ' Usa Aer · MPS para más qubits.' if backend.exact else ''
        raise ValueError(f'{backend.label} admite hasta {backend.max_qubits} qubits en esta máquina; el bloque pide {qubits}.{hint}')


def sample(backend_id, circuit: QuantumCircuit, shots, seed, bond_dimension=DEFAULT_BOND):
    """Run a measured circuit and return (counts, metadata)."""
    backend = find(backend_id)
    check_capacity(backend, circuit.num_qubits)
    started = perf_counter()
    if backend_id == 'statevector':
        counts = StatevectorSampler(seed=seed).run([circuit], shots=shots).result()[0].data.meas.get_counts()
        compiled, exact = circuit, True
    else:
        options = {'method': 'matrix_product_state', 'matrix_product_state_max_bond_dimension': int(bond_dimension),
                   'matrix_product_state_truncation_threshold': 1e-10} if backend_id == 'aer_mps' else {'method': 'statevector'}
        if backend_id == 'aer_gpu':
            options['device'] = 'GPU'
        simulator = AerSimulator(**options)
        compiled = transpile(circuit, simulator, optimization_level=1, seed_transpiler=seed)
        result = simulator.run(compiled, shots=shots, seed_simulator=seed).result()
        counts = result.get_counts()
        exact = backend.exact or int(bond_dimension) >= 2 ** (circuit.num_qubits // 2)
    ops = compiled.count_ops()
    two_qubit = sum(count for name, count in ops.items() if name in ('rzz', 'cx', 'cz', 'ecr', 'swap'))
    return counts, {'backend': backend_id, 'qubits': circuit.num_qubits, 'depth': compiled.depth(), 'twoQubitGates': int(two_qubit),
                    'seconds': perf_counter() - started, 'exact': exact, 'bondDimension': int(bond_dimension) if backend_id == 'aer_mps' else None,
                    'memoryBytes': STATEVECTOR_BYTES * 2 ** circuit.num_qubits if backend.exact else None}
