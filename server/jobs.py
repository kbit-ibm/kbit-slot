"""In-memory job queue: one calculation at a time, progress snapshots, cooperative cancellation."""
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor


class Job:
    def __init__(self, kind):
        self.id, self.kind = uuid.uuid4().hex, kind
        self.status, self.progress, self.result, self.error = 'queued', {'phase': 'cola', 'progress': 0}, None, None
        self.cancel = threading.Event()
        self.created, self.finished = time.time(), None

    def report(self, progress):
        self.progress = {**self.progress, **progress}

    def public(self):
        return {'id': self.id, 'kind': self.kind, 'status': self.status, 'progress': self.progress,
                'result': self.result, 'error': self.error}


class Jobs:
    def __init__(self, keep=50):
        self.keep, self.items, self.lock = keep, {}, threading.Lock()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='kbit-job')

    def submit(self, kind, work, cancelled_error=()):
        job = Job(kind)
        with self.lock:
            self.items[job.id] = job
            for old in [j for j in self.items.values() if j.finished][:max(0, len(self.items) - self.keep)]:
                self.items.pop(old.id, None)

        def run():
            if job.cancel.is_set():
                job.status, job.finished = 'cancelled', time.time()
                return
            job.status = 'running'
            try:
                job.result = work(job)
                job.status = 'done'
                job.progress = {**job.progress, 'progress': 1}
            except cancelled_error:
                job.status = 'cancelled'
            except Exception as error:  # reported to the client as text
                job.status, job.error = ('cancelled', None) if job.cancel.is_set() else ('failed', str(error))
            finally:
                job.finished = time.time()
        self.executor.submit(run)
        return job

    def get(self, job_id):
        with self.lock:
            return self.items.get(job_id)

    def cancel(self, job_id):
        job = self.get(job_id)
        if job and job.status in ('queued', 'running'):
            job.cancel.set()
            if job.status == 'queued':
                job.status, job.finished = 'cancelled', time.time()
        return job
