"""Demo data straight from dist/engine.js, so Python tests use the same instance as the browser."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def demo(levels=1):
    script = "const E=require('./dist/engine.js');const I=E.createInstance({layout:{levels:%d}});process.stdout.write(JSON.stringify({spec:I.spec,...I.demo()}))" % levels
    return json.loads(subprocess.run(['node', '-e', script], cwd=ROOT, capture_output=True, text=True, check=True).stdout)
