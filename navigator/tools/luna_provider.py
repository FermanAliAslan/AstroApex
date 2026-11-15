"""Server-side mission analysis using the OpenAI Responses API."""
import http.client
import json
import os


LUNA_MODEL = "gpt-6-luna"
MAX_RESPONSE_BYTES = 1_000_000


def ask_luna(instructions, history, turn):
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OpenAI is not configured")
    payload = {
        "model": LUNA_MODEL,
        "instructions": instructions,
        "input": [*history, {"role": "user", "content": turn}],
        "reasoning": {"effort": "low"},
        "max_output_tokens": 3072,
        "store": False,
    }
    conn = http.client.HTTPSConnection("api.openai.com", timeout=30)
    try:
        conn.request("POST", "/v1/responses", body=json.dumps(payload).encode("utf-8"),
                     headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
        response = conn.getresponse()
        if response.status != 200:
            raise RuntimeError("OpenAI request failed (HTTP %d)" % response.status)
        raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise RuntimeError("OpenAI response exceeded the size limit")
        data = json.loads(raw)
        if data.get("status") != "completed":
            raise RuntimeError("OpenAI did not complete the answer")
        messages = []
        for item in data["output"]:
            if item.get("type") != "message" or item.get("role") != "assistant":
                continue
            parts = []
            for part in item["content"]:
                if part.get("type") == "refusal":
                    parts.append(part["refusal"])
                if part.get("type") == "output_text":
                    parts.append(part["text"])
            if parts:
                messages.append("".join(parts))
        answer = "\n".join(messages).strip()
        if not answer:
            raise RuntimeError("OpenAI returned an empty answer")
        return {"answer": answer, "provider": "openai", "model": LUNA_MODEL}
    except (OSError, http.client.HTTPException):
        raise RuntimeError("OpenAI connection failed") from None
    except (AttributeError, KeyError, TypeError, ValueError, RecursionError):
        raise RuntimeError("Invalid OpenAI response") from None
    finally:
        conn.close()
