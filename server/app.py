"""Kbit Slot calculation service: classical and hybrid QAOA plans behind a small job API, plus the static app.

Solvers: 'clasico' (the engine's annealing), 'qaoa' (hybrid blocks on a simulator or IBM hardware) and 'exacto' (MILP with
HiGHS, small instances only). Run from the repository root with `python -m server` and open http://127.0.0.1:8000.
It listens on 127.0.0.1 only.
Every plan leaves through the same engine as the browser (server/bridge.cjs → dist/engine.js), which validates the
proposal against the rules and recomputes the index before building the tasks.
"""
import importlib.metadata
import os
from functools import cache
import platform
import secrets
import subprocess
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from . import engine, exact
from .jobs import Jobs
from .quantum import backends, hybrid as hybrid_solver, ibm, swap_qaoa

ROOT = Path(__file__).resolve().parent.parent
# "null" is the origin of the app opened as a local file (dist/Kbit-Slot.html).
ORIGINS = [origin.strip() for origin in os.environ.get('KBIT_ALLOWED_ORIGINS', 'null,http://127.0.0.1:4173,http://localhost:4173').split(',') if origin.strip()]
STARTS = {'greedy': {'iterations': 0}, 'annealing': {}}


class Order(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str | int
    items: list[int] = Field(max_length=500)


class SolveRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    spec: dict = Field(default_factory=dict)
    initial: list[int] = Field(min_length=1, max_length=5000)
    orders: list[Order] = Field(min_length=1, max_length=20000)
    rules: dict = Field(default_factory=dict)
    solver: Literal['clasico', 'qaoa', 'exacto'] = 'clasico'
    options: dict = Field(default_factory=dict)


app = FastAPI(title='Kbit Slot · servicio de cálculo', version='1.0')
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=['GET', 'POST', 'DELETE'], allow_headers=['Content-Type', 'X-Kbit-Key'])
queue = Jobs()


@cache
def versions():
    found = {'python': platform.python_version()}
    for package in ('qiskit', 'qiskit-aer', 'numpy', 'fastapi'):
        try:
            found[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            found[package] = None
    try:
        found['node'] = subprocess.run([engine.node_binary(), '--version'], capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:
        found['node'] = None
    return found


def classical(job, request, orders):
    return engine.solve(request.spec, request.initial, orders, request.rules, request.options, on_progress=job.report, cancel=job.cancel)


def hybrid(job, request, orders):
    options = dict(request.options)
    # Default start: the current layout, so the blocks do the work and their gain is attributable (from a greedy plan at
    # the relocation limit the disjoint-swap blocks rarely find anything; see docs/QISKIT.md).
    start = options.pop('start', 'none')
    if start not in (*STARTS, 'none'):
        raise ValueError('El inicio debe ser greedy, annealing o none.')
    job.report({'phase': 'inicio', 'progress': .02})
    problem = swap_qaoa.Problem.from_json(engine.problem(request.spec, request.initial, orders, request.rules))
    job.report({'before': problem.cost(request.initial), 'best': problem.cost(request.initial)})
    if start == 'none':
        target, label = request.initial, 'Distribución actual'
    else:
        warm = engine.solve(request.spec, request.initial, orders, request.rules, STARTS[start], cancel=job.cancel,
                            on_progress=lambda s: job.report({'phase': 'inicio', 'progress': .02 + .06 * s['progress'], 'best': s['best']}))
        target, label = warm['target'], warm['solver']['label']
    job.report({'phase': 'qaoa', 'progress': .1})
    target, summary = hybrid_solver.solve(problem, target, options, report=job.report, cancel=job.cancel)
    summary.update({'start': start, 'startLabel': label, 'initialCost': problem.cost(request.initial)})
    job.report({'phase': 'validacion', 'progress': .97})
    return engine.plan_from(request.spec, request.initial, orders, request.rules, target, summary)


def exact_plan(job, request, orders):
    seconds = request.options.get('timeLimit', 60)
    if not isinstance(seconds, (int, float)) or not 1 <= seconds <= 600:
        raise ValueError('El límite de tiempo del cálculo exacto debe estar entre 1 y 600 segundos.')
    job.report({'phase': 'modelo', 'progress': .05})
    problem = swap_qaoa.Problem.from_json(engine.problem(request.spec, request.initial, orders, request.rules))
    job.report({'phase': 'milp', 'progress': .1, 'before': problem.cost(request.initial), 'best': problem.cost(request.initial)})
    target, summary = exact.solve(problem, seconds)
    if job.cancel.is_set():
        raise engine.Cancelled('Cálculo cancelado.')
    job.report({'phase': 'validacion', 'progress': .97, 'best': summary['value']})
    return engine.plan_from(request.spec, request.initial, orders, request.rules, target.tolist(), summary)


WORK = {'clasico': classical, 'qaoa': hybrid, 'exacto': exact_plan}


def authorize_hardware(key):
    """Hardware spends the account's QPU quota: only requests carrying the server's KBIT_API_KEY may use it."""
    expected = os.environ.get('KBIT_API_KEY')
    if not expected:
        raise HTTPException(403, 'El hardware de IBM requiere definir KBIT_API_KEY en el servidor.')
    if not key or not secrets.compare_digest(key, expected):
        raise HTTPException(401, 'Clave del servicio incorrecta.')


@app.get('/api/health')
def health():
    return {'status': 'ok', 'versions': versions(), 'solvers': list(WORK), 'backends': [b.public() for b in backends.catalog()],
            'exact': {'maxMovable': exact.MAX_MOVABLE, 'maxVariables': exact.MAX_VARIABLES},
            'hardware': {'account': ibm.has_account() or ibm.local_mode(), 'keyConfigured': bool(os.environ.get('KBIT_API_KEY'))}}


@app.get('/api/backends')
def list_backends():
    return [b.public() for b in backends.catalog()]


@app.post('/api/solve', status_code=202)
def solve(request: SolveRequest, x_kbit_key: str | None = Header(default=None)):
    if request.solver == 'qaoa' and str(request.options.get('backend', '')).startswith('ibm:'):
        authorize_hardware(x_kbit_key)
    orders = [order.model_dump() for order in request.orders]
    work = WORK[request.solver]
    job = queue.submit(request.solver, lambda job: work(job, request, orders), cancelled_error=(engine.Cancelled, hybrid_solver.Cancelled))
    return job.public()


@app.get('/api/jobs/{job_id}')
def job_status(job_id: str):
    job = queue.get(job_id)
    if job is None:
        raise HTTPException(404, 'El cálculo no existe o ya expiró.')
    return job.public()


@app.delete('/api/jobs/{job_id}')
def cancel(job_id: str):
    job = queue.cancel(job_id)
    if job is None:
        raise HTTPException(404, 'El cálculo no existe o ya expiró.')
    return job.public()


app.mount('/', StaticFiles(directory=ROOT / 'dist', html=True), name='app')
