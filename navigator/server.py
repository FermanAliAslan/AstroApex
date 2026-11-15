"""AstroApex local server.

    python server.py            serve the site on http://127.0.0.1:5173
    python server.py 8080       another port
    python server.py --open     also open the browser

Needs only Python 3.8+ (standard library). The site itself also works without this server: just
double-click index.html. The server adds one thing — an optional AI model for the assistant:

    pip install anthropic
    set ANTHROPIC_API_KEY=...        (Windows)      export ANTHROPIC_API_KEY=...   (macOS / Linux)
    python server.py --open

Alternatively put the key alone in a file named api_key.txt next to this script (never share that
file). The key stays on this computer: the browser only talks to this server.
"""
import json
import os
import sys
import threading
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get("ASTROAPEX_MODEL", "claude-opus-5-5")
MAX_BODY = 400_000
PRIVATE = ("/api_key.txt", "/server.py", "/.claude", "/kernels", "/tools")

SYSTEM_PROMPT = """You are the AstroApex mission assistant inside a lunar landing-site planning tool \
(NASA Space Apps Challenge, "Lunar Landing Site Navigator"). Users compare two scenarios, A and B: \
a landing site, a start date and a mission duration. The tool computes when the Sun (power) and the \
Earth (direct-to-Earth communication) are above the local horizon.

Each user message contains three parts:
- QUESTION: what the user asked.
- LOCAL ANALYSIS: the answer computed by the tool's own engine for this question. It may include fresh \
simulations (best start dates, site rankings, a region scan for the best landing points, what-if runs, \
battery or propellant sizing, the best point inside each NASA study region, a rover route to the nearest ice \
trap) and measured ground data (slope, distance to permanently shadowed ice traps).
- MISSION DATA: the live state of both scenarios as JSON.

How to answer:
- Every number you state must come from LOCAL ANALYSIS or MISSION DATA. Do not invent values, and do \
not recompute ephemerides yourself. If the data does not contain what is asked, say so and say what \
the user could ask the tool to compute instead.
- Explain what the numbers mean for the mission: power, communications, thermal survival, landing \
safety, propellant. Give a clear recommendation when one is asked for, with the reason.
- Reply in the language given by "language" in MISSION DATA ("tr" = Turkish, "en" = English).
- Be concise: a few short paragraphs or a short list. Plain text; **bold** and "- " lists are the only \
formatting that renders. No tables, no headings.
- The score, propellant, battery and temperature figures are preliminary-design indicators, not a \
certified safety analysis. Say so when the user leans on them for a go/no-go decision.
- Sun and Earth positions come from NASA NAIF SPICE with the JPL DE440 ephemeris. Terrain horizons come \
from NASA LOLA elevation data: a precomputed 80 m profile for Shackleton Rim, Connecting Ridge and Malapert \
Massif, and a profile computed from a 480 m LOLA grid for any other point south of 82 S. Sites outside that \
area use a flat horizon, so their results are optimistic.
- "ground" in MISSION DATA holds measured slope (LOLA 240 m model, 1 km footprint) and the distance to the \
nearest large permanently shadowed region (NASA Goddard map). Permanent shadow is where water ice can \
survive; it is not proof of ice. Slope at this scale does not show boulders or small craters.
- "power" in MISSION DATA is a simple battery model (constant load, Sun-tracking array, battery starts \
full); the suitability score has six parts: power, comms, darkness, landing light, terrain and ice access.
- NASA study-region centres (Lunar Surface Data Book 2025, Table A2.1-1) are reference points, not landing \
spots. The rover route is a least-cost path on a 480 m slope grid and cannot see boulders. Surface \
temperatures are a radiative-equilibrium estimate, not Diviner measurements."""


def load_key():
    """API key from the environment, or from api_key.txt next to this file. None if there is none."""
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        return ""          # the SDK reads the environment itself
    path = os.path.join(ROOT, "api_key.txt")
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError:
        return None
    try:                   # Notepad and PowerShell may save the file with a BOM or as UTF-16
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("utf-16", errors="ignore")
    key = text.replace("\ufeff", "").replace("\x00", "").strip()
    return key or None


def make_client():
    key = load_key()
    if key is None:
        return None, "no API key (set ANTHROPIC_API_KEY or create api_key.txt)"
    try:
        import anthropic
    except ImportError:
        return None, "the 'anthropic' package is not installed (pip install anthropic)"
    return (anthropic.Anthropic(api_key=key) if key else anthropic.Anthropic()), None


CLIENT, AI_OFF_REASON = make_client()


def ask_model(question, context):
    """One assistant turn. Returns the answer text, or raises RuntimeError with a short reason."""
    import anthropic

    context = dict(context or {})
    history = [m for m in context.pop("history", []) if isinstance(m, dict)
               and m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str)][-6:]
    while history and history[0]["role"] != "user":
        history.pop(0)
    local = context.pop("localAnalysis", "")
    turn = "QUESTION:\n%s\n\nLOCAL ANALYSIS:\n%s\n\nMISSION DATA:\n%s" % (
        question, local or "(none)", json.dumps(context, ensure_ascii=False))
    try:
        response = CLIENT.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            output_config={"effort": "low"},          # short grounded answers; thinking stays adaptive
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",                      # a policy decline is retried on a fallback model
            messages=history + [{"role": "user", "content": turn}],
        )
    except anthropic.AuthenticationError:
        raise RuntimeError("invalid API key")
    except anthropic.PermissionDeniedError:
        raise RuntimeError("the API key lacks permission for this model")
    except anthropic.NotFoundError:
        raise RuntimeError("model not found: %s" % MODEL)
    except anthropic.RateLimitError:
        raise RuntimeError("rate limited, try again shortly")
    except anthropic.APIStatusError as e:
        raise RuntimeError("API error %s" % e.status_code)
    except anthropic.APIConnectionError:
        raise RuntimeError("no connection to the API")
    if response.stop_reason == "refusal":
        raise RuntimeError("the model declined to answer")
    text = "".join(b.text for b in response.content if b.type == "text").strip()
    if not text:
        raise RuntimeError("empty answer")
    return text


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):       # keep the console quiet except for API calls
        if self.path.startswith("/api/"):
            sys.stderr.write("%s %s\n" % (self.command, self.path))

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0].split("#")[0]
        if path == "/api/status":
            return self.send_json(200, {"ai": CLIENT is not None, "model": MODEL if CLIENT else None, "reason": AI_OFF_REASON})
        if self.is_private():
            return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        if self.is_private():
            return self.send_error(404)
        return super().do_HEAD()

    def is_private(self):
        """True when the request resolves to a private file, however the URL spells it (case, %2E, //, /./)."""
        path = self.path.split("?")[0].split("#")[0]
        if any(path == p or path.startswith(p + "/") for p in PRIVATE):
            return True
        try:
            rel = os.path.relpath(os.path.realpath(self.translate_path(self.path)), os.path.realpath(ROOT))
        except ValueError:
            return True
        rel = rel.replace(os.sep, "/").casefold()
        first = rel.split("/")[0].rstrip(". ")
        return rel.startswith("..") or first in {p.strip("/").casefold() for p in PRIVATE}

    def do_POST(self):
        if self.path.split("?")[0] != "/api/chat":
            return self.send_error(404)
        if CLIENT is None:
            return self.send_json(503, {"error": AI_OFF_REASON})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY:
                return self.send_json(413, {"error": "request too large"})
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            question = str(data.get("question", "")).strip()[:4000]
            if not question:
                return self.send_json(400, {"error": "empty question"})
            answer = ask_model(question, data.get("context") if isinstance(data.get("context"), dict) else {})
        except RuntimeError as e:
            return self.send_json(502, {"error": str(e)})
        except (ValueError, UnicodeDecodeError):
            return self.send_json(400, {"error": "bad request"})
        return self.send_json(200, {"answer": answer})


class Server(ThreadingHTTPServer):
    # On Windows SO_REUSEADDR lets two servers share one port; without it a busy port raises and we try the next.
    allow_reuse_address = os.name != "nt"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else 5173
    handler = partial(Handler, directory=ROOT)
    server = None
    for p in ([port] if "--strict" in sys.argv else range(port, port + 20)):
        try:
            server = Server(("127.0.0.1", p), handler)
            port = p
            break
        except OSError:
            continue
    if server is None:
        sys.exit("No free port found near %d." % port)
    url = "http://127.0.0.1:%d/" % port
    print("AstroApex is running at %s" % url)
    print("AI model: %s" % (MODEL if CLIENT else "off - " + AI_OFF_REASON))
    print("Press Ctrl+C to stop.")
    if "--open" in sys.argv:
        threading.Timer(0.6, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
