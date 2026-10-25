"""Kbit Slot calculation service: plans behind a small job API, plus the static app.

Run from the repository root with `python -m server` and open http://127.0.0.1:8000. It listens on 127.0.0.1 only.
Every plan leaves through the same engine as the browser (server/bridge.cjs → dist/engine.js), which validates the
proposal against the rules and recomputes the index before building the tasks.
"""
import importlib.metadata
import os
from functools import cache
import platform
import subprocess
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from . import engine
from .jobs import Jobs
from .quantum import backends

ROOT = Path(__file__).resolve().parent.parent
# "null" is the origin of the app opened as a local file (dist/Kbit-Slot.html).
ORIGINS = [origin.strip() for origin in os.environ.get('KBIT_ALLOWED_ORIGINS', 'null,http://127.0.0.1:4173,http://localhost:4173').split(',') if origin.strip()]


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
    solver: Literal['clasico'] = 'clasico'
    options: dict = Field(default_factory=dict)


app = FastAPI(title='Kbit Slot · servicio de cálculo', version='1.0')
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=['GET', 'POST', 'DELETE'], allow_headers=['Content-Type'])
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


@app.get('/api/health')
def health():
    return {'status': 'ok', 'versions': versions(), 'solvers': ['clasico'], 'backends': [b.public() for b in backends.catalog()]}


@app.get('/api/backends')
def list_backends():
    return [b.public() for b in backends.catalog()]


@app.post('/api/solve', status_code=202)
def solve(request: SolveRequest):
    orders = [order.model_dump() for order in request.orders]
    job = queue.submit(request.solver, lambda job: classical(job, request, orders), cancelled_error=(engine.Cancelled,))
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
