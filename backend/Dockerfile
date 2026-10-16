# Build context: the repository root (see docker-compose.yml), so the console can be built in.
FROM node:22-slim AS console
WORKDIR /build
COPY shared ./shared
COPY console/package.json console/package-lock.json ./console/
RUN cd console && npm ci
COPY console ./console
RUN cd console && npm run build

FROM python:3.12-slim
# DejaVu Sans: a TrueType font with full Unicode coverage for the PDF renderer.
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/pyproject.toml ./
COPY backend/src ./src
RUN pip install --no-cache-dir .
COPY backend/alembic.ini ./
COPY backend/migrations ./migrations
COPY backend/templates ./templates
COPY --from=console /build/console/dist ./console

ENV JOBCOPILOT_FILE_ROOT=/data/files \
    JOBCOPILOT_CONSOLE_DIR=/app/console
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn jobcopilot.main:app --host 0.0.0.0 --port 8000"]
