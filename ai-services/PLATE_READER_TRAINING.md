# Plate detector setup, training, and troubleshooting

The separate plate detector is optional. The runtime uses OpenCV candidate
search until `models/plate_best.pt` exists. Vehicle YOLO weights and settings are
not used or changed by this detector.

## Install and run

Use Python 3.10 or 3.11 for the AI service environment:

```bash
cd ~/Desktop/facetrack/ai-services
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install ultralytics opencv-python numpy paddlepaddle paddleocr fast-plate-ocr
```

The project requirements already include Ultralytics, OpenCV, NumPy, PaddlePaddle,
and PaddleOCR. `fast-plate-ocr` is the new optional fallback OCR package; if it is
not installed, PaddleOCR and the OpenCV plate-candidate fallback continue to run.

Test a folder of images (put the expected registration in the filename, or use
a CSV with `filename,plate` columns):

```bash
python scripts/test_plate_reader.py ./test-data/vehicle-plates
python scripts/test_plate_reader.py ./test-data/vehicle-plates --labels-csv labels.csv
```

## Train a separate YOLO plate detector

1. Download an Indian license-plate dataset from Roboflow Universe in YOLOv8
   detection format. Keep the class name `license_plate` (a one-class dataset is
   also accepted).
2. Add 200–300 images from the actual cameras and label each plate rectangle.
   Include green EV plates, yellow commercial plates, small two-line motorcycle
   plates, day/evening light, glare, and tilted views. Split the images into
   `train`, `valid`, and `test` directories.
3. Create `plates.yaml` next to the dataset:

   ```yaml
   path: /absolute/path/to/plate-dataset
   train: images/train
   val: images/valid
   test: images/test
   names:
     0: license_plate
   ```

4. Train the plate model independently from the vehicle detector:

   ```bash
   yolo train model=yolov8s.pt data=plates.yaml epochs=60 imgsz=640
   mkdir -p models
   cp runs/detect/train/weights/best.pt models/plate_best.pt
   ```

5. Restart the AI service so the lazy plate model loader picks up the new file.
   The path can also be overridden with `PLATE_MODEL_PATH`.

### Google Colab

In a GPU runtime, install the training package, mount Drive or download the
Roboflow YOLOv8 dataset, then run the same `yolo train` command. Copy
`runs/detect/train/weights/best.pt` to the project server as
`ai-services/models/plate_best.pt` (or set `PLATE_MODEL_PATH`). Do not replace
`models/yolo/yolo11n.pt`; that remains the vehicle/person detector.

## Troubleshooting

- **No plate box:** the separate model is missing or the OpenCV fallback cannot
  find a candidate. Check the `plate_crop_path` and train the plate detector
  with labeled images from the installed camera angle.
- **Good crop, wrong text:** this is an OCR/preprocessing issue. Inspect
  `debug/plates/` and the preprocessing variant, then add correctly labeled
  examples to the test set.
- **Tiny or blurry crop:** this is a camera/vehicle distance issue. Ensure the
  plate is at least 80 pixels wide in the vehicle crop and in focus.
- **Poor two-line motorcycle reads:** include portrait motorcycle plates in the
  dataset and inspect the `two_line_split` and `two_line_split_inverted` attempts.
- **Tune without code edits:** set `YOLO_PLATE_CONFIDENCE`,
  `PLATE_MIN_VALID_CONFIDENCE`, `PLATE_MIN_CROP_WIDTH`, `PLATE_FRAME_STRIDE`,
  `PLATE_VOTE_WINDOW`, or `PLATE_VOTE_LOCK_COUNT` in the AI service environment.
