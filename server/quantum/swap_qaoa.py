"""Swap encoding for the hybrid solver: blocks of simultaneous disjoint swaps.

Encoding (adapted from ../demo/demo-almacen/swap_qaoa.py): one qubit per disjoint pair of items, where an item is a
movable product or an empty assignable slot (a "dummy" with zero flow). Bit 1 swaps the pair, so moving a product to a
free slot is a swap with a dummy. Pairs are disjoint and the index adds pairwise terms, so the index after any
bitstring is an exact quadratic polynomial in the bits, recovered from 1 + k + k(k−1)/2 evaluations, never 2^k.

Kbit rules: pinned products never enter a pair; a pair exists only if each product may stand in the other's slot
(zones and reserved slots). The relocation budget is linear in the bits (Σ c_j z_j ≤ slack) and is handled three ways:
pairs are chosen with a shadow price per extra relocation, so a block mixes new moves with reverts; the circuit adds the
unbalanced penalization of the inequality (qubo.Qubo.with_inequality); and samples still above the budget are repaired
classically by switching off the swaps that cost least to undo.

Limitation measured on the demo: from a greedy plan at the relocation limit these blocks rarely improve, because what is
left needs chains of three or more products. The window encoding (window_qaoa.py) covers those.
"""
from dataclasses import dataclass, field

import numpy as np

from .qubo import Qubo, bits_from_counts


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

    def movable(self):
        return [i for i in range(self.n) if i not in self.pinned]

    def empty_slots(self, assignment):
        taken = set(np.asarray(assignment).tolist())
        return [slot for slot in self.assignable.tolist() if slot not in taken]

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
class SwapModel(Qubo):
    positions: np.ndarray = None   # slot of every item: products first, then dummies
    products: int = 0
    pairs: tuple = ()
    moved_change: np.ndarray = None

    def decode(self, bits):
        p = self.positions.copy()
        for bit, (a, b) in zip(bits, self.pairs):
            if bit:
                p[a], p[b] = p[b], p[a]
        return p[:self.products]


def candidate_pairs(problem, current):
    """Every rule-compatible pair with its single-swap index change and its effect on the relocated count."""
    n = problem.n
    empty = problem.empty_slots(current)
    if len(empty) > 2 * n:
        # A complete designed warehouse may have far more free slots than products: offer the 2n closest to the occupied
        # ones, so the pair list stays O(n²) instead of growing with the building.
        empty = [empty[i] for i in np.argsort(problem.D[np.ix_(empty, current)].mean(axis=1), kind='stable')[:2 * n]]
    positions = np.concatenate([current, np.asarray(empty, dtype=int)]).astype(int)
    items = problem.movable() + list(range(n, len(positions)))
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
    return SwapModel(constant, linear, quadratic, positions=positions, products=n, pairs=tuple(pairs),
                     moved_change=np.asarray(moved_change, dtype=int))


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
    bits, shots = bits_from_counts(counts, model.qubits)
    energy, moved = model.evaluate(bits), moved_now + bits @ model.moved_change
    feasible = moved <= budget
    pool = [(energy[i], bits[i], False) for i in np.flatnonzero(feasible)]
    for i in np.flatnonzero(~feasible)[np.argsort(energy[~feasible])][:repairs]:
        fixed = repair(model, bits[i], int(moved[i]), budget)
        pool.append((float(model.evaluate(fixed)[0]), fixed, True))
    pool.append((model.constant, np.zeros(model.qubits, dtype=int), False))  # keeping the current plan is always allowed
    value, chosen, repaired = min(pool, key=lambda entry: entry[0])
    return chosen, float(value), {'distinct': len(bits), 'feasibleShots': float(shots[feasible].sum() / max(1, shots.sum())), 'repaired': bool(repaired)}


def block_optimum(model, moved_now, budget, batch=1 << 16):
    """Classical control on the same block: the best feasible bitstring by enumeration (only for small blocks)."""
    best, best_bits = model.constant, np.zeros(model.qubits, dtype=int)
    for start in range(0, 2 ** model.qubits, batch):
        ints = np.arange(start, min(start + batch, 2 ** model.qubits), dtype=np.int64)
        bits = ((ints[:, None] >> np.arange(model.qubits)) & 1).astype(np.int8)
        ok = np.flatnonzero(moved_now + bits @ model.moved_change <= budget)
        if len(ok):
            values = model.evaluate(bits[ok])
            i = int(np.argmin(values))
            if values[i] < best:
                best, best_bits = float(values[i]), bits[ok[i]].astype(int)
    return best, best_bits


class SwapBlock:
    """One block of the hybrid loop: model for the circuit, decision from samples, classical enumeration control."""
    encoding = 'swaps'

    def __init__(self, problem, current, options, rng):
        self.problem, self.current = problem, np.asarray(current, dtype=int)
        positions, pairs, change = select_pairs(problem, self.current, int(options['qubits']), rng,
                                                float(options['temperature']), bool(options['shadowPrice']))
        self.model = build_model(problem, positions, pairs, change) if pairs else None
        self.moved_now = problem.moved(self.current)

    @property
    def qubits(self):
        return self.model.qubits if self.model else 0

    def steered(self, weights):
        return self.model.with_inequality(self.model.moved_change, self.problem.max_moves - self.moved_now, weights)

    def decide(self, counts):
        bits, value, stats = best_sample(self.model, counts, self.moved_now, self.problem.max_moves)
        return self.model.decode(bits), value, stats

    def exact(self):
        value, bits = block_optimum(self.model, self.moved_now, self.problem.max_moves)
        return self.model.decode(bits), value, {'distinct': 2 ** self.qubits, 'feasibleShots': None, 'repaired': False}

    def describe(self):
        return {'pairs': self.qubits}
