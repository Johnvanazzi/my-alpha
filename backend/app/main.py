from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import models  # noqa: F401  (registers tables on Base.metadata)
from app.config import settings
from app.db import Base, engine
from app.routers import analysis, market, portfolios
from app.services.market_data import MarketDataError


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Fine while the schema is small; switch to Alembic migrations once it starts changing.
    Base.metadata.create_all(engine)
    yield


app = FastAPI(title="my-alpha API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(MarketDataError)
async def market_data_error(_: Request, exc: MarketDataError):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(ValueError)
async def value_error(_: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


for router in (portfolios.router, market.router, analysis.router):
    app.include_router(router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok"}
