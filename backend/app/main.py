import os

os.environ.setdefault("HF_HUB_OFFLINE", "1")

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .core.config import settings
from .core.db import init_db
from .routers import agent, compose, cover, jobs, library, projects, system, tools, workspace
from .services.queue import worker_loop


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
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

for r in (system.router, compose.router, projects.router, jobs.router, tools.router, library.router, cover.router, workspace.router, agent.router):
    app.include_router(r)

app.mount("/audio", StaticFiles(directory=settings.data_dir), name="audio")

web_dist = Path(__file__).resolve().parents[2] / "web" / "dist"
if web_dist.exists():
    app.mount("/", StaticFiles(directory=web_dist, html=True), name="web")
