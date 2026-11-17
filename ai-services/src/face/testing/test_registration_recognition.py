import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT / "src" / "face"), str(ROOT / "src" / "face" / "service")]
from face_api import extract_enrollment_embedding, get_face_service
from service import face_service


class RegistrationRecognitionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service = get_face_service()
        cls.assets = ROOT

    def vector(self, name):
        image = cv2.imread(str(self.assets / name))
        self.assertIsNotNone(image, name)
        return np.asarray(extract_enrollment_embedding(self.service, image)[0])

    def test_registration_rejects_no_face(self):
        with self.assertRaisesRegex(ValueError, "found 0"):
            extract_enrollment_embedding(self.service, np.zeros((480, 640, 3), dtype=np.uint8))

    def test_registration_rejects_multiple_faces(self):
        class TwoFaceDetector:
            def setInputSize(self, _size):
                pass

            def detect(self, _image):
                return None, np.zeros((2, 15), dtype=np.float32)

        class EnrollmentService:
            detector = TwoFaceDetector()

        with self.assertRaisesRegex(ValueError, "Expected exactly 1 face.*found 2"):
            extract_enrollment_embedding(EnrollmentService(), np.zeros((480, 640, 3), dtype=np.uint8))

    def test_same_person_scores_above_threshold(self):
        enrolled = self.vector("test.jpg")
        probe = self.vector("test2.jpg")
        self.assertGreaterEqual(float(np.dot(enrolled, probe)), self.service.recognition_threshold)

    def test_different_person_scores_below_threshold(self):
        enrolled = self.vector("test.jpg")
        probe = self.vector("unregistered_person_sharp.jpg")
        self.assertLess(float(np.dot(enrolled, probe)), self.service.recognition_threshold)

    def test_registry_reload_reads_new_registration(self):
        with patch.object(face_service, "load_all_active_embeddings", return_value={"NEW001": {"embedding": np.ones(512)}}):
            self.assertEqual(self.service.reload_employee_registry(), 1)
            self.assertIn("NEW001", self.service.registered_employee_ids)


if __name__ == "__main__":
    unittest.main()
