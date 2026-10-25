"""Hybrid QAOA for Kbit Slot: a classical start, then blocks of simultaneous swaps sampled with QAOA.

Encoding (adapted from ../demo/demo-almacen/swap_qaoa.py): one qubit per disjoint pair of items, where an item is a
movable product or an empty assignable slot (a "dummy" with zero flow). Bit 1 swaps the pair, so moving a product to a
free slot is a swap with a dummy. Pairs are disjoint and the index adds pairwise terms, so the index after any
bitstring is an exact quadratic polynomial in the bits, recovered from 1 + k + k(k−1)/2 evaluations, never 2^k.

Kbit rules: pinned products never enter a pair; a pair exists only if each product may stand in the other's slot
(zones and reserved slots). The relocation budget is linear in the bits (Σ c_j z_j ≤ slack) and is handled three ways:
pairs are chosen with a shadow price per extra relocation, so a block mixes new moves with reverts; the circuit adds the
"unbalanced penalization" of the inequality, −λ1·h + λ2·h² with h = slack − Σ c_j z_j, which needs no slack qubits
(Montañez-Barrera et al., arXiv:2211.13914); and samples still above the budget are repaired classically by switching
off the swaps that cost least to undo. Each proposal is decoded, validated and its index recomputed before it can
replace the current plan. The fixed linear-ramp schedule (LR-QAOA) needs no angle training.
"""
from dataclasses import dataclass, field
from time import perf_counter

import numpy as np
from qiskit import QuantumCircuit

from . import backends

DEFAULTS = {'qubits': 12, 'layers': 4, 'shots': 1024, 'blocks': 24, 'seconds': 60.0, 'backend': 'aer_statevector', 'seed': 7,
            'deltaBeta': .75, 'deltaGamma': 1.5, 'temperature': .5, 'bondDimension': backends.DEFAULT_BOND, 'referenceQubits': 18,
            'shadowPrice': True, 'penalty': (.5, .1)}
EPS = 1e-9


class Cancelled(RuntimeError):
    pass


@dataclass
class Problem:
    """The engine's describe() output as arrays: distances, flows, allowed slots per product and the rules."""
    D: np.ndarray
    F: np.ndarray
    allowed: np.ndarray
    pinned: frozenset
    max_moves: float
    initial: np.ndarray
    assignable: np.ndarray
    slot_names: list = field(default_factory=list)

    @classmethod
    def from_json(cls, data):
        D = np.asarray(data['distances'], dtype=float)
        F = np.asarray(data['flow'], dtype=float)
        n, m = len(F), len(D)
        if D.shape != (m, m) or F.shape != (n, n) or not np.allclose(D, D.T) or not np.allclose(F, F.T):
            raise ValueError('El problema necesita distancias y flujos cuadrados y simétricos.')
        allowed = np.zeros((n, m), dtype=bool)
        for product, slots in enumerate(data['allowed']):
            allowed[product, slots] = True
        max_moves = float('inf') if data.get('maxMoves') is None else int(data['maxMoves'])
        return cls(D, F, allowed, frozenset(data.get('pinned', [])), max_moves, np.asarray(data['initial'], dtype=int),
                   np.asarray(data['assignable'], dtype=int), list(data.get('slotNames', [])))

    @property
    def n(self):
        return len(self.F)

    def costs(self, assignments):
        a = np.atleast_2d(np.asarray(assignments, dtype=int))
        i, j = np.triu_indices(self.n, 1)
        return (self.F[i, j] * self.D[a[:, i], a[:, j]]).sum(axis=1)

    def cost(self, assignment):
        return float(self.costs(assignment)[0])

    def moved(self, assignment):
        return int(np.count_nonzero(np.asarray(assignment) != self.initial))

    def check(self, assignment):
        p = np.asarray(assignment, dtype=int)
        if p.shape != (self.n,) or len(set(p.tolist())) != self.n:
            raise ValueError('La propuesta repite posiciones o no tiene un producto por fila.')
        if not self.allowed[np.arange(self.n), p].all():
            raise ValueError('La propuesta pone un producto fuera de su zona o en una reserva.')
        if any(p[i] != self.initial[i] for i in self.pinned):
            raise ValueError('La propuesta mueve un producto fijo.')
        if self.moved(p) > self.max_moves:
            raise ValueError('La propuesta supera el máximo de productos reubicados.')


@dataclass
class SwapModel:
    positions: np.ndarray   # slot of every item: products first, then dummies
    products: int
    pairs: tuple
    constant: float
    linear: np.ndarray
    quadratic: np.ndarray   # upper triangular, each interaction once
    moved_change: np.ndarray

    @property
    def qubits(self):
        return len(self.pairs)

    def decode(self, bits):
        p = self.positions.copy()
        for bit, (a, b) in zip(bits, self.pairs):
            if bit:
                p[a], p[b] = p[b], p[a]
        return p[:self.products]

    def evaluate(self, bits):
        z = np.atleast_2d(np.asarray(bits, dtype=float))
        return self.constant + z @ self.linear + np.einsum('bi,ij,bj->b', z, self.quadratic, z)

    def ising(self):
        h = -self.linear / 2 - (self.quadratic.sum(axis=0) + self.quadratic.sum(axis=1)) / 4
        return h, self.quadratic / 4


def items_and_positions(problem, current):
    taken = set(current.tolist())
    empty = [slot for slot in problem.assignable.tolist() if slot not in taken]
    return np.concatenate([current, np.asarray(empty, dtype=int)]).astype(int)


def candidate_pairs(problem, current):
    """Every rule-compatible pair with its single-swap index change and its effect on the relocated count."""
    n, positions = problem.n, items_and_positions(problem, current)
    movable = [i for i in range(n) if i not in problem.pinned]
    items = movable + list(range(n, len(positions)))
    # M[a, s] = Σ_k F[a, k] · D[s, p_k]: the index change of moving a from s_a to t is M[a, t] − M[a, s_a].
    M = problem.F @ problem.D[:, current].T
    pairs, deltas, changes = [], [], []
    for x, u in enumerate(items):
        for v in items[x + 1:]:
            if u >= n and v >= n:
                continue
            su, sv = positions[u], positions[v]
            if (u < n and not problem.allowed[u, sv]) or (v < n and not problem.allowed[v, su]):
                continue
            if v >= n:
                delta = M[u, sv] - M[u, su]
            else:
                delta = M[u, sv] - M[u, su] - M[v, sv] + M[v, su] + 2 * problem.F[u, v] * problem.D[su, sv]
            change = sum(int(positions[o] != problem.initial[i]) - int(positions[i] != problem.initial[i])
                         for i, o in ((u, v), (v, u)) if i < n)
            pairs.append((u, v)); deltas.append(delta); changes.append(change)
    return positions, pairs, np.asarray(deltas, dtype=float), np.asarray(changes, dtype=int)


def select_pairs(problem, current, qubits, rng, temperature, shadow_price=True):
    """Up to `qubits` disjoint pairs, favouring promising swaps; Gumbel noise makes blocks differ.

    Near the relocation limit each extra relocation gets a price (the median swap gain), so the block also offers
    reverts and budget-neutral swaps and can trade one relocation for a better one.
    """
    positions, pairs, deltas, changes = candidate_pairs(problem, current)
    if not pairs:
        return positions, [], np.zeros(0, dtype=int)
    slack = problem.max_moves - problem.moved(current)
    price = float(np.median(np.abs(deltas))) * max(0., 1 - slack / qubits) if shadow_price and slack < qubits else 0.
    scale = max(float(np.std(deltas)), 1.) * temperature
    order = np.argsort(deltas + price * changes + scale * rng.gumbel(size=len(deltas)))
    chosen, used = [], set()
    for index in order:
        u, v = pairs[index]
        if u in used or v in used:
            continue
        chosen.append(index); used.update((u, v))
        if len(chosen) == qubits:
            break
    return positions, [pairs[i] for i in chosen], changes[chosen]


def build_model(problem, positions, pairs, moved_change):
    k, n = len(pairs), problem.n
    patterns = [np.zeros(k, dtype=int)] + [np.eye(k, dtype=int)[j] for j in range(k)]
    interactions = [(j, l) for j in range(k) for l in range(j + 1, k)]
    for j, l in interactions:
        z = np.zeros(k, dtype=int); z[j] = z[l] = 1; patterns.append(z)
    assignments = np.repeat(positions[None, :], len(patterns), axis=0)
    for row, z in enumerate(patterns):
        for bit, (a, b) in zip(z, pairs):
            if bit:
                assignments[row, a], assignments[row, b] = assignments[row, b], assignments[row, a]
    values = problem.costs(assignments[:, :n])
    constant, linear = float(values[0]), values[1:k + 1] - values[0]
    quadratic = np.zeros((k, k))
    for value, (j, l) in zip(values[k + 1:], interactions):
        quadratic[j, l] = value - constant - linear[j] - linear[l]
    return SwapModel(positions, n, tuple(pairs), constant, linear, quadratic, np.asarray(moved_change, dtype=int))


def penalized(model, slack, weights):
    """Cost polynomial plus the unbalanced penalization of Σ c_j z_j ≤ slack, still quadratic; only steers the circuit."""
    if not np.isfinite(slack) or not weights or not model.moved_change.any():
        return model
    l1, l2 = weights
    scale = max(float(np.std(model.linear)), float(np.max(np.abs(model.linear), initial=0)) / 4, 1.)
    c = model.moved_change.astype(float)
    # −λ1·h + λ2·h², h = slack − c·z: linear part (λ1 − 2·λ2·slack)·c_j + λ2·c_j², pair part 2·λ2·c_j·c_l.
    linear = model.linear + scale * ((l1 - 2 * l2 * slack) * c + l2 * c ** 2)
    quadratic = model.quadratic + scale * np.triu(2 * l2 * np.outer(c, c), 1)
    return SwapModel(model.positions, model.products, model.pairs, model.constant, linear, quadratic, model.moved_change)


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


def repair(model, bits, moved, budget):
    """Switch off budget-increasing swaps, cheapest to undo first, until the relocation limit holds."""
    z, symmetric = bits.astype(float).copy(), model.quadratic + model.quadratic.T
    while moved > budget:
        options = [j for j in range(model.qubits) if z[j] and model.moved_change[j] > 0]
        undo = [-(model.linear[j] + symmetric[j] @ z) for j in options]
        j = options[int(np.argmin(undo))]
        z[j] = 0; moved -= model.moved_change[j]
    return z.astype(int)


def best_sample(model, counts, moved_now, budget, repairs=128):
    keys = list(counts)
    bits = np.array([[(int(key.replace(' ', ''), 2) >> j) & 1 for j in range(model.qubits)] for key in keys], dtype=int)
    shots = np.array([counts[key] for key in keys])
    energy, moved = model.evaluate(bits), moved_now + bits @ model.moved_change
    feasible = moved <= budget
    pool = [(energy[i], bits[i], False) for i in np.flatnonzero(feasible)]
    for i in np.flatnonzero(~feasible)[np.argsort(energy[~feasible])][:repairs]:
        fixed = repair(model, bits[i], int(moved[i]), budget)
        pool.append((float(model.evaluate(fixed)[0]), fixed, True))
    pool.append((model.constant, np.zeros(model.qubits, dtype=int), False))  # keeping the current plan is always allowed
    value, chosen, repaired = min(pool, key=lambda entry: entry[0])
    return chosen, float(value), {'distinct': len(keys), 'feasibleShots': float(shots[feasible].sum() / shots.sum()), 'repaired': bool(repaired)}


def block_optimum(model, moved_now, budget, batch=1 << 16):
    """Classical control on the same block: the best feasible bitstring by enumeration (only for small blocks)."""
    best = model.constant
    for start in range(0, 2 ** model.qubits, batch):
        ints = np.arange(start, min(start + batch, 2 ** model.qubits), dtype=np.int64)
        bits = ((ints[:, None] >> np.arange(model.qubits)) & 1).astype(np.int8)
        ok = moved_now + bits @ model.moved_change <= budget
        if ok.any():
            best = min(best, float(model.evaluate(bits[ok]).min()))
    return best


def solve(problem, start, options=None, report=None, cancel=None):
    o = {**DEFAULTS, **(options or {})}
    k, layers, shots, blocks = int(o['qubits']), int(o['layers']), int(o['shots']), int(o['blocks'])
    if not (1 <= k <= 64 and 1 <= layers <= 6 and 16 <= shots <= 65536 and 1 <= blocks <= 500 and o['seconds'] > 0):
        raise ValueError('Opciones QAOA fuera de rango: qubits 1–64, capas 1–6, shots 16–65536, bloques 1–500.')
    backend = backends.find(o['backend'])
    backends.check_capacity(backend, k)
    current = np.asarray(start, dtype=int)
    problem.check(current)
    started, rng = perf_counter(), np.random.default_rng(int(o['seed']))
    start_cost = current_cost = problem.cost(current)
    log, sample_seconds = [], 0.
    for block in range(blocks):
        if cancel is not None and cancel.is_set():
            raise Cancelled('Cálculo cancelado.')
        if perf_counter() - started > o['seconds']:
            break
        positions, pairs, change = select_pairs(problem, current, k, rng, float(o['temperature']), bool(o['shadowPrice']))
        if not pairs:
            break
        model = build_model(problem, positions, pairs, change)
        moved_now = problem.moved(current)
        steered = penalized(model, problem.max_moves - moved_now, o['penalty'])
        counts, meta = backends.sample(backend.id, ramp_circuit(steered, layers, o['deltaBeta'], o['deltaGamma']),
                                       shots, int(o['seed']) + block, o['bondDimension'])
        sample_seconds += meta['seconds']
        bits, value, stats = best_sample(model, counts, moved_now, problem.max_moves)
        candidate = model.decode(bits)
        problem.check(candidate)
        candidate_cost = problem.cost(candidate)
        if abs(candidate_cost - value) > 1e-6 * max(1., start_cost):
            raise RuntimeError('El polinomio del bloque no coincide con el índice real.')
        reference = block_optimum(model, moved_now, problem.max_moves) if model.qubits <= o['referenceQubits'] else None
        accepted = candidate_cost < current_cost - EPS
        before = current_cost
        if accepted:
            current, current_cost = candidate, candidate_cost
        log.append({'block': block + 1, 'qubits': model.qubits, 'before': before, 'after': current_cost, 'accepted': accepted,
                    'sampleBest': candidate_cost, 'blockOptimum': reference,
                    'foundOptimum': None if reference is None else candidate_cost <= reference + 1e-6 * max(1., start_cost),
                    **stats, **{key: meta[key] for key in ('depth', 'twoQubitGates', 'seconds', 'exact')}})
        if report:
            report({'phase': 'qaoa', 'progress': .1 + .85 * max((block + 1) / blocks, (perf_counter() - started) / o['seconds']),
                    'best': current_cost, 'block': block + 1, 'blocks': blocks})
    referenced = [entry for entry in log if entry['foundOptimum'] is not None]
    summary = {
        'id': 'qaoa-intercambios', 'label': 'Híbrido QAOA · ' + backend.label, 'backend': backend.id, 'qubits': max((e['qubits'] for e in log), default=0),
        'layers': layers, 'shots': shots, 'seed': int(o['seed']), 'blocks': len(log), 'acceptedBlocks': sum(e['accepted'] for e in log),
        'startCost': start_cost, 'qiskitGain': start_cost - current_cost,
        'feasibleShots': float(np.mean([e['feasibleShots'] for e in log])) if log else None,
        'repairedBlocks': sum(e['repaired'] for e in log),
        'optimumHitRate': sum(e['foundOptimum'] for e in referenced) / len(referenced) if referenced else None,
        'maxDepth': max((e['depth'] for e in log), default=0), 'maxTwoQubitGates': max((e['twoQubitGates'] for e in log), default=0),
        'exact': all(e['exact'] for e in log), 'bondDimension': int(o['bondDimension']) if backend.id == 'aer_mps' else None,
        'sampleSeconds': sample_seconds, 'milliseconds': round((perf_counter() - started) * 1000), 'log': log,
    }
    return current.tolist(), summary
