"""IBM Quantum hardware. Not configured in this version: no devices are listed."""


def catalog():
    return []


def device(name):
    raise ValueError(f'El equipo {name} no está configurado.')


class IbmRunner:
    def __init__(self, backend, options):
        raise ValueError('La ejecución en hardware de IBM no está configurada.')
