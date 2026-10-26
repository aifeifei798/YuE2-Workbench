import os

os.environ.setdefault("HF_HUB_OFFLINE", "1")

import asyncio
import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .core.config import settings
from .core.db import init_db
from .routers import agent, blind, compose, cover, jobs, library, projects, system, tools, versions, workspace
from .services import queue as job_queue
from .services.queue import worker_loop


mimetypes.add_type("text/plain", ".abc")
mimetypes.add_type("text/plain", ".lab")
mimetypes.add_type("text/plain", ".npy")


class DataStaticFiles(StaticFiles):
    """Serve the data dir but never expose the SQLite database (and its side files)."""

    async def get_response(self, path, scope):
        if path.split("/", 1)[0] == "workbench.db":
            raise StarletteHTTPException(404)
        return await super().get_response(path, scope)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    job_queue.recover_stale_jobs()
    worker = asyncio.create_task(worker_loop())
    yield
    worker.cancel()


app = FastAPI(title="YuE2-Workbench", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in settings.cors_origins.split(",") if o],
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (system.router, compose.router, projects.router, jobs.router, tools.router, library.router, cover.router, workspace.router, agent.router, versions.router, blind.router):
    app.include_router(r)

app.mount("/audio", DataStaticFiles(directory=settings.data_dir), name="audio")

class SPAStaticFiles(StaticFiles):
    """Serve the built SPA, falling back to index.html for client-side routes
    so deep links like /projects/<id> survive a refresh. API paths still 404."""

    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as e:
            if e.status_code == 404 and not path.startswith("api/"):
                return await super().get_response("index.html", scope)
            raise


web_dist = Path(__file__).resolve().parents[2] / "web" / "dist"
if web_dist.exists():
    app.mount("/", SPAStaticFiles(directory=web_dist, html=True), name="web")
