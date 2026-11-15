"""Exercise the compiled C/Lua planner without reading or replacing a saved result."""
import json
import os
import socket
import struct
import subprocess
import tempfile
import time
import unittest
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BINARY = Path(os.environ.get("PLANNER_BINARY", ROOT / "MissionPlanner")).resolve()


def timestamp(value):
    return datetime.fromisoformat(value.removesuffix("Z"))


class BackendCLI(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.cwd = Path(tmp.name)
        (self.cwd / "lua").symlink_to(ROOT / "lua", target_is_directory=True)
        self.data = self.cwd / "data"
        self.data.mkdir()
        (self.data / "kernels").symlink_to(ROOT / "data/kernels", target_is_directory=True)
        self.input = self.data / "input.json"
        self.output = self.data / "output.json"
        self.request = json.loads((ROOT / "data/input.json").read_text())

    def invoke(self):
        return subprocess.run(
            [str(BINARY), "--once"], cwd=self.cwd, capture_output=True, text=True, timeout=60
        )

    def calculate(self, success=True):
        self.input.write_text(json.dumps(self.request))
        proc = self.invoke()
        if not success:
            self.assertNotEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            return
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertTrue(self.output.is_file(), proc.stdout + proc.stderr)
        response = json.loads(self.output.read_text())
        self.assertEqual(response["status"], "SUCCESS", response.get("message"))
        return response

    def test_default_and_june_fourteen_day_ranges(self):
        for start, end in [("2026-10-18", "2026-11-01"), ("2026-06-01", "2026-06-15")]:
            with self.subTest(start=start):
                self.request["time_range"].update(start_utc=f"{start}T00:00:00Z", end_utc=f"{end}T00:00:00Z")
                result = self.calculate()
                samples = result["samples"]
                self.assertEqual(len(samples), 336)
                elapsed = [timestamp(s["utc"]) for s in samples]
                expected = [timestamp(start) + timedelta(hours=i) for i in range(336)]
                self.assertEqual(elapsed, expected)
                summary = result["summary"]
                sun = sum(s["is_sun_visible"] for s in samples)
                earth = sum(s["is_earth_visible"] for s in samples)
                both = sum(s["is_sun_visible"] and s["is_earth_visible"] for s in samples)
                self.assertEqual(summary["total_sun_hours"], sun)
                self.assertEqual(summary["total_earth_hours"], earth)
                self.assertEqual(summary["overlap_hours"], both)

    def test_partial_last_interval(self):
        self.request["time_range"].update(start_utc="2026-06-01T00:00:00Z",
                                          end_utc="2026-06-01T02:30:00Z")
        # With this threshold every sample at the polar site is dark.
        self.request["options"]["min_sun_elevation_deg"] = 90
        result = self.calculate()
        self.assertEqual(len(result["samples"]), 3)
        self.assertEqual(timestamp(result["samples"][-1]["utc"]), timestamp("2026-06-01T02:00:00"))
        self.assertAlmostEqual(result["summary"]["longest_dark_hours"], 2.5)
        for window in result["windows"]["earth"] + result["windows"]["sun"]:
            self.assertLessEqual(timestamp(window["end_utc"]), timestamp("2026-06-01T02:30:00"))

    def test_nested_flags_and_custom_coordinates(self):
        # Coordinates accompanying use_custom=false must not silently override the named site.
        self.request["site"].update(latitude_deg=-82.25, longitude_deg=14.5, use_custom=False)
        self.request["options"].update(use_dem_horizon=False, include_earth_disk=False)
        named = self.calculate()
        self.assertNotEqual(named["meta"]["latitude_deg"], -82.25)
        self.assertEqual(named["terrain_horizon_mask"], [0] * 360)
        self.assertIs(named["meta"]["use_dem_horizon"], False)
        center_model = named["meta"]["earth_visibility_model"]

        self.request["site"]["use_custom"] = True
        self.request["options"].update(use_dem_horizon=True, include_earth_disk=True)
        custom = self.calculate()
        self.assertEqual(custom["meta"]["latitude_deg"], -82.25)
        self.assertEqual(custom["meta"]["longitude_deg"], 14.5)
        self.assertIs(custom["meta"]["use_dem_horizon"], True)
        self.assertNotEqual(custom["meta"]["earth_visibility_model"], center_model)

    def test_poles_and_reference_topocentric_geometry(self):
        self.request["time_range"]["end_utc"] = "2026-10-18T02:00:00Z"
        site = self.request["site"]
        site.update(use_custom=True, altitude_m=0)
        angles = ["sun_azimuth_deg", "sun_elevation_deg", "earth_azimuth_deg", "earth_elevation_deg"]
        # Independent azlcpo_c (ELLIPSOID, LT+S) reference values using the bundled kernels.
        for lat, lon, expected in [(-89.7668, -171.87, [267.22, 1.29, 170.12, -4.83]),
                                   (0, 0, [91.31, -5.35, 338.16, 85.29]),
                                   (45, 120, [212.33, 38.78, 296.60, -18.73])]:
            site.update(latitude_deg=lat, longitude_deg=lon)
            sample = self.calculate()["samples"][0]
            for key, reference in zip(angles, expected):
                self.assertAlmostEqual(sample[key], reference, delta=0.01)
        for pole in (-90, 90):
            site.update(latitude_deg=pole, longitude_deg=0)
            prime = self.calculate()["samples"][0]
            site["longitude_deg"] = 90
            east = self.calculate()["samples"][0]
            for body in ("sun", "earth"):
                self.assertAlmostEqual(prime[body + "_elevation_deg"], east[body + "_elevation_deg"], places=2)
                turn = (east[body + "_azimuth_deg"] - prime[body + "_azimuth_deg"] + 180) % 360 - 180
                self.assertAlmostEqual(turn, pole, delta=0.01)

    def test_dem_coverage_grid_shape_and_missing_profiles(self):
        self.request["time_range"]["end_utc"] = "2026-10-18T02:00:00Z"
        self.request["site"].update(use_custom=True, latitude_deg=-81, longitude_deg=270)
        dem = self.data / "lola_southpole.bin"
        profile = lambda value: struct.pack("=360f", *([value] * 360))
        grid = b"".join(profile(value) for value in (1, 2, 3, 4))
        dem.write_bytes(grid)
        valid = self.calculate()
        self.assertTrue(valid["using_real_dem"])
        self.assertEqual(valid["terrain_horizon_mask"], [4] * 360)
        self.request["site"]["latitude_deg"] = 0
        outside = self.calculate()
        self.assertTrue(outside["dem_out_of_bounds"])
        self.assertFalse(outside["using_real_dem"])
        self.assertEqual(outside["terrain_horizon_mask"], [0] * 360)
        self.request["site"]["latitude_deg"] = -81
        for invalid in (grid + b"x", grid + profile(5), profile(float("nan")), profile(91)):
            dem.write_bytes(invalid)
            fallback = self.calculate()
            self.assertFalse(fallback["using_real_dem"])
            self.assertEqual(fallback["meta"]["dem_info"]["name"], "GEOMETRIC_HORIZON_FALLBACK")
            self.assertEqual(fallback["terrain_horizon_mask"], [0] * 360)

    def test_named_catalogue_and_unknown_site(self):
        self.request["time_range"]["end_utc"] = "2026-10-18T02:00:00Z"
        site = self.request["site"]
        site.update(site_name="Connecting Ridge", use_custom=False)
        meta = self.calculate()["meta"]
        self.assertEqual((meta["latitude_deg"], meta["longitude_deg"]), (-89.4632, -137.49))
        site["site_name"] = "Unlisted"
        self.calculate(success=False)

    def test_bad_request_preserves_previous_output(self):
        self.calculate()
        previous = self.output.read_bytes()
        self.request["time_range"]["end_utc"] = "2020-01-01T00:00:00Z"
        self.calculate(success=False)
        self.assertEqual(self.output.read_bytes(), previous)

    def test_escaped_json_keys(self):
        # The decoder must interpret keys normally after removing its persistent cache.
        self.input.write_text(json.dumps(self.request).replace('"site"', '"si\\u0074e"'))
        proc = self.invoke()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        response = json.loads(self.output.read_text())
        self.assertEqual(response["status"], "SUCCESS")
        self.assertEqual(len(response["samples"]), 336)

    @unittest.skipIf(os.geteuid() == 0, "directory permissions require an unprivileged account")
    def test_save_failure_preserves_previous_output(self):
        self.calculate()
        previous = self.output.read_bytes()
        self.request["time_range"].update(start_utc="2026-06-01T00:00:00Z", end_utc="2026-06-15T00:00:00Z")
        # A direct overwrite of the writable old file could wrongly succeed here.
        # An atomic writer must create the replacement in this read-only directory.
        self.input.write_text(json.dumps(self.request))
        self.data.chmod(0o555)
        try:
            proc = self.invoke()
            self.assertNotEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            self.assertEqual(self.output.read_bytes(), previous)
        finally:
            self.data.chmod(0o755)


class BackendHTTP(unittest.TestCase):
    """Bounded local fixtures for HTTP framing and connection deadlines."""

    @classmethod
    def setUpClass(cls):
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(("127.0.0.1", 8080))
            except OSError:
                raise unittest.SkipTest("port 8080 is already in use")
        cls.proc = subprocess.Popen(
            [str(BINARY)], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        cls.addClassCleanup(cls.stop_server)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if cls.proc.poll() is not None:
                stdout, stderr = cls.proc.communicate()
                raise RuntimeError((stdout + stderr).decode(errors="replace"))
            try:
                with socket.create_connection(("127.0.0.1", 8080), timeout=0.2):
                    return
            except OSError:
                time.sleep(0.05)
        raise RuntimeError("native HTTP server did not start")

    @classmethod
    def stop_server(cls):
        cls.proc.terminate()
        try:
            cls.proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            cls.proc.kill()
            cls.proc.communicate()

    def receive(self, connection):
        chunks = []
        while True:
            chunk = connection.recv(65536)
            if not chunk:
                break
            chunks.append(chunk)
        return b"".join(chunks)

    def request(self, parts):
        with socket.create_connection(("127.0.0.1", 8080), timeout=10) as connection:
            for part in parts:
                connection.sendall(part)
            return self.receive(connection)

    def assert_server_available(self):
        response = self.request([b"OPTIONS /api/calculate HTTP/1.1\r\nHost: localhost\r\n\r\n"])
        self.assertTrue(response.startswith(b"HTTP/1.1 204"), response[:100])

    def test_complete_json_request(self):
        data = (ROOT / "data/input.json").read_bytes()
        header = (f"POST /api/calculate HTTP/1.1\r\nHost: localhost\r\n"
                  f"Content-Length: {len(data)}\r\n\r\n").encode()
        response = self.request([header, data[:12], data[12:]])
        header, body = response.split(b"\r\n\r\n", 1)
        self.assertTrue(header.startswith(b"HTTP/1.1 200"), header)
        self.assertEqual(json.loads(body)["status"], "SUCCESS")

    def test_incomplete_header_deadline(self):
        started = time.monotonic()
        response = self.request([b"POST /api/calculate HTTP/1.1\r\n"])
        self.assertTrue(response.startswith(b"HTTP/1.1 408"), response[:100])
        self.assertLess(time.monotonic() - started, 8)
        self.assert_server_available()

    def test_body_uses_same_absolute_deadline(self):
        with socket.create_connection(("127.0.0.1", 8080), timeout=10) as connection:
            started = time.monotonic()
            connection.sendall(b"POST /api/calculate HTTP/1.1\r\nHost: localhost\r\n")
            time.sleep(2)
            connection.sendall(b"Content-Length: 2\r\n\r\n{")
            response = self.receive(connection)
        self.assertTrue(response.startswith(b"HTTP/1.1 408"), response[:100])
        self.assertLess(time.monotonic() - started, 6.5)
        self.assert_server_available()

    def test_response_deadline_allows_next_request(self):
        # A legitimate fine-step result can exceed the socket's output buffer.
        # Stop consuming that response and check the next request still completes.
        request = json.loads((ROOT / "data/input.json").read_text())
        request["time_range"].update(start_utc="2026-06-01T00:00:00Z",
                                     end_utc="2026-06-14T00:00:00Z", step_seconds=60)
        data = json.dumps(request).encode()
        header = (f"POST /api/calculate HTTP/1.1\r\nHost: localhost\r\n"
                  f"Content-Length: {len(data)}\r\n\r\n").encode()
        with socket.socket() as unread:
            unread.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024)
            unread.settimeout(10)
            unread.connect(("127.0.0.1", 8080))
            unread.sendall(header + data)
            self.assertTrue(unread.recv(256).startswith(b"HTTP/1.1 200"))
            # Receiving the header establishes that calculation has finished.
            time.sleep(5.5)
            started = time.monotonic()
            self.assert_server_available()
            self.assertLess(time.monotonic() - started, 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
