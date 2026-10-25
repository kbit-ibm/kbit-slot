"""Demo data straight from dist/engine.js, so Python tests use the same instance as the browser."""
from server import engine


def designed(aisles=3, bays=6):
    """A Parallel design in complete mode (dist/operation-model.js), with its engine spec and example data."""
    import json, subprocess
    from pathlib import Path
    script = ("const M=require('./dist/layout-model.js'),O=require('./dist/operation-model.js');"
              f"const r=O.create({{...M.fromPreset('parallel'),aisles:{aisles},bays:{bays}}},{{mode:'completa'}});"
              "process.stdout.write(JSON.stringify({spec:r.engine.spec,...r.demo()}))")
    return json.loads(subprocess.run(['node', '-e', script], cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True, check=True).stdout)


def demo(levels=1):
    return engine.demo({'layout': {'levels': levels}})
