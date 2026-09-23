FROM node:22-bookworm-slim AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    DB_PATH=/app/runtime/career_quest.sqlite3 DATA_DIR=/app/data STATIC_DIR=/app/static
WORKDIR /app
COPY backend/requirements-core.txt backend/requirements.txt /app/backend/
COPY backend/recommendation/requirements-ai.txt /app/backend/recommendation/requirements-ai.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
RUN useradd --create-home --uid 10001 appuser && mkdir -p /app/runtime && chown appuser:appuser /app/runtime
COPY backend/ /app/backend/
COPY data/ /app/data/
COPY --from=frontend-build /build/frontend/dist/ /app/static/
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
