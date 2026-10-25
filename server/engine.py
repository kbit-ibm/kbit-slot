"""Calls dist/engine.js through server/bridge.cjs, so the service applies exactly the browser's rules, costs and plans."""
import json
import os
import shutil
import subprocess
import threading
from pathlib import Path

BRIDGE = Path(__file__).with_name('bridge.cjs')


class EngineError(RuntimeError):
    pass


class Cancelled(RuntimeError):
    pass


def node_binary():
    node = os.environ.get('KBIT_NODE') or shutil.which('node')
    if not node:
        raise EngineError('No se encontró Node.js. Instálalo o define KBIT_NODE con su ruta.')
    return node


def call(request, on_progress=None, cancel=None):
    """Run one bridge request; progress lines go to on_progress, and setting `cancel` kills the process."""
    with subprocess.Popen([node_binary(), str(BRIDGE)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, text=True, encoding='utf-8') as process:
        stop = threading.Event()

        def watch():
            while not stop.wait(.05):
                if cancel is not None and cancel.is_set():
                    process.kill()
                    return
        threading.Thread(target=watch, daemon=True).start()
        result = error = None
        try:
            process.stdin.write(json.dumps(request))
            process.stdin.close()
            for line in process.stdout:
                message = json.loads(line)
                if message['type'] == 'progress' and on_progress:
                    on_progress(message['state'])
                elif message['type'] in ('result', 'problem'):
                    result = message.get('plan', message.get('problem'))
                elif message['type'] == 'error':
                    error = message['message']
            details = process.stderr.read().strip()
            process.wait()
        except OSError:
            if cancel is None or not cancel.is_set():
                raise
        finally:
            stop.set()
    if cancel is not None and cancel.is_set():
        raise Cancelled('Cálculo cancelado.')
    if error or process.returncode:
        raise EngineError(error or details or 'El motor terminó con error.')
    return result


def problem(spec, initial, orders, rules):
    return call({'action': 'problem', 'spec': spec, 'initial': initial, 'orders': orders, 'rules': rules})


def solve(spec, initial, orders, rules, options=None, on_progress=None, cancel=None):
    return call({'action': 'solve', 'spec': spec, 'initial': initial, 'orders': orders, 'rules': rules, 'options': options or {}},
                on_progress, cancel)


def plan_from(spec, initial, orders, rules, target, solver):
    return call({'action': 'plan', 'spec': spec, 'initial': initial, 'orders': orders, 'rules': rules, 'target': target, 'solver': solver})
