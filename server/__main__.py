import os

import uvicorn

from .app import app

uvicorn.run(app, host=os.environ.get('KBIT_HOST', '127.0.0.1'), port=int(os.environ.get('KBIT_PORT', '8000')))
