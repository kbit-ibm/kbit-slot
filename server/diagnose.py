"""Hardware diagnosis: how large a QAOA block can be before a device's noise erases the circuit's signal.

    python -m server.diagnose --device fake_torino --output results/diagnostico-fake_torino.json

For each encoding, block size and number of layers it builds blocks from the demo, transpiles them to the device
(ISA: depth, two-qubit gates, estimated success probability) and measures the HIT RATE: the share of shots whose
decoded plan is the block optimum, sampled three ways: ideal simulator, the device's noise model and uniform luck.
A configuration is useful on hardware only while the noisy hit rate stays clearly above the uniform one.
"""
import argparse
import importlib.metadata
import json
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

import numpy as np

from . import engine
from .quantum import backends, hybrid
from .quantum.qubo import bits_from_counts, ramp_circuit, uniform_counts
from .quantum.swap_qaoa import Problem, SwapBlock
from .quantum.window_qaoa import WindowBlock

USEFUL = 2.  # noisy hit rate must be at least this many times the uniform one


def hit_rate(block, counts, optimum, scale):
    """Share of shots that, decoded one by one (with repair), give the block optimum."""
    bits, shots = bits_from_counts(counts, block.qubits)
    hits = 0
    for row, count in zip(bits, shots):
        key = ''.join(str(b) for b in row[::-1])
        if block.decide({key: 1})[1] <= optimum + 1e-6 * scale:
            hits += count
    return hits / max(1, shots.sum())


def diagnose(device, configurations, blocks, shots, seed, report=print):
    data = engine.demo()
    rules = {'maxMoves': 12, 'pinned': [10], 'cleaningZone': True}
    problem = Problem.from_json(engine.problem({}, data['assignment'], data['orders'], rules))
    start, scale = np.asarray(data['assignment']), problem.cost(data['assignment'])
    ideal = backends.open_runner('aer_statevector', {})
    noisy = backends.open_runner(device, {'optimizationLevel': 2, 'seed': seed})
    rows = []
    for encoding, size, layers in configurations:
        options = {**hybrid.DEFAULTS, 'qubits': size, 'window': size, 'layers': layers}
        Block = SwapBlock if encoding == 'swaps' else WindowBlock
        rng, measured = np.random.default_rng(seed), []
        for index in range(blocks):
            block = Block(problem, start, options, rng)
            # A block that cannot improve says nothing about the circuit: the current plan is already its optimum.
            optimum = block.exact()[1]
            if optimum >= problem.cost(start) - 1e-9:
                continue
            circuit = ramp_circuit(block.steered(options['penalty']), layers, options['deltaBeta'], options['deltaGamma'])
            started = perf_counter()
            (ideal_counts, _), = ideal.run([circuit], shots, seed + index)
            (noisy_counts, meta), = noisy.run([circuit], shots, seed + index)
            uniform = uniform_counts(block.qubits, shots, np.random.default_rng(seed + index))
            measured.append({'qubits': block.qubits, 'logicalTwoQubitGates': meta['twoQubitGates'], 'isaDepth': meta['isaDepth'],
                             'isaTwoQubitGates': meta['isaTwoQubitGates'], 'esp': meta['esp'], 'physicalQubits': meta['physicalQubits'],
                             'hitIdeal': hit_rate(block, ideal_counts, optimum, scale), 'hitNoisy': hit_rate(block, noisy_counts, optimum, scale),
                             'hitUniform': hit_rate(block, uniform, optimum, scale), 'seconds': perf_counter() - started})
        if not measured:
            continue
        mean = {key: float(np.mean([m[key] for m in measured])) for key in measured[0]}
        verdict = 'útil' if mean['hitNoisy'] >= USEFUL * mean['hitUniform'] and mean['hitNoisy'] > 0 else 'el ruido borra la señal'
        row = {'encoding': encoding, 'size': size, 'layers': layers, 'blocks': len(measured), **mean, 'verdict': verdict, 'samples': measured}
        rows.append(row)
        report(f"{encoding:6s} tamaño {size:2d} p={layers}  qubits {mean['qubits']:4.1f}  2q en chip {mean['isaTwoQubitGates']:6.0f}  ESP {mean['esp']:.3f}  "
               f"aciertos ideal {mean['hitIdeal']:.3f} · ruido {mean['hitNoisy']:.3f} · azar {mean['hitUniform']:.3f}  → {verdict}")
    return rows


def main():
    parser = argparse.ArgumentParser(description='Diagnóstico de QAOA en un equipo de IBM simulado con su ruido.')
    parser.add_argument('--device', default='fake_torino', choices=sorted(backends.DEVICES))
    parser.add_argument('--swaps', type=int, nargs='*', default=[6, 8, 10, 12], help='qubits por bloque de intercambios')
    parser.add_argument('--windows', type=int, nargs='*', default=[2, 3], help='productos por ventana')
    parser.add_argument('--layers', type=int, nargs='*', default=[1, 2, 4])
    parser.add_argument('--blocks', type=int, default=3)
    parser.add_argument('--shots', type=int, default=1024)
    parser.add_argument('--seed', type=int, default=11)
    parser.add_argument('--output', default=None)
    args = parser.parse_args()
    configurations = [('swaps', k, p) for k in args.swaps for p in args.layers] + [('window', w, p) for w in args.windows for p in args.layers]
    started = perf_counter()
    rows = diagnose(args.device, configurations, args.blocks, args.shots, args.seed)
    useful = [r for r in rows if r['verdict'] == 'útil']
    best = max(useful, key=lambda r: (r['qubits'], -r['layers']), default=None)
    result = {'device': args.device, 'createdAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
              'versions': {p: importlib.metadata.version(p) for p in ('qiskit', 'qiskit-aer', 'qiskit-ibm-runtime', 'numpy')},
              'options': vars(args), 'criterion': f'útil si los aciertos con ruido son ≥ {USEFUL}× los del azar',
              'largestUseful': None if best is None else {k: best[k] for k in ('encoding', 'size', 'layers', 'qubits', 'isaTwoQubitGates', 'esp')},
              'seconds': perf_counter() - started, 'rows': rows}
    print('Mayor configuración útil:', result['largestUseful'])
    if args.output:
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=1) + '\n')


if __name__ == '__main__':
    main()
