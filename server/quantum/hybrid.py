"""Hybrid large-neighbourhood search: blocks of the plan are re-optimised by sampling a QAOA circuit.

Each round builds `blocksPerRound` blocks from the current plan (swaps or windows), samples them together (one job on
hardware), decodes every sample into a valid plan with the real index, and keeps the best block result if it improves.

`sampling` selects what produces the samples, so the circuit's contribution can be measured:
    qaoa     the LR-QAOA circuit on the chosen backend;
    uniform  the same number of shots drawn uniformly at random (does the circuit beat luck?);
    exact    the block solved by classical enumeration (the best any sampler could do with the same blocks).
"""
from time import perf_counter

import numpy as np

from . import backends
from .qubo import ramp_circuit, uniform_counts
from .swap_qaoa import SwapBlock
from .window_qaoa import WindowBlock

ENCODINGS = {'swaps': SwapBlock, 'window': WindowBlock, 'mixed': None}  # mixed alternates swap and window blocks
SAMPLINGS = ('qaoa', 'uniform', 'exact')
DEFAULTS = {'encoding': 'swaps', 'sampling': 'qaoa', 'qubits': 12, 'window': 4, 'freeSlots': 1, 'layers': 4, 'shots': 1024,
            'blocks': 24, 'blocksPerRound': 1, 'seconds': 60.0, 'backend': 'aer_statevector', 'seed': 7, 'deltaBeta': .75,
            'deltaGamma': 1.5, 'temperature': .5, 'bondDimension': backends.DEFAULT_BOND, 'referenceQubits': 18,
            'shadowPrice': True, 'penalty': (.5, .1), 'oneHotPenalty': 1.0, 'optimizationLevel': 2, 'maxQuantumSeconds': 60.0}
EPS = 1e-9


class Cancelled(RuntimeError):
    pass


def settings(options):
    o = {**DEFAULTS, **(options or {})}
    if o['encoding'] not in ENCODINGS or o['sampling'] not in SAMPLINGS:
        raise ValueError('Codificación (swaps, window, mixed) o muestreo (qaoa, uniform, exact) desconocidos.')
    if not (1 <= int(o['qubits']) <= 64 and 2 <= int(o['window']) <= 6 and 0 <= int(o['freeSlots']) <= 3 and 1 <= int(o['layers']) <= 6
            and 16 <= int(o['shots']) <= 65536 and 1 <= int(o['blocks']) <= 500 and 1 <= int(o['blocksPerRound']) <= 16 and o['seconds'] > 0):
        raise ValueError('Opciones QAOA fuera de rango: qubits 1–64, ventana 2–6, libres 0–3, capas 1–6, shots 16–65536, bloques 1–500, por ronda 1–16.')
    return o


def solve(problem, start, options=None, report=None, cancel=None):
    o = settings(options)
    sampling = o['sampling']
    kind = lambda index: ENCODINGS[o['encoding']] or (SwapBlock, WindowBlock)[index % 2]
    current = np.asarray(start, dtype=int)
    problem.check(current)
    started, rng = perf_counter(), np.random.default_rng(int(o['seed']))
    start_cost = current_cost = problem.cost(current)
    runner = backends.open_runner(o['backend'], o) if sampling == 'qaoa' else None
    log, rounds, sample_seconds = [], 0, 0.
    try:
        while len(log) < int(o['blocks']):
            if cancel is not None and cancel.is_set():
                raise Cancelled('Cálculo cancelado.')
            if perf_counter() - started > o['seconds'] or (runner and runner.usage['quantumSeconds'] >= o['maxQuantumSeconds']):
                break
            count = min(int(o['blocksPerRound']), int(o['blocks']) - len(log))
            blocks = [b for b in (kind(len(log) + i)(problem, current, o, rng) for i in range(count)) if b.qubits]
            if not blocks:
                break
            if sampling == 'qaoa':
                for block in blocks:
                    backends.check_capacity(runner.backend, block.qubits)
                circuits = [ramp_circuit(b.steered(o['penalty']), int(o['layers']), o['deltaBeta'], o['deltaGamma']) for b in blocks]
                runs = runner.run(circuits, int(o['shots']), int(o['seed']) + 97 * rounds, cancel=cancel, report=report)
            else:
                # Own generator for the uniform control, so block selection consumes the same random stream as with QAOA.
                runs = [(uniform_counts(b.qubits, int(o['shots']), np.random.default_rng(int(o['seed']) + 7919 * rounds + i)) if sampling == 'uniform' else None,
                         {'seconds': 0.}) for i, b in enumerate(blocks)]
            before, outcomes = current_cost, []
            for block, (counts, meta) in zip(blocks, runs):
                candidate, value, stats = block.exact() if sampling == 'exact' else block.decide(counts)
                problem.check(candidate)
                cost = problem.cost(candidate)
                if abs(cost - value) > 1e-6 * max(1., start_cost):
                    raise RuntimeError('El modelo del bloque no coincide con el índice real.')
                reference = None
                if sampling != 'exact' and (block.encoding == 'window' or block.qubits <= o['referenceQubits']):
                    reference = block.exact()[1]
                sample_seconds += meta.get('seconds', 0.)
                outcomes.append((cost, candidate))
                log.append({'block': len(log) + 1, 'round': rounds + 1, 'encoding': block.encoding, 'qubits': block.qubits, **block.describe(),
                            'before': before, 'sampleBest': cost, 'blockOptimum': reference,
                            'foundOptimum': None if reference is None else cost <= reference + 1e-6 * max(1., start_cost), **stats,
                            **{key: meta[key] for key in ('depth', 'twoQubitGates', 'isaDepth', 'isaTwoQubitGates', 'esp', 'physicalQubits', 'exact', 'noisy', 'seconds', 'jobId') if key in meta}})
            cost, candidate = min(outcomes, key=lambda entry: entry[0])
            accepted = cost < current_cost - EPS
            if accepted:
                current, current_cost = candidate, cost
            for entry in log[-len(blocks):]:
                entry.update({'after': current_cost, 'accepted': accepted and entry['sampleBest'] == cost})
            rounds += 1
            if report:
                report({'phase': 'qaoa' if sampling == 'qaoa' else 'control', 'best': current_cost, 'block': len(log), 'blocks': int(o['blocks']),
                        'progress': .1 + .85 * min(1., max(len(log) / int(o['blocks']), (perf_counter() - started) / o['seconds']))})
    finally:
        if runner:
            runner.close()
    return current.tolist(), summarize(o, runner, log, start_cost, current_cost, sample_seconds, started)


def summarize(o, runner, log, start_cost, final_cost, sample_seconds, started):
    def stat(key, reducer):
        values = [e[key] for e in log if e.get(key) is not None]
        return reducer(values) if values else None
    referenced = [e for e in log if e['foundOptimum'] is not None]
    backend = backends.find(o['backend']) if o['sampling'] == 'qaoa' else None
    names = {'swaps': 'intercambios', 'window': 'ventanas', 'mixed': 'intercambios y ventanas'}
    label = ('Híbrido QAOA · ' + names[o['encoding']] + ' · ' + backend.label) if backend else \
        ('Control ' + ('aleatorio' if o['sampling'] == 'uniform' else 'exacto') + ' · ' + names[o['encoding']])
    return {
        'id': ('qaoa' if backend else 'control-' + ('aleatorio' if o['sampling'] == 'uniform' else 'exacto')) + '-' + names[o['encoding']], 'label': label, 'encoding': o['encoding'], 'sampling': o['sampling'],
        'backend': backend.id if backend else None, 'qubits': stat('qubits', max) or 0, 'layers': int(o['layers']), 'shots': int(o['shots']),
        'seed': int(o['seed']), 'blocks': len(log), 'rounds': max((e['round'] for e in log), default=0), 'acceptedBlocks': sum(bool(e.get('accepted')) for e in log),
        'startCost': start_cost, 'qiskitGain': start_cost - final_cost,
        'feasibleShots': stat('feasibleShots', lambda v: float(np.mean(v))), 'repairedBlocks': sum(bool(e.get('repaired')) for e in log),
        'optimumHitRate': sum(e['foundOptimum'] for e in referenced) / len(referenced) if referenced else None,
        'maxDepth': stat('depth', max) or 0, 'maxTwoQubitGates': stat('twoQubitGates', max) or 0,
        'maxIsaTwoQubitGates': stat('isaTwoQubitGates', max), 'minEsp': stat('esp', min),
        'exact': all(e.get('exact', True) for e in log), 'noisy': any(e.get('noisy') for e in log),
        'bondDimension': int(o['bondDimension']) if backend and backend.id == 'aer_mps' else None,
        'quantumSeconds': runner.usage['quantumSeconds'] if runner else 0., 'jobs': list(runner.usage['jobs']) if runner else [],
        'sampleSeconds': sample_seconds, 'milliseconds': round((perf_counter() - started) * 1000), 'log': log,
    }
