from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from jobcopilot import worker
from jobcopilot.api.routes import router
from jobcopilot.config import get_settings
from jobcopilot.errors import DomainError, NotFound, ValidationFailed


@asynccontextmanager
async def lifespan(_: FastAPI):
    # The API only enqueues tasks; `jobcopilot worker` runs them.
    with worker.app.open():
        yield


app = FastAPI(title="job-copilot", version="0.1.0", lifespan=lifespan)
app.include_router(router, prefix="/api")


@app.exception_handler(DomainError)
def domain_error(_: Request, exc: DomainError) -> JSONResponse:
    if isinstance(exc, NotFound):
        return JSONResponse({"detail": f"{exc} not found"}, status_code=404)
    if isinstance(exc, ValidationFailed):
        return JSONResponse({"detail": "validation failed", "issues": exc.issues}, status_code=422)
    return JSONResponse({"detail": str(exc), "error": type(exc).__name__}, status_code=409)


@app.get("/healthz", include_in_schema=False)
def healthz() -> dict:
    return {"ok": True}


class ConsoleFiles(StaticFiles):
    """The built web console. Unknown paths get index.html so the console's own routes deep-link."""

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or path.startswith("api/"):
                raise
            return await super().get_response("index.html", scope)


# Mounted last, so /api, /docs and /healthz win. Same origin as the API: no CORS needed.
if (get_settings().console_dir / "index.html").exists():
    app.mount("/", ConsoleFiles(directory=get_settings().console_dir, html=True), name="console")
