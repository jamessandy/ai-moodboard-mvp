FROM runpod/base:0.6.3-cuda12.1.0

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/runpod-volume/.cache/huggingface \
    HF_HUB_CACHE=/runpod-volume/.cache/huggingface/hub \
    TORCH_HOME=/runpod-volume/.cache/torch

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY runpod-worker/requirements.txt /worker/requirements.txt
RUN python3.11 -m pip install --upgrade pip \
    && python3.11 -m pip install -r /worker/requirements.txt

COPY runpod-worker/handler.py /worker/handler.py
CMD ["python3.11", "-u", "/worker/handler.py"]
