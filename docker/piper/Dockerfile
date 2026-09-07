FROM python:3.11-slim@sha256:9534e5a8e315485d4061ed659af0fd78a284c015f9b73661b41d6bab25604534

RUN pip install --no-cache-dir "piper-tts[http]==1.8.0"

EXPOSE 5000

ENTRYPOINT ["python3", "-m", "piper.http_server"]
CMD ["-m", "/voices/en_US-lessac-medium.onnx"]
