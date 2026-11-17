# Recent detections: Step 0 findings

## Current UI

- Both Recent lane lists render in `frontend/src/pages/LiveAttendanceMonitoring.jsx:770-855`; CAM-02 is the IN lane and CAM-01 is the OUT lane. They currently use `inEvents`/`outEvents` from `/api/events` (`:110-112,176-198`) and rows are not links to a crossing detail.
- The live camera panels and their existing “Awaiting Live Entry/Exit Detection” cards render in `frontend/src/pages/LiveAttendanceMonitoring.jsx` (panels/card locations around `:530-765`).
- The Unrecognized page is routed at `/unknown-faces` by `frontend/src/routes/AppRoutes.jsx:411-415`, rendered by `frontend/src/pages/UnknownFaces.jsx`; its existing table is around `:1520-1810` and row inspector/modal around `:2400-2530`.

## Current persistence and photo paths

- There is no crossings table or `/api/crossings` route in `backend/migrations` or `backend/src`. The persistent gate-event source is `surveillance_events` (`backend/src/modules/event/event.model.js:5-6,38-45,92-115,118-125`), with `employee_id`, image paths, camera, direction, event type, timestamp, and metadata.
- Event-to-employee association is defined in `backend/src/modules/event/event.model.js` after the model declaration; API event queries include the employee and its `faceEnrollment` (`backend/src/modules/event/event.service.js:227-247`). Thus a crossing/event with `employee_id` can be joined to the enrolled photo.
- Enrollment accepts face images in `backend/src/modules/face-enrollment/face-enrollment.service.js:65-106`, saves them to `ai-services/data/enrollment/<employeeCode>/`, and records `photoUrl`, embeddings, and model metadata when creating the enrollment (`:139-149`; `backend/src/modules/face-enrollment/face-enrollment.model.js:74-90`). The primary persisted registry photo file is named like `<employeeCode>_angle_01_photo_1.jpg`.
- Event formatting currently derives a profile photo from the joined enrollment `photoUrl` (`backend/src/modules/event/event.service.js:257-276`). The authenticated file endpoint is `/api/media/:key` (`backend/src/modules/media/media.routes.js` and `backend/src/routes/index.js:34`). Although some frontend attendance code constructs `/employee-images/...`, there is no `/employee-images` route or static mount in `backend/src/app.js`; this checkout has no working backend route by that name.
- Existing unknown-capture media paths are stored on FaceEnrollment and returned as authenticated media keys in `backend/src/modules/face-enrollment/face-enrollment.controller.js:270-294`.

## Data availability and root cause

The data needed for the Recent lists already exists in `surveillance_events`; a new crossing table is unnecessary and would duplicate event/attendance state. The UI currently filters general `/events` results into camera lanes, so its cards do not use one normalized crossing contract, do not consistently select the registry photo for employees, and have no `/unknown-faces?crossing=...` detail navigation. No feature flag currently gates this behavior.

## Repository constraint

The checkout has an empty `.git` directory. `git status` reports “not a git repository”; I cannot create the requested commit without inventing repository history. I will not initialize or replace `.git`.

## Additive implementation

- Added feature-gated `/api/crossings`, `/api/crossings/:id`, and `/api/crossings/summary` routes over `surveillance_events`; this avoids duplicate crossing tables and keeps attendance writes/cooldowns untouched. The 2-second polling join selects only enrollment ID/photo path, not stored image blobs.
- Added authenticated `/employee-images/:employeeCode/:filename`. Step 0 confirmed that Vite proxied this path but the backend did not serve it, so registry photos were not retrievable through the URL already used by the frontend.
- The crossing response joins each event to its employee and `faceEnrollment`, prefers the enrolled registry photo, uses only the saved face-passport capture for unknown people, and leaves no-face captures as placeholders. It also returns frame/body evidence URLs for the review detail.
- The live page polls the summary every two seconds, renders newest-first camera lanes and crossing cards, and links rows to a filtered `/unknown-faces?crossing=...` detail. The Unrecognized page uses the crossing list and adds decision tabs/source labels while retaining the existing table layout; only `UNKNOWN`/`NO_FACE_CAPTURED` crossings get the red alarm row style.
- The AI HUD hides person body boxes when `FACE_CROSSING_MODE=true`; face boxes and vehicle/animal boxes remain visible. The mode is enabled in `backend/.env` and `ai-services/.env`, and documented in both `.env.example` files.
- No schema change or migration is needed: `surveillance_events` already stores employee association, camera, direction, timestamp, event type, image paths, and metadata. No dependency was added.

## Verification and runtime limits

- `node backend/tests/crossings.test.js`: 4/4 tests passed.
- `node frontend/tests/faceReviewMedia.test.js`: 3/3 tests passed.
- `npm run build` in `frontend/`: passed.
- `ai-services/.venv/bin/python -m unittest ai-services/src/face/testing/test_gate_face_lifecycle.py`: 11/11 tests passed, including a HUD drawing check that verifies the face box remains while the person body box/label is omitted. System Python lacks `numpy`, so the project virtualenv was used. One test logged its expected API-unavailable warning because the backend was stopped.
- The frontend (`127.0.0.1:5173`) and API (`127.0.0.1:3000`) were not running during verification. Live camera recognition, browser console behavior, and the requested live screenshots could not be verified here. No database migration was run because there is no schema change; the database was not available for an integration check.
- Commits remain unavailable because `.git` is empty and this checkout is not a Git repository.

## Recent lanes follow-up

The supplied live screenshot still showed `0 Recent` and no `View all` link, which means the new crossings request was failing and the page was using its legacy `/events` fallback. That query filtered canonical worker IDs (`CAM-01`, `CAM-02`) against camera display labels, which may include extra text and silently return no rows. The fallback now requests person events, maps active display names to canonical camera IDs, and uses the registry profile photo when supplied. `backend/tests/event-camera-filter.test.js` covers decorated and generic camera labels. The frontend build and review media tests passed after this fix.
