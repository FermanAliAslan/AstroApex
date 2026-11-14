"""Exercise the compiled C/Lua planner without reading or replacing a saved result."""
import json
import os
import subprocess
import tempfile
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

    def test_bad_request_preserves_previous_output(self):
        self.calculate()
        previous = self.output.read_bytes()
        self.request["time_range"]["end_utc"] = "2020-01-01T00:00:00Z"
        self.calculate(success=False)
        self.assertEqual(self.output.read_bytes(), previous)

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
