# Regenerate TypeScript types from the FastAPI OpenAPI schema and check for drift.
# Run this after changing any Pydantic response or request models.

$ErrorActionPreference = "Stop"

Write-Host "Exporting OpenAPI schema..." -ForegroundColor Cyan
backend\.venv\Scripts\python -m jobcopilot.cli openapi shared\openapi.json

Write-Host "Generating TypeScript types..." -ForegroundColor Cyan
npm --prefix console run gen:api

Write-Host "Checking for schema drift in shared/..." -ForegroundColor Cyan
git diff --exit-code shared/
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: shared/ has uncommitted API type changes. Commit them before pushing." -ForegroundColor Red
    exit 1
}

Write-Host "OK: TypeScript types are fully in sync with backend API models." -ForegroundColor Green
