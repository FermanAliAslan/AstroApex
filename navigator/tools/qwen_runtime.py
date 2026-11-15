# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["mlx==0.32.4", "mlx-lm==0.32.2", "transformers==5.23.0"]
# ///
"""Serve AstroApex's local Qwen3.5-4B with MLX on an Apple Silicon Mac.

From navigator, run: uv run --offline tools/qwen_runtime.py
The pinned dependencies and weights are already cached on the prototype Mac.
On another Mac, install the script dependencies and obtain the 4-bit MLX weights
first. Pass --model-dir PATH or set ASTROAPEX_QWEN_MODEL_DIR to select a weight directory.
The planner's server connects to this process over 127.0.0.1:8772.
"""
import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1",
                  TOKENIZERS_PARALLELISM="false")

from mlx_lm import load, stream_generate
from mlx_lm.sample_utils import make_sampler

MODEL_ID = "qwen3.5-4b"
PORT = 8772
DEFAULT_MODEL = Path(os.environ.get("ASTROAPEX_QWEN_MODEL_DIR") or
                     Path(__file__).resolve().parents[3] / "qwen-size-benchmark/models/4B")
MAX_REQUEST = 400_000


class RequestHandler(BaseHTTPRequestHandler):
    timeout = 8

    def log_message(self, fmt, *args):
        pass  # The request body and prompt never enter logs.

    def respond(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def allowed(self):
        # This backend accepts server-to-server requests only.
        return (self.headers.get_all("Host") == [f"127.0.0.1:{PORT}"]
                and "Origin" not in self.headers and "Sec-Fetch-Site" not in self.headers)

    def do_GET(self):
        if not self.allowed():
            return self.respond(403, {"error": "Local bridge required"})
        if self.path != "/v1/models":
            return self.respond(404, {"error": "Unknown endpoint"})
        self.respond(200, {"object": "list", "data": [{"id": MODEL_ID, "object": "model"}]})

    def do_POST(self):
        if not self.allowed():
            return self.respond(403, {"error": "Local bridge required"})
        if self.path != "/v1/chat/completions":
            return self.respond(404, {"error": "Unknown endpoint"})
        if self.headers.get_content_type() != "application/json":
            return self.respond(415, {"error": "JSON required"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_REQUEST:
                return self.respond(413, {"error": "Invalid request size"})
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict) or data.get("model") != MODEL_ID or data.get("stream"):
                raise ValueError
            messages = data.get("messages")
            if not isinstance(messages, list) or not 1 <= len(messages) <= 32:
                raise ValueError
            if not all(isinstance(msg, dict) and msg.get("role") in {"system", "user", "assistant"}
                       and isinstance(msg.get("content"), str) for msg in messages):
                raise ValueError
            limit = data.get("max_tokens", 350)
            if type(limit) is not int or not 1 <= limit <= 1024:
                raise ValueError
            prompt = self.server.tokenizer.apply_chat_template(
                messages, tokenize=True, add_generation_prompt=True, enable_thinking=False, return_dict=False)
            if len(prompt) > 16384:
                return self.respond(413, {"error": "Context exceeds local runtime limit"})
        except (ValueError, KeyError, TypeError):
            return self.respond(400, {"error": "Invalid completion request"})

        chunks = []
        try:
            for step in stream_generate(self.server.model, self.server.tokenizer, prompt=prompt,
                                        max_tokens=limit, sampler=make_sampler(temp=0)):
                chunks.append(step.text)
            message = {"role": "assistant", "content": "".join(chunks).strip()}
            self.respond(200, {"model": MODEL_ID, "choices": [{"index": 0, "message": message,
                                                               "finish_reason": step.finish_reason}],
                               "usage": {"prompt_tokens": len(prompt), "completion_tokens": step.generation_tokens}})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except RuntimeError:
            self.respond(503, {"error": "Local generation unavailable"})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL)
    model_dir = parser.parse_args().model_dir.expanduser().resolve()
    if not any(model_dir.glob("*.safetensors")):
        parser.error("Qwen3.5-4B MLX weights unavailable. Set --model-dir to the local weights directory.")
    try:
        config = json.loads((model_dir / "config.json").read_text())
    except (OSError, ValueError):
        parser.error("Expected a readable Qwen3.5-4B config.json in --model-dir.")
    if not isinstance(config, dict) or config.get("model_type") != "qwen3_5" or not isinstance(
        config.get("text_config"), dict
    ) or config["text_config"].get("hidden_size") != 2560:
        parser.error("Expected the Qwen3.5-4B text model.")
    with HTTPServer(("127.0.0.1", PORT), RequestHandler) as server:
        server.model, server.tokenizer = load(str(model_dir))
        print(f"AstroApex {MODEL_ID} ready on 127.0.0.1:{PORT}", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
