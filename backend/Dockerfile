FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml /app/pyproject.toml
COPY app /app/app
COPY alembic.ini /app/alembic.ini
COPY alembic_migrations /app/alembic_migrations

RUN python -m pip install --upgrade pip && \
    python -m pip install .

EXPOSE 8080

CMD ["sh", "-c", "python -m alembic -c alembic.ini upgrade head && python -m uvicorn app.main:app --host 0.0.0.0 --port 8080"]
