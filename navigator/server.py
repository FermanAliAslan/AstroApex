"""AstroApex local server.

    python server.py            serve the site on http://127.0.0.1:5173
    python server.py 8080       another port
    python server.py --open     also open the browser

Needs only Python 3.8+ (standard library). The site itself also works without this server: just
double-click index.html. The server adds one thing — an optional AI model for the assistant:

    pip install anthropic
    set ANTHROPIC_API_KEY=...        (Windows)      export ANTHROPIC_API_KEY=...   (macOS / Linux)
    python server.py --open

Use the environment for provider credentials. If you previously used api_key.txt, move the key
to ANTHROPIC_API_KEY and remove the old file from the served directory. With a key configured,
use the private session URL printed
by the server (or --open) to authorize the browser. A bare root URL keeps the assistant in local mode.
The bridge accepts up to 12 model requests per minute, with at most two in flight.
"""
import json
import secrets
import socket
import time
from collections import deque
from http.cookies import CookieError, SimpleCookie
from urllib.parse import parse_qs, urlsplit
import os
import sys
import threading
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get("ASTROAPEX_MODEL", "claude-opus-5-5")
MAX_BODY = 400_000
BODY_TIMEOUT = 10
REQUEST_TIMEOUT = 45
MAX_CONNECTIONS = 16
MAX_MODEL_REQUESTS = 2
CHAT_REQUESTS_PER_MINUTE = 12
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
- Use each scenario's "ephemerisSource" and "horizon" to describe its actual data source. "spice" means
  NASA NAIF SPICE with JPL DE440; "ae" means astronomy-engine; "mixed" means both were used over that
  interval. Never describe fallback-only dates as SPICE calculations. Prefer per-scenario values over
  the top-level ephemeris metadata, which describes the available table.
- Terrain horizons may use a precomputed 80 m profile, a 480 m LOLA working grid, or a fixed angle.
  The "horizon" field identifies the effective model. Coarse cells can miss narrow ridges, so their
  visibility estimates can be optimistic.
- "ground" in MISSION DATA holds slope averaged into the 480 m working grid from NASA LOLA elevation
  data, a 1 km footprint summary, and distances to NASA Goddard permanent-shadow regions. Preserve
  missing or unavailable values. Permanent shadow is where water ice can survive; it is not proof
  of ice. Slopes at this scale do not show boulders or small craters.
- "power" in MISSION DATA is a simple battery model (constant load, Sun-tracking array, battery starts \
full); the suitability score has six parts: power, comms, darkness, landing light, terrain and ice access.
- NASA study-region centres (Lunar Surface Data Book 2025, Table A2.1-1) are reference points, not landing \
spots. The rover route is a least-cost path on a 480 m slope grid and cannot see boulders. Surface \
temperatures are a radiative-equilibrium estimate, not Diviner measurements."""


def make_client():
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        return None, "no API key (set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN)"
    try:
        import anthropic
    except ImportError:
        return None, "the 'anthropic' package is not installed (pip install anthropic)"
    return anthropic.Anthropic(timeout=30.0, max_retries=0), None


CLIENT, AI_OFF_REASON = make_client()


def ask_model(question, context):
    """One assistant turn. Returns the answer text, or raises RuntimeError with a short reason."""
    import anthropic

    context = dict(context or {})
    raw_history = context.pop("history", [])
    if not isinstance(raw_history, list):
        raw_history = []
    history = [m for m in raw_history if isinstance(m, dict)
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


def same_secret(value, expected):
    return secrets.compare_digest(value.encode("utf-8"), expected.encode("ascii"))


class Handler(SimpleHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(BODY_TIMEOUT)

    def handle(self):
        # Bound even a client that continuously trickles headers without finishing them.
        timer = threading.Timer(REQUEST_TIMEOUT, self.expire_connection)
        timer.daemon = True
        timer.start()
        try:
            super().handle()
        finally:
            timer.cancel()

    def expire_connection(self):
        try:
            self.connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    def log_message(self, fmt, *args):
        # Bootstrap URLs are capabilities. Never log paths or query strings from requests.
        path = getattr(self, "path", "").partition("?")[0]
        if path in ("/api/status", "/api/chat"):
            sys.stderr.write("%s %s\n" % (getattr(self, "command", ""), path))

    def end_headers(self):
        sensitive = getattr(self, "path", "").partition("?")[0].startswith(("/api/", "/_bootstrap"))
        self.send_header("Cache-Control", "no-store" if sensitive else "no-cache")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def valid_host(self):
        hosts = self.headers.get_all("Host", [])
        return len(hosts) == 1 and hosts[0] in self.server.allowed_hosts

    def same_origin(self):
        origins = self.headers.get_all("Origin", [])
        expected = "http://" + self.headers.get("Host", "")
        return (len(origins) <= 1 and (not origins or origins[0] == expected)
                and self.headers.get("Sec-Fetch-Site", "none") in ("none", "same-origin"))

    def authorized(self):
        if not self.valid_host() or not self.same_origin():
            return False
        tokens = self.headers.get_all("X-AstroApex-Token", [])
        if len(tokens) != 1 or not same_secret(tokens[0], self.server.launch_token):
            return False
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get("Cookie", ""))
        except CookieError:
            return False
        cookie = cookies.get(self.server.cookie_name)
        return bool(cookie and same_secret(cookie.value, self.server.session_cookie))

    def bootstrap(self):
        tokens = parse_qs(urlsplit(self.path).query).get("token", [])
        if not self.same_origin() or len(tokens) != 1 or not same_secret(tokens[0], self.server.launch_token):
            return self.send_error(403, "Invalid local session link")
        nonce = secrets.token_urlsafe(24)
        token = json.dumps(self.server.launch_token)
        body = ("<!doctype html><meta charset=utf-8><title>AstroApex</title>"
                "<p><a href=\"/\">Continue to AstroApex</a></p>"
                "<script nonce=\"%s\">try { sessionStorage.setItem('astroapex-local-token',%s); }"
                " catch (_) {} finally { location.replace('/'); }</script>" % (nonce, token)).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Set-Cookie", "%s=%s; HttpOnly; SameSite=Strict; Path=/api" %
                         (self.server.cookie_name, self.server.session_cookie))
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'nonce-%s'; base-uri 'none'; frame-ancestors 'none'" % nonce)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.valid_host():
            return self.send_error(403, "Unrecognized local host")
        path = urlsplit(self.path).path
        if path == "/_bootstrap":
            return self.bootstrap()
        if path == "/api/status":
            if not self.authorized():
                return self.send_json(403, {"ai": False, "reason": "Open the session link printed by the local server."})
            return self.send_json(200, {"ai": CLIENT is not None, "model": MODEL if CLIENT else None, "reason": AI_OFF_REASON})
        if self.is_private():
            return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        if not self.valid_host() or urlsplit(self.path).path.startswith(("/api/", "/_bootstrap")):
            return self.send_error(403)
        if self.is_private():
            return self.send_error(404)
        return super().do_HEAD()

    def is_private(self):
        """True when the request resolves to a private file, however the URL spells it."""
        path = urlsplit(self.path).path
        if any(path == p or path.startswith(p + "/") for p in PRIVATE):
            return True
        try:
            rel = os.path.relpath(os.path.realpath(self.translate_path(self.path)), os.path.realpath(ROOT))
        except ValueError:
            return True
        rel = rel.replace(os.sep, "/").casefold()
        first = rel.split("/")[0].rstrip(". ")
        return rel.startswith("..") or first in {p.strip("/").casefold() for p in PRIVATE}

    def read_body(self, length):
        deadline = time.monotonic() + BODY_TIMEOUT
        parts = []
        remaining = length
        while remaining:
            timeout = deadline - time.monotonic()
            if timeout <= 0:
                raise TimeoutError("request body deadline exceeded")
            self.connection.settimeout(timeout)
            part = self.rfile.read1(remaining)
            if not part:
                raise ValueError("incomplete request body")
            parts.append(part)
            remaining -= len(part)
        return b"".join(parts)

    def do_POST(self):
        if urlsplit(self.path).path != "/api/chat":
            return self.send_error(404)
        if not self.authorized():
            return self.send_json(403, {"error": "Local session authorization required"})
        if self.headers.get("Transfer-Encoding") or len(self.headers.get_all("Content-Length", [])) != 1:
            return self.send_json(400, {"error": "Content-Length required"})
        if self.headers.get_content_type() != "application/json":
            return self.send_json(415, {"error": "application/json required"})
        if CLIENT is None:
            return self.send_json(503, {"error": AI_OFF_REASON})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY:
                return self.send_json(413, {"error": "request too large"})
            data = json.loads(self.read_body(length).decode("utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("question"), str):
                return self.send_json(400, {"error": "question must be text"})
            question = data["question"].strip()[:4000]
            if not question:
                return self.send_json(400, {"error": "empty question"})
        except TimeoutError:
            return self.send_json(408, {"error": "request body timed out"})
        except (ValueError, UnicodeDecodeError):
            return self.send_json(400, {"error": "bad request"})
        if not self.server.model_slots.acquire(blocking=False):
            return self.send_json(429, {"error": "Two requests are already running. Try again shortly."})
        try:
            if not self.server.allow_model_request():
                return self.send_json(429, {"error": "Local request limit reached. Try again in a minute."})
            answer = ask_model(question, data.get("context") if isinstance(data.get("context"), dict) else {})
        except RuntimeError as e:
            return self.send_json(502, {"error": str(e)})
        finally:
            self.server.model_slots.release()
        return self.send_json(200, {"answer": answer})


class Server(ThreadingHTTPServer):
    # On Windows SO_REUSEADDR lets two servers share one port.
    allow_reuse_address = os.name != "nt"
    daemon_threads = True
    block_on_close = False

    def __init__(self, address, handler):
        super().__init__(address, handler)
        port = self.server_address[1]
        self.allowed_hosts = {"127.0.0.1:%d" % port, "localhost:%d" % port}
        self.launch_token = secrets.token_urlsafe(32)
        self.session_cookie = secrets.token_urlsafe(32)
        self.cookie_name = "astroapex_session_%d" % port
        self.connection_slots = threading.BoundedSemaphore(MAX_CONNECTIONS)
        self.model_slots = threading.BoundedSemaphore(MAX_MODEL_REQUESTS)
        self.rate_lock = threading.Lock()
        self.request_times = deque()

    def process_request(self, request, address):
        if not self.connection_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except Exception:
            self.connection_slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.connection_slots.release()

    def allow_model_request(self):
        now = time.monotonic()
        with self.rate_lock:
            while self.request_times and now - self.request_times[0] >= 60:
                self.request_times.popleft()
            if len(self.request_times) >= CHAT_REQUESTS_PER_MINUTE:
                return False
            self.request_times.append(now)
            return True


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
    if CLIENT is not None:
        url += "_bootstrap?token=" + server.launch_token
    if os.path.exists(os.path.join(ROOT, "api_key.txt")):
        print("Legacy api_key.txt is ignored. Use ANTHROPIC_API_KEY and remove the old file from this directory.")
    print("AstroApex is running at %s" % url)
    print("AI model: %s" % (MODEL if CLIENT else "off - " + AI_OFF_REASON))
    if CLIENT is not None:
        print("Use this private session link to enable AI in this browser. Keep it private.")
    print("Press Ctrl+C to stop.")
    if "--open" in sys.argv:
        threading.Timer(0.6, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
