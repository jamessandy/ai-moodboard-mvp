# Moodblendy FLUX.2 Klein worker

The Runpod public FLUX.2 Klein endpoint is text-to-image only. Its request validator rejects `image`, `images`, and `image_urls`, so it cannot condition Moodblendy generations on the board's pixels.

This custom queue-based Serverless worker accepts the same prompt fields plus one to four native references:

```json
{
  "input": {
    "prompt": "Use Element 1 for identity and Element 2 for outfit.",
    "images": ["https://example.com/identity.png", "https://example.com/outfit.png"],
    "width": 1024,
    "height": 1024,
    "seed": 42
  }
}
```

The handler loads every URL/base64 reference as a separate PIL image and passes the list directly to `Flux2KleinPipeline(image=[...])`. It accepts `image` for single-reference compatibility and `image_urls` as an alias.

## Deploy on Runpod

1. Connect Runpod to the `jamessandy/ai-moodboard-mvp` GitHub repository.
2. Create a new endpoint using **Import Git Repository**, select branch `main`, and set **Dockerfile Path** to `runpod-worker/Dockerfile`. Runpod builds from the repository root.
3. Choose a **Queue** endpoint with one CUDA GPU per worker. Use at least 24 GB VRAM, 30 GB or more container disk, active workers `0`, and max workers appropriate for your traffic.
4. Add `HF_TOKEN` to the worker environment if the selected Hugging Face model requires it. A network volume mounted at `/runpod-volume` avoids downloading the model on every cold start.
5. Copy the new endpoint ID to Vercel as `RUNPOD_ENDPOINT_ID` and redeploy Production. Keep `RUNPOD_API_KEY` server-side.

For a manual registry build, use the repository root as the Docker context:

```bash
docker build -f runpod-worker/Dockerfile -t your-registry/moodblendy-flux2:latest .
```

The app can then send up to four ordered references natively. `FLUX_MODEL_ID` defaults to `black-forest-labs/FLUX.2-klein-4B` and can be overridden in the worker environment.
