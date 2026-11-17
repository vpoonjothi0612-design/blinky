"""Comprehensive Multi-Angle Face Recognition Test Suite.

Verifies:
1. Multi-angle embedding loading and normalization for all active employees.
2. Front-facing recognition rate and high-confidence matching (>= 0.85).
3. Left-profile recognition using authorized left embeddings (>= 0.80).
4. Right-profile recognition using authorized right embeddings (>= 0.80).
5. Cross-employee separation (low cross-similarity, high margin).
6. Unknown person rejection (similarity < 0.65 threshold).
"""

import sys
import unittest
from pathlib import Path
import cv2
import numpy as np

# Setup paths
AI_SERVICES_DIR = Path(__file__).resolve().parents[3]
FACE_DIR = AI_SERVICES_DIR / "src" / "face"
RECOGNITION_DIR = FACE_DIR / "recognition"

sys.path.append(str(FACE_DIR))
sys.path.append(str(RECOGNITION_DIR))

from employee_registry import (
    load_all_active_embeddings,
    match_probe_against_registry,
    check_duplicate_face,
    classify_view_tag,
)
from face_config import (
    YUNET_MODEL_PATH,
    ARCFACE_MODEL_PATH,
    ENROLLMENT_BASE_DIR,
    EMBEDDINGS_DIR,
    RECOGNITION_THRESHOLD,
    DEFAULT_MIN_MATCH_MARGIN,
    REFERENCE_POINTS,
)
from face_preprocess import preprocess_face
from insightface.model_zoo import get_model


class TestMultiAngleRecognition(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        """Initializes detector, ArcFace model, and active employee embeddings."""
        cls.detector = cv2.FaceDetectorYN.create(
            str(YUNET_MODEL_PATH),
            "",
            (640, 480),
            0.6,
            0.3,
            5000,
        )
        cls.arcface = get_model(str(ARCFACE_MODEL_PATH), providers=["CPUExecutionProvider"])
        cls.arcface.prepare(ctx_id=0)
        cls.active_employees = load_all_active_embeddings()

    def _extract_embedding_from_image(self, img_path: Path) -> np.ndarray:
        """Extracts normalized 512-D embedding from image using standard pipeline."""
        self.assertTrue(img_path.exists(), f"Image path does not exist: {img_path}")
        img = cv2.imread(str(img_path))
        self.assertIsNotNone(img, f"Failed to read image: {img_path}")

        h, w = img.shape[:2]
        self.detector.setInputSize((w, h))
        _, faces = self.detector.detect(img)
        self.assertIsNotNone(faces, f"No face detected in {img_path.name}")
        self.assertGreater(len(faces), 0, f"No face detected in {img_path.name}")

        face = faces[0]
        bx, by, bw, bh = map(int, face[0:4])
        landmarks = face[4:14].reshape(5, 2)

        x1, y1 = max(0, bx), max(0, by)
        x2, y2 = min(w, bx + bw), min(h, by + bh)
        face_crop = img[y1:y2, x1:x2].copy()

        working_img = img.copy()
        enhanced = preprocess_face(face_crop)
        working_img[y1:y2, x1:x2] = enhanced

        transform, _ = cv2.estimateAffinePartial2D(
            landmarks.astype(np.float32),
            REFERENCE_POINTS,
            method=cv2.LMEDS,
        )
        self.assertIsNotNone(transform, f"Alignment transform failed for {img_path.name}")

        aligned = cv2.warpAffine(working_img, transform, (112, 112))
        raw_emb = self.arcface.get_feat(aligned).flatten()
        norm = float(np.linalg.norm(raw_emb))
        self.assertGreater(norm, 0.0)

        return raw_emb / norm

    def test_01_multi_angle_embeddings_loaded(self):
        """Verifies all registered employees have multi-angle embeddings loaded and normalized."""
        self.assertIn("EMP001", self.active_employees)
        self.assertIn("EMP002", self.active_employees)

        for emp_id in ["EMP001", "EMP002"]:
            data = self.active_employees[emp_id]
            self.assertEqual(data["embedding"].shape, (512,))
            self.assertAlmostEqual(float(np.linalg.norm(data["embedding"])), 1.0, places=4)

            # Check that multi-angle views are loaded
            views = data.get("views", [])
            self.assertIn("FRONT", views)
            self.assertIn("LEFT", views)
            self.assertIn("RIGHT", views)
            self.assertGreaterEqual(len(data["embeddings"]), 3)

            for emb in data["embeddings"]:
                self.assertEqual(emb.shape, (512,))
                self.assertAlmostEqual(float(np.linalg.norm(emb)), 1.0, places=4)

    def test_02_front_facing_recognition_accuracy(self):
        """Verifies front-facing employee photos achieve high similarity (>= 0.85) and match FRONT view."""
        test_cases = [
            ("EMP001", ENROLLMENT_BASE_DIR / "EMP001" / "EMP001_angle_01_front.jpg"),
            ("EMP001", ENROLLMENT_BASE_DIR / "EMP001" / "EMP001_angle_02_front.jpg"),
            ("EMP002", ENROLLMENT_BASE_DIR / "EMP002" / "EMP002_angle_01_front.jpg"),
        ]

        for expected_id, img_p in test_cases:
            probe = self._extract_embedding_from_image(img_p)
            decision = match_probe_against_registry(
                probe_emb=probe,
                active_employees=self.active_employees,
                recognition_threshold=RECOGNITION_THRESHOLD,
                min_match_margin=DEFAULT_MIN_MATCH_MARGIN,
            )

            self.assertEqual(decision["employee_id"], expected_id)
            self.assertTrue(decision["status"].startswith("RECOGNIZED"))
            self.assertGreaterEqual(
                decision["similarity"],
                0.85,
                f"Frontal similarity {decision['similarity']:.4f} below 0.85 for {img_p.name}",
            )
            self.assertEqual(decision["matched_view"], "FRONT")
            self.assertGreaterEqual(decision["margin"], 0.40)

    def test_03_left_profile_recognition(self):
        """Verifies left-profile photos match authorized left-angle reference (>= 0.80)."""
        test_cases = [
            ("EMP001", ENROLLMENT_BASE_DIR / "EMP001" / "EMP001_angle_05_left.jpg"),
            ("EMP002", ENROLLMENT_BASE_DIR / "EMP002" / "EMP002_angle_02_left.jpg"),
        ]

        for expected_id, img_p in test_cases:
            probe = self._extract_embedding_from_image(img_p)
            decision = match_probe_against_registry(
                probe_emb=probe,
                active_employees=self.active_employees,
                recognition_threshold=RECOGNITION_THRESHOLD,
                min_match_margin=DEFAULT_MIN_MATCH_MARGIN,
            )

            self.assertEqual(decision["employee_id"], expected_id)
            self.assertTrue(decision["status"].startswith("RECOGNIZED"))
            self.assertGreaterEqual(
                decision["similarity"],
                0.80,
                f"Left profile similarity {decision['similarity']:.4f} below 0.80 for {img_p.name}",
            )
            self.assertEqual(decision["matched_view"], "LEFT")
            self.assertGreaterEqual(decision["margin"], 0.40)

    def test_04_right_profile_recognition(self):
        """Verifies right-profile photos match authorized right-angle reference (>= 0.80)."""
        test_cases = [
            ("EMP001", ENROLLMENT_BASE_DIR / "EMP001" / "EMP001_angle_06_right.jpg"),
            ("EMP002", ENROLLMENT_BASE_DIR / "EMP002" / "EMP002_angle_03_right.jpg"),
        ]

        for expected_id, img_p in test_cases:
            probe = self._extract_embedding_from_image(img_p)
            decision = match_probe_against_registry(
                probe_emb=probe,
                active_employees=self.active_employees,
                recognition_threshold=RECOGNITION_THRESHOLD,
                min_match_margin=DEFAULT_MIN_MATCH_MARGIN,
            )

            self.assertEqual(decision["employee_id"], expected_id)
            self.assertTrue(decision["status"].startswith("RECOGNIZED"))
            self.assertGreaterEqual(
                decision["similarity"],
                0.80,
                f"Right profile similarity {decision['similarity']:.4f} below 0.80 for {img_p.name}",
            )
            self.assertEqual(decision["matched_view"], "RIGHT")
            self.assertGreaterEqual(decision["margin"], 0.40)

    def test_05_cross_employee_separation(self):
        """Verifies EMP001 profile photos do NOT match EMP002 (sim < 0.35, high margin)."""
        img_p = ENROLLMENT_BASE_DIR / "EMP001" / "EMP001_angle_05_left.jpg"
        probe = self._extract_embedding_from_image(img_p)

        decision = match_probe_against_registry(
            probe_emb=probe,
            active_employees=self.active_employees,
            recognition_threshold=RECOGNITION_THRESHOLD,
            min_match_margin=DEFAULT_MIN_MATCH_MARGIN,
        )

        emp2_sim = None
        for rank in decision["rankings"]:
            if rank["employeeId"] == "EMP002":
                emp2_sim = rank["similarity"]
                break

        self.assertIsNotNone(emp2_sim)
        self.assertLess(
            emp2_sim,
            0.35,
            f"Cross-employee similarity {emp2_sim:.4f} too high (must be < 0.35)",
        )
        self.assertGreater(
            decision["similarity"] - emp2_sim,
            0.50,
            "Margin between true employee and second candidate is insufficient",
        )

    def test_06_unknown_person_rejection(self):
        """Verifies an unregistered person is rejected as UNKNOWN (similarity < 0.65)."""
        unreg_p = AI_SERVICES_DIR / "different_person_clear.jpg"
        if not unreg_p.exists():
            unreg_p = AI_SERVICES_DIR / "different_person.jpg"

        probe = self._extract_embedding_from_image(unreg_p)
        decision = match_probe_against_registry(
            probe_emb=probe,
            active_employees=self.active_employees,
            recognition_threshold=RECOGNITION_THRESHOLD,
            min_match_margin=DEFAULT_MIN_MATCH_MARGIN,
        )

        self.assertEqual(decision["status"], "UNKNOWN")
        self.assertIsNone(decision["employee_id"])
        self.assertLess(
            decision["similarity"],
            RECOGNITION_THRESHOLD,
            f"Unregistered face similarity {decision['similarity']:.4f} must be < {RECOGNITION_THRESHOLD}",
        )

    def test_07_view_classification_helper(self):
        """Verifies classify_view_tag accurately infers angle from filenames."""
        self.assertEqual(classify_view_tag("EMP001_left.npy"), "LEFT")
        self.assertEqual(classify_view_tag("EMP001_angle_05_left.jpg"), "LEFT")
        self.assertEqual(classify_view_tag("EMP002_right.npy"), "RIGHT")
        self.assertEqual(classify_view_tag("EMP002_angle_03_right.jpg"), "RIGHT")
        self.assertEqual(classify_view_tag("EMP001_multiview_v2.npy"), "FRONT")
        self.assertEqual(classify_view_tag("EMP001_angle_01_front.jpg"), "FRONT")
        self.assertEqual(classify_view_tag("EMP001.npy"), "FRONT")


if __name__ == "__main__":
    unittest.main()
