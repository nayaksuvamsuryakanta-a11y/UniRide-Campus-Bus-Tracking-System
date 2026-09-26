FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt requirements-deploy.txt ./
RUN pip install --no-cache-dir -r requirements-deploy.txt

COPY . .

ENV CAMPUS_BUS_HOST=0.0.0.0 \
    CAMPUS_BUS_PORT=5000 \
    CAMPUS_BUS_DB=/data/campus_bus.db \
    CAMPUS_BUS_ENV=production
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 5000
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--worker-class", "gthread", "--workers", "1", "--threads", "16", "--timeout", "0", "wsgi:app"]
