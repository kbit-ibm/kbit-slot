"""Exact plans for small instances: the index under the Kbit rules as a mixed-integer program solved by HiGHS.

Formulation: x[i, k] = 1 puts movable product i at slot k (only slots its zone allows and no pinned product holds).
Every pair of movable products with orders in common gets the first-level RLT linearisation (Adams–Johnson):
y[i, j, k, l] stands for x[i, k] · x[j, l], with Σ_l y = x[i, k] and Σ_k y = x[j, l]. With binary x it is exact, and its
LP relaxation is far tighter than the Kaufman–Broeckx one. Pinned products are constants: their pairs with movable
products become linear terms. The relocation limit is Σ_i x[i, initial_i] ≥ movable − maxMoves.

HiGHS returns the best plan it found and a proven lower bound; when they meet, the plan is optimal.
"""
import time

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import coo_matrix

# Above these sizes the model stops being "small": the RLT variables grow with pairs × slots².
MAX_MOVABLE = 14
MAX_VARIABLES = 120_000


class TooLarge(ValueError):
    pass


def model(problem):
    """The MILP pieces for a swap_qaoa.Problem: costs, integrality, bounds, constraints and the index of every x."""
    n, D, F = problem.n, problem.D, problem.F
    movable = problem.movable()
    pinned = sorted(problem.pinned)
    taken = {int(problem.initial[p]) for p in pinned}
    slots = {i: [int(k) for k in np.flatnonzero(problem.allowed[i]) if int(k) not in taken] for i in movable}
    if len(movable) > MAX_MOVABLE:
        raise TooLarge(f'El cálculo exacto admite hasta {MAX_MOVABLE} productos movibles; este problema tiene {len(movable)}. '
                       'Fija más productos o usa el recocido.')
    pairs = [(i, j) for a, i in enumerate(movable) for j in movable[a + 1:] if F[i, j] > 0]
    size = sum(len(slots[i]) for i in movable) + sum(len(slots[i]) * len(slots[j]) for i, j in pairs)
    if size > MAX_VARIABLES:
        raise TooLarge(f'El cálculo exacto necesitaría {size:,} variables (máximo {MAX_VARIABLES:,}). Fija más productos, '
                       'añade zonas o usa el recocido.'.replace(',', '.'))
    constant = sum(F[p, q] * D[problem.initial[p], problem.initial[q]] for a, p in enumerate(pinned) for q in pinned[a + 1:])
    x = {}
    costs = []
    for i in movable:
        for k in slots[i]:
            x[i, k] = len(costs)
            costs.append(sum(F[i, p] * D[k, problem.initial[p]] for p in pinned))
    rows, cols, values, lower, upper = [], [], [], [], []

    def constraint(terms, low, high):
        row = len(lower)
        for col, value in terms:
            rows.append(row); cols.append(col); values.append(value)
        lower.append(low); upper.append(high)

    for i in movable:
        if not slots[i]:
            raise ValueError(f'El producto {i} no tiene ninguna ubicación permitida libre.')
        constraint([(x[i, k], 1.) for k in slots[i]], 1, 1)
    for k in sorted({k for i in movable for k in slots[i]}):
        constraint([(x[i, k], 1.) for i in movable if (i, k) in x], 0, 1)
    if np.isfinite(problem.max_moves):
        stay = [(x[i, int(problem.initial[i])], 1.) for i in movable if (i, int(problem.initial[i])) in x]
        constraint(stay, len(movable) - problem.max_moves, np.inf)
    for i, j in pairs:
        y = {}
        for k in slots[i]:
            for l in slots[j]:
                if k != l:
                    y[k, l] = len(costs)
                    costs.append(F[i, j] * D[k, l])
        for k in slots[i]:
            constraint([(y[k, l], 1.) for l in slots[j] if l != k] + [(x[i, k], -1.)], 0, 0)
        for l in slots[j]:
            constraint([(y[k, l], 1.) for k in slots[i] if k != l] + [(x[j, l], -1.)], 0, 0)
    count = len(costs)
    integrality = np.zeros(count)
    integrality[list(x.values())] = 1
    matrix = coo_matrix((values, (rows, cols)), shape=(len(lower), count)).tocsr()
    return {'c': np.asarray(costs), 'integrality': integrality, 'bounds': Bounds(0, 1),
            'constraints': LinearConstraint(matrix, lower, upper), 'x': x, 'constant': float(constant),
            'variables': count, 'rows': len(lower), 'pairs': len(pairs), 'movable': len(movable)}


def solve(problem, time_limit=60.):
    """Best plan within the time limit and the solver summary: status, proven bound, gap, size and time."""
    started = time.perf_counter()
    m = model(problem)
    result = milp(m['c'], integrality=m['integrality'], bounds=m['bounds'], constraints=m['constraints'],
                  options={'time_limit': float(time_limit), 'disp': False, 'mip_rel_gap': 1e-9})
    if result.x is None:
        raise ValueError('HiGHS no encontró ninguna distribución válida en el tiempo disponible: ' + str(result.message))
    target = problem.initial.copy()
    for (i, k), col in m['x'].items():
        if result.x[col] > .5:
            target[i] = k
    value = problem.cost(target)
    dual = getattr(result, 'mip_dual_bound', None)
    bound = m['constant'] + float(dual) if dual is not None and np.isfinite(dual) else None
    optimal = result.status == 0
    if optimal:
        bound = value if bound is None else min(bound, value)
    return target, {
        'id': 'exacto', 'label': 'Exacto (MILP · HiGHS)', 'status': 'óptimo' if optimal else 'límite de tiempo',
        'optimal': optimal, 'value': value, 'bound': None if bound is None else {'value': bound, 'method': 'MILP con linealización RLT (HiGHS)'},
        'gap': None if not bound else max(0., (value - bound) / bound * 100), 'variables': m['variables'], 'constraints': m['rows'],
        'pairs': m['pairs'], 'movable': m['movable'], 'nodes': int(getattr(result, 'mip_node_count', 0) or 0),
        'seconds': round(time.perf_counter() - started, 3), 'timeLimit': float(time_limit)}
