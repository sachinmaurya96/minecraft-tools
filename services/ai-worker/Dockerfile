FROM python:3.12-slim-bookworm
COPY --from=ghcr.io/astral-sh/uv:0.13.4 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy WORKER_HOST=0.0.0.0 WORKER_PORT=8000 WORKER_DATA_DIR=/data
WORKDIR /app/services/ai-worker
COPY services/ai-worker/pyproject.toml services/ai-worker/uv.lock ./
RUN uv sync --frozen --no-dev
COPY services/ai-worker/app ./app
RUN useradd --create-home worker && mkdir /data && chown -R worker:worker /data /app
USER worker
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD .venv/bin/python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"
CMD [".venv/bin/python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
