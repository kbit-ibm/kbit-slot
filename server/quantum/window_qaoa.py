"""Window encoding for the hybrid solver: a few products re-assigned among their slots, one-hot, with Hungarian repair.

Adapted from the QAOA-LNS demo (demo2/demo-qaoa-lns.html): a window of w products and their current slots, plus up to
f empty slots, becomes one qubit per allowed (product, slot) pair, x[a, b] = 1 if a goes to b. Any re-assignment of the
window is reachable, including cycles of three or more products that disjoint swaps cannot express. On valid
assignments the model is the exact index:
    E(x) = C_fixed + Σ L[a, b]·x[a, b] + Σ F[a, c]·D[b, d]·x[a, b]·x[c, d]    (a ≠ c, b ≠ d)
with L[a, b] = Σ_{k outside} F[a, k]·D[b, p_k]. "Each product exactly once" and "each slot at most once" enter the
circuit as penalties A·(Σ_b x[a, b] − 1)² and A·Σ_{a<c} x[a, b]·x[c, b]; zones and reserved slots remove qubits instead
of penalising them. Samples that are not valid assignments are repaired with the Hungarian algorithm, keeping as many
sampled ones as possible and breaking ties by the linear cost. The relocation budget is enforced on every candidate.
"""
from itertools import permutations

import numpy as np
from scipy.optimize import linear_sum_assignment

from .qubo import Qubo, bits_from_counts


class WindowBlock:
    encoding = 'window'

    def __init__(self, problem, current, options, rng):
        self.problem, self.current = problem, np.asarray(current, dtype=int)
        self.products = self.choose_products(int(options['window']), float(options['temperature']), rng)
        empty = [s for s in problem.empty_slots(self.current) if problem.allowed[self.products, s].any()] if self.products else []
        extra = rng.choice(empty, size=min(int(options['freeSlots']), len(empty)), replace=False).tolist() if empty else []
        self.slots = [int(self.current[a]) for a in self.products] + [int(s) for s in extra]
        self.vars = [(i, j) for i, a in enumerate(self.products) for j, s in enumerate(self.slots) if problem.allowed[a, s]]
        self.penalty_scale = float(options['oneHotPenalty'])
        if len(self.products) >= 2:
            self.build()

    def choose_products(self, size, temperature, rng):
        """A window worth re-assigning: a seed, products ordered with it, and products sitting next to its partners.

        The seed is weighted by its share of the index. Near the relocation limit it is drawn from the relocated
        products half of the time, and their original slots' occupants join, so the block can trade relocations.
        Candidates are scored by order co-occurrence with the window (relatedness) plus closeness to the seed's two
        strongest partners, so the seed can take a slot beside them.
        """
        problem, current = self.problem, self.current
        movable = problem.movable()
        if len(movable) < 2:
            return []
        moved = [a for a in movable if current[a] != problem.initial[a]]
        share = (problem.F * problem.D[current][:, current]).sum(axis=1)[movable] + 1e-9
        tight = problem.max_moves - problem.moved(current) < size
        seed = int(rng.choice(moved)) if tight and moved and rng.random() < .5 else int(rng.choice(movable, p=share / share.sum()))
        window = [seed]
        if tight and seed in moved:  # whoever sits on the seed's original slot, so the seed can go home
            home = [a for a in movable if current[a] == problem.initial[seed]]
            window += home[:1]
        partners = [int(k) for k in np.argsort(-problem.F[seed]) if k != seed][:2]
        while len(window) < min(size, len(movable)):
            others = [c for c in movable if c not in window]
            ties = problem.F[np.ix_(others, window)].sum(axis=1)
            near = -np.min(problem.D[np.ix_(current[others], current[partners])], axis=1) if partners else np.zeros(len(others))
            score = ties / (np.abs(ties).max() + 1e-9) + near / (np.abs(near).max() + 1e-9)
            window.append(int(others[int(np.argmax(score + temperature * rng.gumbel(size=len(others))))]))
        return window[:size]

    @property
    def qubits(self):
        return len(self.vars) if len(self.products) >= 2 else 0

    def build(self):
        problem, current, W, S = self.problem, self.current, self.products, self.slots
        outside = [k for k in range(problem.n) if k not in W]
        F, D = problem.F, problem.D
        self.linear_cost = np.array([[sum(F[a, k] * D[s, current[k]] for k in outside) if problem.allowed[a, s] else np.inf for s in S] for a in W])
        i, j = np.triu_indices(len(outside), 1)
        fixed = float((F[np.ix_(outside, outside)][i, j] * D[current[outside]][:, current[outside]][i, j]).sum())
        q = len(self.vars)
        linear, quadratic = np.array([self.linear_cost[a, b] for a, b in self.vars]), np.zeros((q, q))
        rows, cols = np.zeros((q, q), dtype=bool), np.zeros((q, q), dtype=bool)
        for u, (a, b) in enumerate(self.vars):
            for v in range(u + 1, q):
                c, d = self.vars[v]
                if a != c and b != d:
                    quadratic[u, v] = F[W[a], W[c]] * D[S[b], S[d]]
                rows[u, v], cols[u, v] = a == c, b == d
        self.cost_model = Qubo(fixed, linear, quadratic)
        # One-hot penalties sized to dominate any single variable's cost contribution.
        A = self.penalty_scale * max(1., float(np.max(np.abs(linear) + np.abs(quadratic).sum(axis=0) + np.abs(quadratic).sum(axis=1))))
        self.one_hot = Qubo(A * len(W), -A * np.ones(q), A * (2 * rows + cols))
        self.change = np.array([int(S[b] != problem.initial[W[a]]) for a, b in self.vars])
        self.moved_outside = problem.moved(current) - sum(int(current[a] != problem.initial[a]) for a in W)

    def steered(self, weights):
        model = self.cost_model.plus(self.one_hot.linear, self.one_hot.quadratic, self.one_hot.constant)
        return model.with_inequality(self.change, self.problem.max_moves - self.moved_outside, weights)

    def assignment(self, rows_to_cols):
        p = self.current.copy()
        for a, b in rows_to_cols:
            p[self.products[a]] = self.slots[b]
        return p

    def hungarian(self, bits):
        """Closest valid assignment to a sample: keep as many sampled ones as possible, then the lowest linear cost."""
        finite = self.linear_cost[np.isfinite(self.linear_cost)]
        big = 1e6 * (float(np.abs(finite).max(initial=0)) + 1)
        matrix = np.where(np.isfinite(self.linear_cost), self.linear_cost, 1e3 * big)
        for bit, (a, b) in zip(bits, self.vars):
            if not bit:
                matrix[a, b] += big
        rows, cols = linear_sum_assignment(matrix)
        return list(zip(rows.tolist(), cols.tolist()))

    def valid(self, bits):
        chosen = [self.vars[v] for v in np.flatnonzero(bits)]
        rows = [a for a, _ in chosen]
        cols = [b for _, b in chosen]
        return len(rows) == len(self.products) and len(set(rows)) == len(rows) and len(set(cols)) == len(cols), chosen

    def decide(self, counts):
        bits, shots = bits_from_counts(counts, self.qubits)
        budget, candidates, feasible_shots = self.problem.max_moves, {tuple(self.current.tolist()): False}, 0
        for row, count in zip(bits, shots):
            ok, chosen = self.valid(row)
            p = self.assignment(chosen if ok else self.hungarian(row))
            if self.problem.moved(p) > budget:
                continue
            feasible_shots += count if ok else 0
            key = tuple(p.tolist())
            candidates[key] = candidates.get(key, True) and not ok
        keys = list(candidates)
        costs = self.problem.costs(keys)
        best = int(np.argmin(costs))
        return np.array(keys[best]), float(costs[best]), {'distinct': len(bits), 'feasibleShots': float(feasible_shots / max(1, shots.sum())),
                                                           'repaired': bool(candidates[keys[best]])}

    def exact(self):
        """Classical control: every re-assignment of the window that the rules and the budget allow."""
        allowed = np.isfinite(self.linear_cost)
        options = [self.assignment(list(enumerate(cols))) for cols in permutations(range(len(self.slots)), len(self.products))
                   if all(allowed[a, b] for a, b in enumerate(cols))]
        options = [p for p in options if self.problem.moved(p) <= self.problem.max_moves] or [self.current.copy()]
        costs = self.problem.costs(options)
        best = int(np.argmin(costs))
        return options[best], float(costs[best]), {'distinct': len(options), 'feasibleShots': None, 'repaired': False}

    def describe(self):
        return {'products': len(self.products), 'slots': len(self.slots)}
