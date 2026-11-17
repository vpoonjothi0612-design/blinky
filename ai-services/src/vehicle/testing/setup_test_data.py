"""Generates and prepares test inputs for vehicle detection and tracking (Tests A through F)."""

from __future__ import annotations

import glob
import shutil
from pathlib import Path

import cv2
import numpy as np

AI_SERVICES_DIR = Path(__file__).resolve().parents[3]
DATA_INPUT_DIR = AI_SERVICES_DIR / "data" / "vehicle" / "input"
ARTIFACT_DIR = Path(r"C:\Users\Admin\.gemini\antigravity-ide\brain\ae2515a3-54f3-47cf-a2e9-58d812978cec")


def setup_all_test_assets():
    DATA_INPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Copy generated images from artifacts
    single_cars = list(ARTIFACT_DIR.glob("test_single_car_*.jpg"))
    if single_cars:
        shutil.copy2(single_cars[0], DATA_INPUT_DIR / "test_a_single_car.jpg")
        print(f"[OK] Test A image saved: {DATA_INPUT_DIR / 'test_a_single_car.jpg'}")

    multi_cars = list(ARTIFACT_DIR.glob("test_multiple_cars_*.jpg"))
    if multi_cars:
        shutil.copy2(multi_cars[0], DATA_INPUT_DIR / "test_b_multiple_cars.jpg")
        print(f"[OK] Test B image saved: {DATA_INPUT_DIR / 'test_b_multiple_cars.jpg'}")

    car_moto = list(ARTIFACT_DIR.glob("test_car_motorcycle_*.jpg"))
    if car_moto:
        shutil.copy2(car_moto[0], DATA_INPUT_DIR / "test_c_car_and_motorcycle.jpg")
        print(f"[OK] Test C image saved: {DATA_INPUT_DIR / 'test_c_car_and_motorcycle.jpg'}")

    # Person only test image (Test F)
    person_img = AI_SERVICES_DIR / "different_person_clear.jpg"
    if person_img.exists():
        shutil.copy2(person_img, DATA_INPUT_DIR / "test_f_person_only.jpg")
        print(f"[OK] Test F image saved: {DATA_INPUT_DIR / 'test_f_person_only.jpg'}")

    # Generate Test Image with Real Readable Indian Plate ('MH12AB1234')
    if (DATA_INPUT_DIR / "test_a_single_car.jpg").exists():
        img_base = cv2.imread(str(DATA_INPUT_DIR / "test_a_single_car.jpg"))
        plate_w, plate_h = 200, 52
        plate_canvas = np.full((plate_h, plate_w, 3), 255, dtype=np.uint8)
        cv2.rectangle(plate_canvas, (0, 0), (plate_w - 1, plate_h - 1), (0, 0, 0), 2)
        cv2.putText(plate_canvas, "MH12AB1234", (16, 36), cv2.FONT_HERSHEY_SIMPLEX, 0.85, (0, 0, 0), 2, cv2.LINE_AA)

        car_with_plate = img_base.copy()
        # Position on front lower section of the car (x=550..750, y=580..632)
        car_with_plate[580:580 + plate_h, 550:550 + plate_w] = plate_canvas
        cv2.imwrite(str(DATA_INPUT_DIR / "test_car_with_plate.jpg"), car_with_plate)
        print(f"[OK] Test Car with Plate saved: {DATA_INPUT_DIR / 'test_car_with_plate.jpg'}")


    # 2. Generate Test D Video: Single car translating smoothly across 40 frames
    # We take the cropped car from test_a_single_car and move it across an asphalt background
    if (DATA_INPUT_DIR / "test_a_single_car.jpg").exists():
        img_a = cv2.imread(str(DATA_INPUT_DIR / "test_a_single_car.jpg"))
        # Crop car region (approx center)
        h, w = img_a.shape[:2]
        # Car is prominent in center/bottom
        # Let's create video by cropping the car and moving it on a background
        video_d_path = DATA_INPUT_DIR / "test_d_car_moving.mp4"
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        vw_d = cv2.VideoWriter(str(video_d_path), fourcc, 20.0, (640, 480))

        # Crop car patch from test_a
        car_patch = cv2.resize(img_a[int(h * 0.40):int(h * 0.75), int(w * 0.25):int(w * 0.85)], (240, 140))
        bg_base = cv2.resize(img_a[:int(h * 0.5), :], (640, 480))
        # Dim background slightly to resemble road
        bg_road = np.full((480, 640, 3), 70, dtype=np.uint8)
        cv2.line(bg_road, (0, 240), (640, 240), (255, 255, 255), 2)  # lane mark

        for f in range(40):
            frame = bg_road.copy()
            # Move car horizontally from x = 20 to x = 360
            x_pos = int(20 + f * 8.5)
            y_pos = 180
            frame[y_pos:y_pos + 140, x_pos:x_pos + 240] = car_patch
            vw_d.write(frame)
        vw_d.release()
        print(f"[OK] Test D video generated: {video_d_path}")

    # 3. Generate Test E Video: Two vehicles crossing/moving across 40 frames
    if (DATA_INPUT_DIR / "test_c_car_and_motorcycle.jpg").exists():
        img_c = cv2.imread(str(DATA_INPUT_DIR / "test_c_car_and_motorcycle.jpg"))
        hc, wc = img_c.shape[:2]
        # Car patch on left
        car_p2 = cv2.resize(img_c[int(hc * 0.35):int(hc * 0.75), int(wc * 0.12):int(wc * 0.60)], (200, 130))
        # Motorcycle patch on right
        moto_p = cv2.resize(img_c[int(hc * 0.45):int(hc * 0.80), int(wc * 0.50):int(wc * 0.95)], (160, 120))

        video_e_path = DATA_INPUT_DIR / "test_e_multiple_moving.mp4"
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        vw_e = cv2.VideoWriter(str(video_e_path), fourcc, 20.0, (640, 480))

        bg_road_2 = np.full((480, 640, 3), 75, dtype=np.uint8)
        cv2.line(bg_road_2, (0, 240), (640, 240), (200, 200, 200), 2)

        for f in range(40):
            frame = bg_road_2.copy()
            # Vehicle 1 (Car) moves from left to right in top lane
            x_car = int(10 + f * 7.0)
            y_car = 90
            frame[y_car:y_car + 130, x_car:x_car + 200] = car_p2

            # Vehicle 2 (Motorcycle) moves from right to left in bottom lane
            x_moto = int(450 - f * 6.5)
            y_moto = 260
            frame[y_moto:y_moto + 120, x_moto:x_moto + 160] = moto_p
            vw_e.write(frame)
        vw_e.release()
        print(f"[OK] Test E video generated: {video_e_path}")


if __name__ == "__main__":
    setup_all_test_assets()
