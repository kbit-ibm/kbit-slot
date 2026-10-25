"""Reproducible benchmark: classical methods, hybrid QAOA and its controls on the same scenarios and seeds.

    python -m server.benchmark --output results/benchmark.json            # ~5 minutes
    python -m server.benchmark --quick                                    # one seed, two scenarios
    python -m server.benchmark --noisy fake_torino                        # adds the hardware-sized config with noise

Every run starts from the same layout, is validated by the browser engine (planFrom) and is kept in the output,
favourable or not, with versions, commit, options and timings. The QAOA rows are paired with two controls that use the
same blocks procedure: uniform samples (does the circuit beat luck?) and exact enumeration (the best any sampler
could reach with those blocks). A QAOA gain that the controls also get is not attributable to the circuit.
"""
import argparse
import importlib.metadata
import json
import os
import platform
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

import numpy as np

from . import engine
from .quantum import hybrid
from .quantum.swap_qaoa import Problem

ROOT = Path(__file__).resolve().parent.parent
RULES = {'pinned': [10], 'cleaningZone': True}
QAOA = {'backend': 'aer_statevector', 'blocks': 24}
METHODS = {
    'voraz': ('clasico', {'iterations': 0}),
    'recocido': ('clasico', {}),
    'qaoa-intercambios': ('hybrid', {**QAOA, 'encoding': 'swaps', 'qubits': 12}),
    'azar-intercambios': ('hybrid', {**QAOA, 'encoding': 'swaps', 'qubits': 12, 'sampling': 'uniform'}),
    'exacto-intercambios': ('hybrid', {**QAOA, 'encoding': 'swaps', 'qubits': 12, 'sampling': 'exact'}),
    'qaoa-ventanas': ('hybrid', {**QAOA, 'encoding': 'window', 'window': 3}),
    'azar-ventanas': ('hybrid', {**QAOA, 'encoding': 'window', 'window': 3, 'sampling': 'uniform'}),
    'exacto-ventanas': ('hybrid', {**QAOA, 'encoding': 'window', 'window': 3, 'sampling': 'exact'}),
}
PAIRS = [('qaoa-intercambios', 'azar-intercambios'), ('qaoa-intercambios', 'exacto-intercambios'),
         ('qaoa-ventanas', 'azar-ventanas'), ('qaoa-ventanas', 'exacto-ventanas'), ('qaoa-intercambios', 'recocido')]


def synthetic_orders(seed, products=30, families=6):
    """Another order history for the demo catalogue (family = id // 5), so results are not tuned to one data set."""
    rng, orders = np.random.default_rng(seed), []
    for i in range(int(rng.integers(150, 450))):
        family = int(rng.integers(families))
        pool = rng.permutation([p for p in range(products) if p // 5 == family]).tolist()
        items = pool[:int(rng.integers(1, 5))]
        if rng.random() < .5:
            others = [p for p in range(products) if p // 5 != family]
            items.append(int(rng.choice(others)))
        orders.append({'id': f'S{seed}-{i + 1}', 'items': sorted(set(items))})
    return orders


def scenarios(quick):
    base, two = engine.demo(), engine.demo({'layout': {'levels': 2}})
    found = [('demo-8', {}, base['assignment'], base['orders'], 8), ('demo-12', {}, base['assignment'], base['orders'], 12),
             ('demo-sin-limite', {}, base['assignment'], base['orders'], None),
             ('pedidos-b-12', {}, base['assignment'], synthetic_orders(23), 12),
             ('dos-niveles-12', two['spec'], two['assignment'], two['orders'], 12)]
    return found[1:2] + found[4:] if quick else found


def run(method, spec, initial, orders, rules, seed):
    kind, options = METHODS[method]
    started = perf_counter()
    if kind == 'clasico':
        plan = engine.solve(spec, initial, orders, rules, {**options, 'seed': seed})
    else:
        problem = Problem.from_json(engine.problem(spec, initial, orders, rules))
        target, summary = hybrid.solve(problem, initial, {**options, 'seed': seed})
        plan = engine.plan_from(spec, initial, orders, rules, target, summary)
    solver = plan['solver']
    return {'method': method, 'seed': seed, 'cost': plan['after'], 'before': plan['before'], 'improvement': plan['improvement'],
            'moved': plan['moved'], 'tasks': len(plan['tasks']), 'seconds': perf_counter() - started,
            **{key: solver.get(key) for key in ('qubits', 'blocks', 'acceptedBlocks', 'feasibleShots', 'optimumHitRate', 'minEsp', 'maxIsaTwoQubitGates') if key in solver}}


def summarize(runs):
    by = {}
    for r in runs:
        by.setdefault((r['scenario'], r['method']), []).append(r)
    table = [{'scenario': s, 'method': m, 'runs': len(rs), 'meanCost': float(np.mean([r['cost'] for r in rs])),
              'stdCost': float(np.std([r['cost'] for r in rs])), 'bestCost': float(min(r['cost'] for r in rs)),
              'meanImprovement': float(np.mean([r['improvement'] for r in rs])), 'meanSeconds': float(np.mean([r['seconds'] for r in rs]))}
             for (s, m), rs in by.items()]
    paired = []
    for a, b in PAIRS:
        wins = ties = losses = 0
        for (s, m), rs in by.items():
            if m != a or (s, b) not in by:
                continue
            other = {r['seed']: r['cost'] for r in by[(s, b)]}
            for r in rs:
                if r['seed'] in other:
                    delta = r['cost'] - other[r['seed']]
                    wins, ties, losses = wins + (delta < -1e-9), ties + (abs(delta) <= 1e-9), losses + (delta > 1e-9)
        paired.append({'method': a, 'against': b, 'wins': int(wins), 'ties': int(ties), 'losses': int(losses)})
    return table, paired


def markdown(result):
    lines = ['# Benchmark de Kbit Slot', '', f"{result['createdAt']} · commit `{result['commit']}`{' (con cambios sin commitear)' if result['uncommittedChanges'] else ''} · semillas {result['options']['seeds']} · "
             f"Qiskit {result['versions']['qiskit']} · Aer {result['versions']['qiskit-aer']}", '',
             'Índice final medio (menor es mejor) ± desviación, y segundos por corrida. Todas las corridas parten de la distribución actual.', '']
    methods = list(dict.fromkeys(row['method'] for row in result['summary']))
    names = list(dict.fromkeys(row['scenario'] for row in result['summary']))
    cells = {(row['scenario'], row['method']): row for row in result['summary']}
    lines += ['| Método | ' + ' | '.join(names) + ' |', '|---|' + '---|' * len(names)]
    for m in methods:
        values = [cells.get((s, m)) for s in names]
        lines.append(f'| {m} | ' + ' | '.join(f"{c['meanCost']:.0f} ± {c['stdCost']:.0f} · {c['meanSeconds']:.1f} s" if c else '—' for c in values) + ' |')
    lines += ['', '| Comparación (misma semilla) | Gana | Empata | Pierde |', '|---|---|---|---|']
    lines += [f"| {p['method']} frente a {p['against']} | {p['wins']} | {p['ties']} | {p['losses']} |" for p in result['paired']]
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description='Benchmark reproducible del motor clásico, el híbrido QAOA y sus controles.')
    parser.add_argument('--seeds', type=int, nargs='*', default=[1, 2, 3])
    parser.add_argument('--methods', nargs='*', default=list(METHODS), choices=list(METHODS) + ['qaoa-ruido'])
    parser.add_argument('--noisy', default=None, help='equipo simulado con ruido (p. ej. fake_torino) para la configuración de hardware')
    parser.add_argument('--quick', action='store_true')
    parser.add_argument('--output', default=str(ROOT / 'results' / 'benchmark.json'))
    args = parser.parse_args()
    if args.quick:
        args.seeds = args.seeds[:1]
    methods = list(args.methods)
    if args.noisy:
        # Hardware-sized configuration from server/diagnose.py: 8 swaps, p = 2.
        METHODS['qaoa-ruido'] = ('hybrid', {'backend': args.noisy, 'encoding': 'swaps', 'qubits': 8, 'layers': 2, 'blocks': 12})
        methods.append('qaoa-ruido')
    started, runs = perf_counter(), []
    for name, spec, initial, orders, limit in scenarios(args.quick):
        rules = {**RULES, **({'maxMoves': limit} if limit is not None else {})}
        for seed in args.seeds:
            for method in methods:
                record = {'scenario': name, **run(method, spec, initial, orders, rules, seed)}
                runs.append(record)
                print(f"{name:16s} semilla {seed}  {method:20s} índice {record['cost']:7.0f}  ({record['improvement']:5.1f} %)  {record['seconds']:6.1f} s", flush=True)
    summary, paired = summarize(runs)
    commit = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT, capture_output=True, text=True).stdout.strip() or None
    # Uncommitted code changes (results and documentation aside) mean the code that ran is not exactly that commit.
    changes = subprocess.run(['git', 'status', '--porcelain', '--', '.', ':!results', ':!docs', ':!*.md'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    result = {'createdAt': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'commit': commit, 'uncommittedChanges': bool(changes),
              'host': {'python': platform.python_version(), 'cpus': os.cpu_count(), 'system': platform.system()},
              'versions': {p: importlib.metadata.version(p) for p in ('qiskit', 'qiskit-aer', 'qiskit-ibm-runtime', 'numpy')},
              'options': {**vars(args), 'methods': {m: METHODS[m] for m in methods}, 'rules': RULES},
              'policy': 'Se guardan todas las corridas; ninguna semilla se descarta. Cada plan se valida con planFrom del motor del navegador.',
              'seconds': perf_counter() - started, 'summary': summary, 'paired': paired, 'runs': runs}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=1) + '\n')
    output.with_suffix('.md').write_text(markdown(result))
    print(markdown(result))


if __name__ == '__main__':
    main()
