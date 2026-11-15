"""Local session and input checks for the optional Navigator server. No provider calls."""
import http.client
import importlib.util
import io
import json
import os
import threading
import unittest
import tempfile
from functools import partial
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("navigator_server", ROOT / "navigator" / "server.py")
server_module = importlib.util.module_from_spec(SPEC)
with patch.dict(os.environ, {}, clear=True):
    SPEC.loader.exec_module(server_module)


class NavigatorServerTests(unittest.TestCase):
    def setUp(self):
        self.client_patch = patch.object(server_module, "CLIENT", object())
        self.client_patch.start()
        self.addCleanup(self.client_patch.stop)
        self.model_patch = patch.object(server_module, "ask_model", return_value="Local test answer")
        self.model = self.model_patch.start()
        self.addCleanup(self.model_patch.stop)
        handler = partial(server_module.Handler, directory=str(ROOT / "navigator"))
        self.server = server_module.Server(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.host = "127.0.0.1:%d" % self.server.server_address[1]
        self.headers = {
            "X-AstroApex-Token": self.server.launch_token,
            "Cookie": "%s=%s" % (self.server.cookie_name, self.server.session_cookie),
            "Origin": "http://" + self.host,
            "Sec-Fetch-Site": "same-origin",
            "Content-Type": "application/json",
        }

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1], timeout=3)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def chat(self, data=None, headers=None):
        return self.request("POST", "/api/chat", json.dumps(data or {"question": "Describe this scenario"}),
                            self.headers if headers is None else headers)

    def test_public_page_does_not_disclose_session(self):
        status, _, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertNotIn(self.server.launch_token.encode(), body)
        self.assertNotIn(self.server.session_cookie.encode(), body)
        status, _, body = self.request("GET", "/api/status")
        self.assertEqual(status, 403)
        self.assertFalse(json.loads(body)["ai"])
        self.assertNotIn(self.server.launch_token.encode(), body)
        self.assertNotIn(self.server.session_cookie.encode(), body)
        self.assertEqual(self.chat(headers={})[0], 403)
        self.model.assert_not_called()

    def test_bootstrap_requires_private_launch_link(self):
        self.assertEqual(self.request("GET", "/_bootstrap?token=invalid")[0], 403)
        path = "/_bootstrap?token=" + self.server.launch_token
        status, headers, body = self.request("GET", path)
        self.assertEqual(status, 200)
        self.assertIn("HttpOnly", headers["Set-Cookie"])
        self.assertIn("SameSite=Strict", headers["Set-Cookie"])
        self.assertIn("Path=/api", headers["Set-Cookie"])
        self.assertEqual(headers["Referrer-Policy"], "no-referrer")
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertIn(b"sessionStorage.setItem", body)
        self.assertIn(b"finally { location.replace('/')", body)
        self.assertIn(b'<a href="/">Continue to AstroApex</a>', body)

    def test_authorized_session_can_query_status_and_chat(self):
        status, _, body = self.request("GET", "/api/status", headers=self.headers)
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["ai"])
        status, _, body = self.chat()
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["answer"], "Local test answer")
        self.model.assert_called_once_with("Describe this scenario", {})

    def test_cookie_and_per_origin_header_are_both_required(self):
        for missing in ("Cookie", "X-AstroApex-Token"):
            headers = dict(self.headers)
            del headers[missing]
            self.assertEqual(self.chat(headers=headers)[0], 403)
        self.model.assert_not_called()

    def test_wrong_host_origin_and_fetch_metadata_are_rejected(self):
        for name, value in [("Host", "example.test"), ("Origin", "http://example.test"),
                            ("Sec-Fetch-Site", "cross-site"), ("Sec-Fetch-Site", "same-site"),
                            ("Host", "localhost:%d" % (self.server.server_address[1] + 1)),
                            ("Origin", "http://127.0.0.1:%d" % (self.server.server_address[1] + 1))]:
            headers = dict(self.headers, **{name: value})
            self.assertEqual(self.chat(headers=headers)[0], 403)
        self.assertEqual(self.request("GET", "/", headers={"Host": "example.test"})[0], 403)
        self.model.assert_not_called()

    def test_malformed_session_credentials_are_rejected(self):
        for name, value in [("X-AstroApex-Token", "invalid"), ("X-AstroApex-Token", "é"),
                            ("Cookie", "not a cookie"),
                            ("Cookie", self.server.cookie_name + "=invalid")]:
            headers = dict(self.headers, **{name: value})
            self.assertEqual(self.chat(headers=headers)[0], 403)
        path = "/_bootstrap?token=" + self.server.launch_token
        self.assertEqual(self.request("GET", path, headers={"Sec-Fetch-Site": "cross-site"})[0], 403)
        self.model.assert_not_called()

    def test_request_validation_precedes_model_call(self):
        self.assertEqual(self.chat(headers=dict(self.headers, **{"Content-Type": "text/plain"}))[0], 415)
        self.assertEqual(self.chat({"question": 42})[0], 400)
        self.assertEqual(self.request("POST", "/api/chat", "[]", self.headers)[0], 400)
        self.assertEqual(self.request("POST", "/api/chat", "{", self.headers)[0], 400)
        self.assertEqual(self.request("POST", "/api/chat", "{}", dict(
            self.headers, **{"Content-Length": str(server_module.MAX_BODY + 1)}))[0], 413)
        self.assertEqual(self.request("POST", "/api/chat", "{}", dict(
            self.headers, **{"Transfer-Encoding": "chunked"}))[0], 400)
        self.model.assert_not_called()

    def test_rate_limit_stops_additional_model_calls(self):
        for _ in range(server_module.CHAT_REQUESTS_PER_MINUTE):
            self.assertEqual(self.chat()[0], 200)
        self.assertEqual(self.chat()[0], 429)
        self.assertEqual(self.model.call_count, server_module.CHAT_REQUESTS_PER_MINUTE)

    def test_concurrent_model_limit_stops_additional_calls(self):
        for _ in range(server_module.MAX_MODEL_REQUESTS):
            self.server.model_slots.acquire()
        try:
            self.assertEqual(self.chat()[0], 429)
            self.model.assert_not_called()
        finally:
            for _ in range(server_module.MAX_MODEL_REQUESTS):
                self.server.model_slots.release()

    def test_request_slot_released_after_provider_failure(self):
        self.model.side_effect = RuntimeError("test provider failure")
        self.assertEqual(self.chat()[0], 502)
        self.model.side_effect = None
        self.assertEqual(self.chat()[0], 200)

    def test_body_deadline_is_absolute(self):
        handler = object.__new__(server_module.Handler)
        handler.connection = Mock()
        handler.rfile = Mock()
        handler.rfile.read1.return_value = b"x"
        with patch.object(server_module.time, "monotonic", side_effect=[0, 0, server_module.BODY_TIMEOUT + 1]):
            with self.assertRaises(TimeoutError):
                handler.read_body(2)
        self.assertEqual(handler.rfile.read1.call_count, 1)

    def test_session_tokens_change_on_restart(self):
        second = server_module.Server(("127.0.0.1", 0), server_module.Handler)
        try:
            self.assertNotEqual(self.server.launch_token, second.launch_token)
            self.assertNotEqual(self.server.session_cookie, second.session_cookie)
        finally:
            second.server_close()

    def test_keyfile_is_ignored_and_remains_private(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(server_module, "ROOT", tmp):
            (Path(tmp) / "api_key.txt").write_text("fake-key-for-local-test")
            (Path(tmp) / "public.txt").write_text("public fixture")
            with patch.dict(os.environ, {}, clear=True):
                client, reason = server_module.make_client()
            self.assertIsNone(client)
            self.assertIn("ANTHROPIC_API_KEY", reason)
            original_handler = self.server.RequestHandlerClass
            self.server.RequestHandlerClass = partial(server_module.Handler, directory=tmp)
            try:
                self.assertEqual(self.request("GET", "/public.txt")[0], 200)
                self.assertEqual(self.request("GET", "/api_key.txt")[0], 404)
            finally:
                self.server.RequestHandlerClass = original_handler

    def test_logs_and_early_response_do_not_require_parsed_path(self):
        handler = object.__new__(server_module.Handler)
        handler.request_version = "HTTP/1.1"
        handler.wfile = io.BytesIO()
        handler.requestline = ""
        handler.command = None
        handler.client_address = ("127.0.0.1", 0)
        with patch.object(server_module.sys, "stderr", new_callable=io.StringIO) as err:
            handler.log_error("unparsed request")
            handler.send_error(400, "Bad request")
            self.assertEqual(err.getvalue(), "")
        self.assertIn(b"400 Bad request", handler.wfile.getvalue())

    def test_private_source_file_remains_unavailable(self):
        self.assertEqual(self.request("GET", "/server.py")[0], 404)


if __name__ == "__main__":
    unittest.main()

