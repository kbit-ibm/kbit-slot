"""IBM Quantum hardware through qiskit-ibm-runtime.

Credentials never leave the server: QISKIT_IBM_TOKEN (API key) with QISKIT_IBM_INSTANCE (CRN), or an account saved
with QiskitRuntimeService.save_account(). Without one of them nothing is contacted and no device is listed.
Hardware jobs also need KBIT_API_KEY on the server and the same key in each request (see server/app.py), because the
local service has no other authentication and a device consumes your QPU quota.

Execution: circuits are transpiled to the device's ISA, grouped in a Batch and sampled with the client-side Sampler
(qiskit_ibm_runtime.executor_sampler) with dynamical decoupling (XY4) and gate and measurement twirling. One round of
the hybrid search is one job holding `blocksPerRound` circuits. The QPU seconds each job reports are added up and the
search stops at `maxQuantumSeconds`. Cancelling the calculation cancels the IBM job.

Local mode (KBIT_IBM_LOCAL=1): ids such as ibm:fake_torino run this same path on the local simulator of that device,
without an account. The tests use it, with KBIT_IBM_ACCOUNT=0 so they never contact IBM.
With twirling the shots are split into randomizations and rounded up, so a job may return slightly more shots.
"""
import os
import time
from functools import cache

from .backends import DEVICES, Backend, Runner, fake_device, isa_metrics, pass_manager

CHANNEL = os.environ.get('KBIT_IBM_CHANNEL', 'ibm_quantum_platform')
HARDWARE_QUBITS = 12  # server/diagnose.py: from 12 swap qubits on, the noise of current devices erases the signal
FINAL = {'DONE', 'CANCELLED', 'ERROR', 'FAILED'}
_devices = {'at': 0., 'items': None, 'error': None}


def local_mode():
    return os.environ.get('KBIT_IBM_LOCAL') == '1'


def has_account():
    if os.environ.get('KBIT_IBM_ACCOUNT') == '0':  # tests and offline runs: never contact IBM
        return False
    if os.environ.get('QISKIT_IBM_TOKEN'):
        return True
    try:
        from qiskit_ibm_runtime import QiskitRuntimeService
        return bool(QiskitRuntimeService.saved_accounts())
    except Exception:
        return False


@cache
def service():
    from qiskit_ibm_runtime import QiskitRuntimeService
    token = os.environ.get('QISKIT_IBM_TOKEN')
    if token:
        return QiskitRuntimeService(channel=CHANNEL, token=token, instance=os.environ.get('QISKIT_IBM_INSTANCE') or None)
    return QiskitRuntimeService()


def hardware():
    """Operational devices of the account, cached for five minutes: [(name, qubits, pending jobs)]."""
    if time.time() - _devices['at'] > 300:
        try:
            found = service().backends(simulator=False, operational=True)
            _devices.update(items=[(b.name, b.num_qubits, getattr(b.status(), 'pending_jobs', None)) for b in found], error=None)
        except Exception as error:
            _devices.update(items=[], error=str(error))
        _devices['at'] = time.time()
    return _devices['items'], _devices['error']


def catalog():
    key = bool(os.environ.get('KBIT_API_KEY'))
    reason = '' if key else 'Define KBIT_API_KEY en el servidor para habilitar hardware.'
    entries = []
    if local_mode():
        entries += [Backend('ibm:' + name, f'IBM · {name.replace("fake_", "ibm_")} (modo local)', 'Mismo flujo que el hardware, ejecutado en el simulador local del equipo.',
                            False, HARDWARE_QUBITS, key, reason, 'ibm') for name in DEVICES]
    if has_account():
        items, error = hardware()
        if error:
            entries.append(Backend('ibm:error', 'IBM Quantum', 'No se pudo consultar la cuenta.', False, 0, False, error, 'ibm'))
        for name, qubits, pending in items:
            queue = f' · {pending} trabajos en cola' if pending is not None else ''
            entries.append(Backend('ibm:' + name, f'IBM · {name} (hardware)', f'{qubits} qubits{queue}. Consume tiempo de QPU de tu cuenta.',
                                   False, HARDWARE_QUBITS, key, reason, 'ibm'))
    return entries


def device(name):
    return fake_device(name) if name in DEVICES else service().backend(name)


def status_name(job):
    status = job.status()
    return str(getattr(status, 'name', status)).upper()


class IbmRunner(Runner):
    def __init__(self, backend, options):
        super().__init__(backend, options)
        from qiskit_ibm_runtime import Batch
        from qiskit_ibm_runtime.executor_sampler import Sampler
        self.name = backend.id.split(':', 1)[1]
        self.device = device(self.name)
        self.batch = None if self.name in DEVICES else Batch(backend=self.device)
        self.sampler = Sampler(mode=self.batch or self.device)
        self.sampler.options.dynamical_decoupling.enable = True
        self.sampler.options.dynamical_decoupling.sequence_type = 'XY4'
        self.sampler.options.twirling.enable_gates = True
        self.sampler.options.twirling.enable_measure = True

    def close(self):
        if self.batch is not None:
            self.batch.close()

    def run(self, circuits, shots, seed, cancel=None, report=None):
        started = time.perf_counter()
        manager = pass_manager(self.name, int(self.options.get('optimizationLevel', 2)), int(self.options.get('seed', 7)))
        isas = [manager.run(circuit) for circuit in circuits]
        job = self.sampler.run(isas, shots=shots)
        job_id = job.job_id()
        self.usage['jobs'].append(job_id)
        status = status_name(job)
        while status not in FINAL:
            if cancel is not None and cancel.is_set():
                job.cancel()
                raise RuntimeError('Cálculo cancelado; se canceló el trabajo ' + job_id + ' en IBM.')
            if report:
                report({'phase': 'ibm', 'jobId': job_id, 'jobStatus': status})
            time.sleep(1 if self.name in DEVICES else 3)
            status = status_name(job)
        if status != 'DONE':
            raise RuntimeError(f'El trabajo {job_id} terminó como {status}.')
        result = job.result()
        try:
            seconds = float(job.usage() or 0)
        except Exception:  # local mode has no QPU usage
            seconds = 0.
        self.usage['quantumSeconds'] += seconds
        elapsed = time.perf_counter() - started
        return [(result[i].data.meas.get_counts(),
                 {'backend': self.backend.id, 'qubits': circuit.num_qubits, 'depth': circuit.depth(), 'exact': False, 'noisy': True,
                  'twoQubitGates': sum(c for n, c in circuit.count_ops().items() if n == 'rzz'), 'seconds': elapsed / len(circuits),
                  'jobId': job_id, **isa_metrics(isa, self.device.target)})
                for i, (circuit, isa) in enumerate(zip(circuits, isas))]
