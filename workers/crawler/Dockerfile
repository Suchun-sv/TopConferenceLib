FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev curl git \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv
WORKDIR /app
COPY pyproject.toml ./
RUN uv sync --no-dev || uv sync
COPY . .
CMD ["uv", "run", "python", "-m", "crawler.cli", "worker"]
