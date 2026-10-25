"""Demo data straight from dist/engine.js, so Python tests use the same instance as the browser."""
from server import engine


def demo(levels=1):
    return engine.demo({'layout': {'levels': levels}})
