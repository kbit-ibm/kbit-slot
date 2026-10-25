"""Where QAOA circuits run: ideal simulators, IBM devices simulated with their noise, and IBM hardware.

Limits are explicit. An exact statevector needs 16 · 2^q bytes, so beyond ~27 qubits on a 15 GB machine only the
matrix-product-state (MPS) method fits. MPS is exact only when the bond dimension reaches 2^(q/2); below that it
truncates, and Aer does not report whether it did, so such runs are labelled approximate. Measured on this project's
dense QAOA circuits (p = 2, 1024 shots): statevector 24 qubits ≈ 8 s, 26 ≈ 34 s; MPS with bond 16 and 30 qubits ≈ 0.6 s.

Noisy simulation (fake_*) runs the circuit as a real device would: transpiled to its native gates and connectivity
(ISA), then sampled with its calibrated noise model. Every ISA run reports depth, two-qubit gates and the estimated
success probability (ESP), the product of (1 − error) over its operations, a quick fidelity proxy.
"""
from dataclasses import dataclass
from functools import cache
from math import floor, log2
from time import perf_counter

import psutil
from qiskit.primitives import StatevectorSampler
from qiskit.transpiler import generate_preset_pass_manager

try:
    from qiskit_aer import AerSimulator
except ImportError:  # Aer is optional: the reference sampler still works.
    AerSimulator = None

STATEVECTOR_BYTES = 16  # complex128 amplitude
MEMORY_SHARE = .6       # never plan to use more than this share of the free memory
DEFAULT_BOND = 16
TWO_QUBIT = {'cz', 'ecr', 'cx', 'rzz', 'swap'}
# Calibrated snapshots shipped with qiskit-ibm-runtime: Heron r1 (Torino), Heron r2 (Fez) and Eagle (Sherbrooke).
DEVICES = {}


@dataclass(frozen=True)
class Backend:
    id: str
    label: str
    description: str
    exact: bool
    max_qubits: int
    available: bool
    reason: str = ''
    kind: str = 'ideal'      # ideal, noisy or ibm

    def public(self):
        return {'id': self.id, 'label': self.label, 'description': self.description, 'exact': self.exact, 'kind': self.kind,
                'maxQubits': self.max_qubits, 'available': self.available, 'reason': self.reason}


def statevector_limit(memory=None):
    """Largest qubit count whose full statevector fits in the allowed share of free memory."""
    free = psutil.virtual_memory().available if memory is None else memory
    return max(1, floor(log2(free * MEMORY_SHARE / STATEVECTOR_BYTES)))


@cache
def devices():
    return AerSimulator().available_devices() if AerSimulator is not None else ()


@cache
def fake_device(backend_id):
    from qiskit_ibm_runtime import fake_provider
    return getattr(fake_provider, DEVICES[backend_id])()


@cache
def noisy_simulator(backend_id):
    return AerSimulator.from_backend(fake_device(backend_id))


@cache
def pass_manager(device_key, level, seed):
    from . import ibm
    device = fake_device(device_key) if device_key in DEVICES else ibm.device(device_key)
    return generate_preset_pass_manager(backend=device, optimization_level=level, seed_transpiler=seed)


def catalog():
    from . import ibm
    limit = statevector_limit()
    aer = AerSimulator is not None
    missing = '' if aer else 'Instala qiskit-aer para usar este simulador.'
    backends = [
        Backend('statevector', 'Qiskit Statevector', 'Referencia exacta de Qiskit en Python. Lenta desde ~20 qubits.', True, min(22, limit), True),
        Backend('aer_statevector', 'Aer · statevector', 'Simulación exacta en C++. El límite depende de la memoria libre.', True, min(32, limit), aer, missing),
        Backend('aer_mps', 'Aer · MPS', 'Producto de matrices: muchos más qubits en poco tiempo; aproximado salvo con enlace ≥ 2^(q/2).', False, 64, aer, missing),
    ]
    if 'GPU' in devices():
        backends.append(Backend('aer_gpu', 'Aer · GPU', 'Statevector exacto en la GPU.', True, min(34, limit + 2), True))
    for backend_id, name in DEVICES.items():
        label = name.replace('Fake', 'ibm_').lower()
        backends.append(Backend(backend_id, f'Ruido de {label} (simulado)', f'Transpilado a las puertas y conexiones de {label} y simulado con su ruido calibrado.',
                                False, min(20, limit - 2), aer, missing, 'noisy'))
    return backends + ibm.catalog()


def find(backend_id):
    backend = next((b for b in catalog() if b.id == backend_id), None)
    if backend is None:
        raise ValueError(f'El simulador {backend_id} no existe.')
    if not backend.available:
        raise ValueError(backend.reason or f'El simulador {backend.label} no está disponible.')
    return backend


def check_capacity(backend, qubits):
    if qubits > backend.max_qubits:
        hint = ' Usa Aer · MPS para más qubits.' if backend.kind == 'ideal' and backend.exact else ''
        raise ValueError(f'{backend.label} admite hasta {backend.max_qubits} qubits en esta máquina; el bloque pide {qubits}.{hint}')


def two_qubit_gates(circuit):
    return int(sum(count for name, count in circuit.count_ops().items() if name in TWO_QUBIT))


def estimated_success(isa, target):
    """ESP: product of (1 − error) over the operations of an ISA circuit, with the device's calibrated errors."""
    esp = 1.
    for instruction in isa.data:
        name = instruction.operation.name
        if name in ('barrier', 'delay') or name not in target:
            continue
        qargs = tuple(isa.find_bit(q).index for q in instruction.qubits)
        properties = target[name].get(qargs) if target[name] else None
        if properties is not None and properties.error:
            esp *= 1 - properties.error
    return esp


def isa_metrics(isa, target):
    active = {isa.find_bit(q).index for instruction in isa.data if instruction.operation.name != 'barrier' for q in instruction.qubits}
    return {'isaDepth': isa.depth(), 'isaTwoQubitGates': two_qubit_gates(isa), 'esp': estimated_success(isa, target), 'physicalQubits': len(active)}


class Runner:
    """Runs batches of measured circuits on one backend; open_runner() picks the implementation."""

    def __init__(self, backend, options):
        self.backend, self.options = backend, options
        self.usage = {'jobs': [], 'quantumSeconds': 0.}

    def close(self):
        pass

    def run(self, circuits, shots, seed, cancel=None, report=None):
        return [self.one(circuit, shots, seed + i) for i, circuit in enumerate(circuits)]


class IdealRunner(Runner):
    def one(self, circuit, shots, seed):
        started, bond = perf_counter(), int(self.options.get('bondDimension', DEFAULT_BOND))
        if self.backend.id == 'statevector':
            counts, compiled, exact = StatevectorSampler(seed=seed).run([circuit], shots=shots).result()[0].data.meas.get_counts(), circuit, True
        else:
            settings = {'method': 'matrix_product_state', 'matrix_product_state_max_bond_dimension': bond,
                        'matrix_product_state_truncation_threshold': 1e-10} if self.backend.id == 'aer_mps' else {'method': 'statevector'}
            if self.backend.id == 'aer_gpu':
                settings['device'] = 'GPU'
            from qiskit import transpile
            simulator = AerSimulator(**settings)
            compiled = transpile(circuit, simulator, optimization_level=1, seed_transpiler=seed)
            counts = simulator.run(compiled, shots=shots, seed_simulator=seed).result().get_counts()
            exact = self.backend.exact or bond >= 2 ** (circuit.num_qubits // 2)
        return counts, {'backend': self.backend.id, 'qubits': circuit.num_qubits, 'depth': compiled.depth(), 'twoQubitGates': two_qubit_gates(compiled),
                        'seconds': perf_counter() - started, 'exact': exact, 'noisy': False,
                        'bondDimension': bond if self.backend.id == 'aer_mps' else None}


class NoisyRunner(Runner):
    def one(self, circuit, shots, seed):
        started = perf_counter()
        device = fake_device(self.backend.id)
        isa = pass_manager(self.backend.id, int(self.options.get('optimizationLevel', 2)), int(self.options.get('seed', 7))).run(circuit)
        counts = noisy_simulator(self.backend.id).run(isa, shots=shots, seed_simulator=seed).result().get_counts()
        return counts, {'backend': self.backend.id, 'qubits': circuit.num_qubits, 'depth': circuit.depth(), 'twoQubitGates': two_qubit_gates(circuit),
                        'seconds': perf_counter() - started, 'exact': False, 'noisy': True, **isa_metrics(isa, device.target)}


def open_runner(backend_id, options):
    backend = find(backend_id)
    if backend.kind == 'ibm':
        from . import ibm
        return ibm.IbmRunner(backend, options)
    return (NoisyRunner if backend.kind == 'noisy' else IdealRunner)(backend, options)


def sample(backend_id, circuit, shots, seed, bond_dimension=DEFAULT_BOND):
    """One circuit on one backend: (counts, metadata)."""
    backend = find(backend_id)
    check_capacity(backend, circuit.num_qubits)
    runner = open_runner(backend_id, {'bondDimension': bond_dimension, 'seed': seed})
    try:
        return runner.run([circuit], shots, seed)[0]
    finally:
        runner.close()
