# Unknown face capture: findings and fix

## Step 0 findings

The screenshots showed `NO_FACE_CAPTURED` records with sand and wall thumbnails. That was not a detector-coordinate scale bug. The camera worker passes the decoded full-resolution BGR frame to `GateObjectClassifierPipeline.process_frame` (`ai-services/src/camera/camera_worker.py`, camera loop; `ai-services/src/face/dual_camera_live_face_recognition.py`, classifier call). YOLO detections are mapped back to the source frame before tracking (`ai-services/src/surveillance/gate_classifier.py`, YOLO box conversion), and YuNet boxes/landmarks are now mapped by `map_yunet_face_to_frame` before any source-frame crop.

The prior no-face logic used a body crop or the full-frame/body preview as the `imageFace` sent to `capture-unknown`. The backend persisted that as `FaceEnrollment.photoUrl`; the Unrecognized page used `photoUrl` in its FACE column. There was no separate face/body media contract, so a valid non-face image was displayed as a face. A track with a person looking down can have no acceptable face crop; it must remain `NO_FACE_CAPTURED` with a reason and silhouette.

The active sources/callers found by searching `ai-services/src`, `backend/src`, and `frontend/src`:

- Face and body crop creation, candidate selection, and capture POST: `ai-services/src/surveillance/gate_classifier.py` (`crop_face_passport`, `_save_person_capture_bundle`, `_make_no_face_event`, `_make_unknown_event`, `_post_unknown_review_async`, `process_frame`). The worker sends separate `face_path`, `body_path`, `frame_path`, and decision fields.
- The active classifier is called by `ai-services/src/face/dual_camera_live_face_recognition.py`. Legacy capture senders also remain in `ai-services/src/face/live_face_recognition.py`, `ai-services/src/face/dual_camera_live_face_recognition.py`’s historical branches, and `ai-services/src/face/recognition/multi_employee_recognition.py`; they are not the active classifier path used by the current dual-camera worker.
- Validation, storage, and `/api/face-enrollments/unknown` formatting: `backend/src/modules/face-enrollment/face-enrollment.controller.js` and `face-enrollment.service.js`; model fields: `face-enrollment.model.js`.
- Authenticated media: `backend/src/modules/media/media.routes.js`, `media.controller.js`, `media.service.js`, mounted in `backend/src/routes/index.js`. The old Express static image mounts are removed from `backend/src/app.js`.
- Review/alarm rendering: `frontend/src/pages/UnknownFaces.jsx`, shared media fetch in `frontend/src/components/common/AuthenticatedMediaImage.jsx`, URL helpers in `frontend/src/services/media.service.js`, and alarm notifications in `frontend/src/components/layout/Header.jsx`.

The Face column now reads only `facePassportMediaKey`; no-face records have no face key and show a neutral silhouette with the reason. Body and full-frame keys are separate, and the detail view opens them separately. A no-face event never places body or frame paths in `imageFace`/`photoUrl`.

## Changes made

Face observations are scored over a track by size, YuNet landmark pose, sharpness, and brightness. The best accepted observations are retained; identity confirmation uses repeated observations. A passport crop is padded to a 3.5:4.5 ratio, and a separate aligned face image is saved when the recognizer provides one. No-face records save only context `body.jpg` and `frame.jpg`, along with `FACE_NOT_VISIBLE`, `FACE_TURNED_AWAY`, `FACE_TOO_SMALL`, or quality reason metadata.

The database migration adds only `face_passport_path`, `face_aligned_path`, `body_path`, `face_quality_score`, and `face_reason` to `face_enrollments`; the decision and frame path remain in the existing `notes` JSON field. The media endpoint requires authentication and constrains reads to the configured media folders.

## Validation status

- Frontend no-face/media-choice tests: pass (`node --test frontend/tests/faceReviewMedia.test.js`).
- Backend capture-decision tests: pass (`node --test backend/tests/captureDecision.test.js`).
- Frontend production build: pass (`npm run build`).
- Python syntax compilation: pass (`python3 -m py_compile ...`). Python lifecycle tests could not run in this environment because NumPy is not installed and this checkout has no project Python virtual environment.
- PostgreSQL migration up/down/up was not run: the configured PostgreSQL endpoint is unavailable (`SequelizeConnectionError`), so there is no safe `attface` copy to migrate here. No live database was modified.
- No new runtime dependencies were added.

## Repository and deployment notes

This checkout has an empty `.git` directory rather than valid Git metadata (`git status` reports “not a git repository”). I did not initialize or fabricate history, so the requested commit cannot be created in this checkout.

Once a disposable database copy is reachable, run migrations in order with the project's migration runner: `sequelize-cli db:migrate --env <copy-config>`, roll back this change with `sequelize-cli db:migrate:undo --name 20261116150000-add-face-capture-fields.js --env <copy-config>`, then run `sequelize-cli db:migrate --env <copy-config>` again. Confirm all five columns after each up and their absence after down. This repository currently has no `.sequelizerc` or CLI config file, so deployment must supply the migration runner's PostgreSQL configuration.

Live footage is still needed to tune each camera's minimum face size and confirm a frontal face is visible at the gate. Camera height and angle, people looking down at phones, distance, lighting, motion blur, and occlusion determine whether a face can be captured; software correctly reports no-face states when no acceptable view exists.
