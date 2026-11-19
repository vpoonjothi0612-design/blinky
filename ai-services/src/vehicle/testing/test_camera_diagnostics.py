import sys
import unittest
from pathlib import Path
from unittest.mock import patch

_AI_SERVICES_DIR = Path(__file__).resolve().parents[3]
_SRC_DIR = _AI_SERVICES_DIR / "src"
for _path in (str(_SRC_DIR), str(_AI_SERVICES_DIR)):
    if _path not in sys.path:
        sys.path.insert(0, _path)

from camera.camera_config import CameraConfig
from fastapi import HTTPException
from vehicle.vehicle_api import camera_diagnostics


class CameraDiagnosticsEndpointTests(unittest.TestCase):
    def test_unconfigured_camera_is_reported_as_pending_not_successful(self):
        with patch("vehicle.vehicle_api.get_available_camera_configs", return_value={}):
            result = camera_diagnostics("CAM-01")

        self.assertFalse(result["success"])
        self.assertEqual(result["state"], "NOT_CONFIGURED")
        self.assertEqual(result["decode_status"], "NOT_TESTED")

    def test_test_uses_only_configured_camera_id_and_returns_measured_result(self):
        config = CameraConfig("CAM-01", "Exit", "10.0.0.10")
        measurement = {
            "success": True,
            "state": "CONNECTED",
            "decode_status": "PASS",
            "resolution": "2688x1520",
            "fps": 24.7,
            "frames_decoded": 25,
        }
        with (
            patch("vehicle.vehicle_api.get_available_camera_configs", return_value={"CAM-01": config}),
            patch("vehicle.vehicle_api.CameraWorker") as worker_class,
        ):
            worker_class.return_value.test_connection.return_value = measurement
            result = camera_diagnostics("cam-01")

        self.assertTrue(result["success"])
        self.assertEqual(result["camera_id"], "CAM-01")
        self.assertEqual(result["direction"], "OUT")
        self.assertEqual(result["resolution"], "2688x1520")
        self.assertEqual(result["fps"], 24.7)
        worker_class.return_value.test_connection.assert_called_once_with()

    def test_unknown_camera_id_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            camera_diagnostics("CAM-03")

        self.assertEqual(raised.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
