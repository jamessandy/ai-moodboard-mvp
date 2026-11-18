"""Runpod Serverless handler for native FLUX.2 Klein multi-reference generation."""

from __future__ import annotations

import base64
import binascii
import os
import threading
from io import BytesIO
from typing import Any

import requests
import runpod
import torch
from diffusers import Flux2KleinPipeline
from PIL import Image


MODEL_ID = os.environ.get("FLUX_MODEL_ID", "black-forest-labs/FLUX.2-klein-4B")
MAX_REFERENCES = 4
MAX_REFERENCE_BYTES = 16 * 1024 * 1024
FETCH_TIMEOUT_SECONDS = 20

os.environ.setdefault("HF_HOME", "/runpod-volume/.cache/huggingface")
os.environ.setdefault("HF_HUB_CACHE", "/runpod-volume/.cache/huggingface/hub")
os.environ.setdefault("TORCH_HOME", "/runpod-volume/.cache/torch")


def _load_pipeline() -> Flux2KleinPipeline:
    pipeline = Flux2KleinPipeline.from_pretrained(
        MODEL_ID,
        torch_dtype=torch.bfloat16,
        token=os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN"),
    )
    if not torch.cuda.is_available():
        raise RuntimeError("FLUX.2 Klein requires a CUDA worker.")
    pipeline.enable_model_cpu_offload()
    return pipeline


PIPE = _load_pipeline()
PIPE_LOCK = threading.Lock()


def _image_from_bytes(data: bytes) -> Image.Image:
    if not data or len(data) > MAX_REFERENCE_BYTES:
        raise ValueError("Reference image is empty or exceeds 16 MB.")
    image = Image.open(BytesIO(data))
    image.load()
    return image.convert("RGB")


def _load_reference(value: str) -> Image.Image:
    value = value.strip()
    if value.startswith("https://"):
        with requests.get(
            value,
            timeout=FETCH_TIMEOUT_SECONDS,
            headers={"Accept": "image/*", "User-Agent": "Moodblendy-Runpod-Worker/1.0"},
            stream=True,
        ) as response:
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            if content_type and not content_type.startswith("image/"):
                raise ValueError("Reference URL did not return image data.")
            declared_size = int(response.headers.get("content-length", "0") or 0)
            if declared_size > MAX_REFERENCE_BYTES:
                raise ValueError("Reference image exceeds 16 MB.")
            chunks = bytearray()
            for chunk in response.iter_content(chunk_size=64 * 1024):
                chunks.extend(chunk)
                if len(chunks) > MAX_REFERENCE_BYTES:
                    raise ValueError("Reference image exceeds 16 MB.")
            return _image_from_bytes(bytes(chunks))

    encoded = value.split(",", 1)[1] if value.startswith("data:image/") and "," in value else value
    try:
        return _image_from_bytes(base64.b64decode(encoded, validate=True))
    except (ValueError, binascii.Error) as error:
        raise ValueError("Reference must be an image URL or valid base64 image.") from error


def _reference_values(job_input: dict[str, Any]) -> list[str]:
    values = job_input.get("images") or job_input.get("image_urls")
    if values is None and job_input.get("image"):
        values = [job_input["image"]]
    if values is None:
        return []
    if not isinstance(values, list):
        values = [values]
    if not values or len(values) > MAX_REFERENCES or not all(isinstance(value, str) for value in values):
        raise ValueError(f"Provide between 1 and {MAX_REFERENCES} reference image strings.")
    return values


def _bounded_dimension(value: Any, default: int) -> int:
    try:
        dimension = int(value)
    except (TypeError, ValueError):
        dimension = default
    dimension = max(256, min(2048, dimension))
    return round(dimension / 64) * 64


def handler(job: dict[str, Any]) -> dict[str, Any]:
    try:
        job_input = job.get("input") or {}
        prompt = str(job_input.get("prompt") or "").strip()
        if not prompt:
            raise ValueError("Missing required parameter: prompt.")

        references = [_load_reference(value) for value in _reference_values(job_input)]
        width = _bounded_dimension(job_input.get("width"), 1024)
        height = _bounded_dimension(job_input.get("height"), 1024)
        steps = max(1, min(50, int(job_input.get("num_inference_steps", 4))))
        seed = int(job_input.get("seed", torch.randint(0, 2**31, (1,)).item()))
        generator = torch.Generator(device="cpu").manual_seed(seed)

        pipeline_input: dict[str, Any] = {
            "prompt": prompt,
            "width": width,
            "height": height,
            "num_inference_steps": steps,
            "generator": generator,
        }
        if references:
            pipeline_input["image"] = references if len(references) > 1 else references[0]

        with PIPE_LOCK, torch.inference_mode():
            output = PIPE(**pipeline_input).images[0]

        buffer = BytesIO()
        output.save(buffer, format="PNG", optimize=True)
        return {
            "image": base64.b64encode(buffer.getvalue()).decode("ascii"),
            "seed": seed,
            "reference_count": len(references),
        }
    except Exception as error:  # Runpod serializes this result for the caller.
        return {"error": str(error)}


runpod.serverless.start({"handler": handler})
