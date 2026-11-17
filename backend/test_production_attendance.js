/**
 * Production IN/OUT Attendance Integration Test Suite
 * Tests:
 * 1. Health & Authentication
 * 2. CAM-02 IN Event recording with audit fields (employeeId, cameraId, eventType, similarity, eventId)
 * 3. Idempotent Retry with same eventId
 * 4. Duplicate Frame Debounce (repeated IN within cooldown)
 * 5. CAM-01 OUT Event recording
 * 6. Unknown Face / Invalid Employee rejection
 * 7. Shift calculation: Late Arrival & On-time Arrival
 * 8. Working duration calculation (IN to OUT with break deduction)
 * 9. Approved Leave & Holiday detection
 * 10. Absence calculation respecting cutoff time
 * 11. Concurrent camera events under database transactions
 */

import http from "node:http";
import sequelize from "./src/config/database.js";
import Shift from "./src/modules/shifts/shift.model.js";
import Employee from "./src/modules/employee/employee.model.js";
import Holiday from "./src/modules/holiday/holiday.model.js";
import Leave from "./src/modules/leave/leave.model.js";
import Attendance from "./src/modules/attendance/attendance.model.js";

const BACKEND_HOST = "localhost";
const BACKEND_PORT = 3000;
const AUTH_HEADER = "Bearer AI_SYSTEM_INTERNAL_TOKEN_V1";

function apiRequest({ method, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const reqHeaders = {
      "Content-Type": "application/json",
      ...headers,
    };
    if (postData) {
      reqHeaders["Content-Length"] = Buffer.byteLength(postData);
    }

    const req = http.request(
      {
        hostname: BACKEND_HOST,
        port: BACKEND_PORT,
        path,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            const parsed = raw ? JSON.parse(raw) : null;
            resolve({ status: res.statusCode, data: parsed, raw });
          } catch (e) {
            resolve({ status: res.statusCode, raw });
          }
        });
      }
    );

    req.on("error", reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log("===============================================================");
  console.log("PRODUCTION IN/OUT ATTENDANCE INTEGRATION TEST SUITE");
  console.log("===============================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = "") {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${details}`);
      failed++;
    }
  }

  let testEmp = null;

  try {
    // 0. Ensure an active General Shift and an isolated Test Employee
    const [generalShift] = await Shift.findOrCreate({
      where: { name: "General Shift" },
      defaults: {
        startTime: "09:00:00",
        endTime: "18:00:00",
        gracePeriod: 15,
        breakDuration: 60,
        isCrossMidnight: false,
        isActive: true,
      },
    });

    const testEmpCode = "TEST_" + Date.now().toString().slice(-6);
    testEmp = await Employee.create({
      employeeCode: testEmpCode,
      firstName: "Test",
      lastName: "Runner",
      status: "ACTIVE",
      shiftId: generalShift.id,
    });

    console.log(`Setup: Created isolated test employee ${testEmp.employeeCode} (${testEmp.id})\n`);

    // 1. Health Check
    const health = await apiRequest({ method: "GET", path: "/api/health" });
    assert(health.status === 200 && health.data?.success === true, "1. Backend health check is 200 OK");

    // 2. Auth Check - Unauthorized without token
    const unauth = await apiRequest({
      method: "POST",
      path: "/api/attendance",
      body: { employeeId: testEmp.employeeCode },
    });
    assert(unauth.status === 401, "2. Unauthorized request without Bearer token is rejected (401)");

    // 3. CAM-02 IN Event Recording (On-time morning entry)
    const onTimeDate = new Date();
    onTimeDate.setHours(8, 55, 0, 0); // 8:55 AM local time, on-time for 9:00 AM shift

    const inEventId = "test-event-in-" + Date.now();
    const inRes = await apiRequest({
      method: "POST",
      path: "/api/attendance",
      headers: { Authorization: AUTH_HEADER },
      body: {
        employeeId: testEmp.employeeCode,
        cameraId: "CAM-02",
        eventType: "IN",
        similarity: 0.892,
        eventId: inEventId,
        source: "AI_CAMERA",
        timestamp: onTimeDate.toISOString(),
      },
    });
    assert(
      inRes.status === 201 &&
        inRes.data?.data?.eventType === "IN" &&
        inRes.data?.data?.status === "PRESENT" &&
        inRes.data?.data?.eventId === inEventId,
      "3. CAM-02 IN event recorded with eventType 'IN', similarity, eventId, and status 'PRESENT'",
      JSON.stringify(inRes.data)
    );

    // 4. Idempotency Check with same eventId
    const retryRes = await apiRequest({
      method: "POST",
      path: "/api/attendance",
      headers: { Authorization: AUTH_HEADER },
      body: {
        employeeId: testEmp.employeeCode,
        cameraId: "CAM-02",
        eventType: "IN",
        similarity: 0.892,
        eventId: inEventId, // same eventId
        source: "AI_CAMERA",
        timestamp: onTimeDate.toISOString(),
      },
    });
    assert(
      retryRes.status === 200 && retryRes.data?.message?.includes("idempotent"),
      "4. Retry with identical eventId handled idempotently (200 OK, created=false)",
      JSON.stringify(retryRes.data)
    );

    // 5. Duplicate Frame Debounce (same employee, same eventType within cooldown window)
    const dupRes = await apiRequest({
      method: "POST",
      path: "/api/attendance",
      headers: { Authorization: AUTH_HEADER },
      body: {
        employeeId: testEmp.employeeCode,
        cameraId: "CAM-02",
        eventType: "IN",
        similarity: 0.901,
        eventId: "test-event-in-dup-" + Date.now(),
        source: "AI_CAMERA",
        timestamp: new Date(onTimeDate.getTime() + 10000).toISOString(), // 10s later
      },
    });
    assert(
      dupRes.status === 200 && dupRes.data?.message?.includes("cooldown"),
      "5. Repeated frame within 60s cooldown is debounced (200 OK, not duplicated)",
      JSON.stringify(dupRes.data)
    );

    // 6. CAM-01 OUT Event Recording (allowed immediately without waiting for IN cooldown!)
    const outEventId = "test-event-out-" + Date.now();
    const outDate = new Date();
    outDate.setHours(18, 5, 0, 0); // 18:05 local time

    const outRes = await apiRequest({
      method: "POST",
      path: "/api/attendance",
      headers: { Authorization: AUTH_HEADER },
      body: {
        employeeId: testEmp.employeeCode,
        cameraId: "CAM-01",
        eventType: "OUT",
        similarity: 0.865,
        eventId: outEventId,
        source: "AI_CAMERA",
        timestamp: outDate.toISOString(),
      },
    });
    assert(
      outRes.status === 201 && outRes.data?.data?.eventType === "OUT",
      "6. CAM-01 OUT event recorded with eventType 'OUT' and audit fields",
      JSON.stringify(outRes.data)
    );

    // 7. Unknown Face / Invalid Employee Rejection
    const unknownRes = await apiRequest({
      method: "POST",
      path: "/api/attendance",
      headers: { Authorization: AUTH_HEADER },
      body: {
        employeeId: "UNKNOWN_PERSON_NON_EXISTENT",
        cameraId: "CAM-02",
        eventType: "IN",
        similarity: 0.42,
        eventId: "test-event-unknown-" + Date.now(),
      },
    });
    assert(
      unknownRes.status === 404,
      "7. Unknown employee / face is rejected with 404, attendance never recorded",
      JSON.stringify(unknownRes.data)
    );

    // 8. Shift Late Arrival Calculation
    const lateEmpCode = "TEST_LATE_" + Date.now().toString().slice(-6);
    const lateEmp = await Employee.create({
      employeeCode: lateEmpCode,
      firstName: "Late",
      lastName: "Person",
      status: "ACTIVE",
      shiftId: generalShift.id,
    });

    const lateDate = new Date();
    lateDate.setHours(9, 45, 0, 0); // 9:45 AM local (> 9:00 + 15m grace)

    const lateRes = await apiRequest({
      method: "POST",
      path: "/api/attendance",
      headers: { Authorization: AUTH_HEADER },
      body: {
        employeeId: lateEmp.employeeCode,
        cameraId: "CAM-02",
        eventType: "IN",
        similarity: 0.88,
        eventId: "test-late-event-" + Date.now(),
        timestamp: lateDate.toISOString(),
      },
    });
    assert(
      lateRes.status === 201 && lateRes.data?.data?.status === "LATE",
      "8. Late arrival after shift start + grace period is automatically marked 'LATE'",
      JSON.stringify(lateRes.data)
    );

    // 9. Daily Attendance Summary & Working Duration
    const todayStr = new Intl.DateTimeFormat("en-CA").format(new Date());
    const summaryRes = await apiRequest({
      method: "GET",
      path: `/api/attendance/daily-summary/${testEmp.employeeCode}?date=${todayStr}`,
      headers: { Authorization: AUTH_HEADER },
    });
    assert(
      summaryRes.status === 200 &&
        summaryRes.data?.data?.totalDurationMinutes > 0 &&
        summaryRes.data?.data?.netDurationMinutes >= 0 &&
        summaryRes.data?.data?.shift?.name === "General Shift",
      "9. Daily summary calculates working duration, break deduction, and shift metrics",
      JSON.stringify(summaryRes.data?.data)
    );

    // 10. Holiday Calculation
    const testHolidayDate = "2026-12-25";
    await Holiday.findOrCreate({
      where: { date: testHolidayDate },
      defaults: { name: "Christmas Day", description: "Public Holiday" },
    });
    const holidaySummary = await apiRequest({
      method: "GET",
      path: `/api/attendance/daily-summary/${testEmp.employeeCode}?date=${testHolidayDate}`,
      headers: { Authorization: AUTH_HEADER },
    });
    assert(
      holidaySummary.status === 200 && holidaySummary.data?.data?.status === "HOLIDAY",
      "10. Configured holiday correctly reflects status 'HOLIDAY'",
      JSON.stringify(holidaySummary.data?.data)
    );

    // 11. Approved Leave Calculation
    const testLeaveDate = "2026-11-15";
    await Leave.create({
      employeeId: testEmp.id,
      startDate: testLeaveDate,
      endDate: testLeaveDate,
      type: "CASUAL",
      status: "APPROVED",
      reason: "Annual vacation",
    });
    const leaveSummary = await apiRequest({
      method: "GET",
      path: `/api/attendance/daily-summary/${testEmp.employeeCode}?date=${testLeaveDate}`,
      headers: { Authorization: AUTH_HEADER },
    });
    assert(
      leaveSummary.status === 200 && leaveSummary.data?.data?.status === "LEAVE",
      "11. Approved leave correctly reflects status 'LEAVE'",
      JSON.stringify(leaveSummary.data?.data)
    );

    // 12. Cutoff & Absence Calculation
    const pastNoPunchDate = "2026-01-01";
    const pastSummary = await apiRequest({
      method: "GET",
      path: `/api/attendance/daily-summary/${testEmp.employeeCode}?date=${pastNoPunchDate}`,
      headers: { Authorization: AUTH_HEADER },
    });
    assert(
      pastSummary.status === 200 && pastSummary.data?.data?.status === "ABSENT",
      "12. Past date without punches is marked 'ABSENT' after cutoff",
      JSON.stringify(pastSummary.data?.data)
    );

    // 13. Concurrent Camera Events under DB transactions
    console.log("\nTesting 5 concurrent simultaneous camera requests...");
    const concurrentPromises = [1, 2, 3, 4, 5].map((i) =>
      apiRequest({
        method: "POST",
        path: "/api/attendance",
        headers: { Authorization: AUTH_HEADER },
        body: {
          employeeId: testEmp.employeeCode,
          cameraId: i % 2 === 0 ? "CAM-01" : "CAM-02",
          eventType: i % 2 === 0 ? "OUT" : "IN",
          similarity: 0.85,
          eventId: `concurrent-event-${i}-${Date.now()}`,
          timestamp: new Date().toISOString(),
        },
      })
    );
    const concurrentResults = await Promise.all(concurrentPromises);
    const allHandledSafely = concurrentResults.every((r) => r.status === 201 || r.status === 200);
    assert(
      allHandledSafely,
      "13. Concurrent simultaneous camera requests handled safely without crashes or deadlocks",
      concurrentResults.map((r) => r.status).join(", ")
    );

    // 14. CAM-01 Directional Enforcement: Reject IN event
    const cam1WrongRes = await apiRequest({
      method: "POST",
      path: "/api/attendance",
      headers: { Authorization: AUTH_HEADER },
      body: {
        employeeId: testEmp.employeeCode,
        cameraId: "CAM-01",
        eventType: "IN",
        similarity: 0.91,
        eventId: "test-cam1-wrong-" + Date.now(),
      },
    });
    assert(
      cam1WrongRes.status === 400 && cam1WrongRes.data?.message?.includes("CAM-01"),
      "14. CAM-01 cannot accidentally generate IN event (rejected with 400 Bad Request)",
      JSON.stringify(cam1WrongRes.data)
    );

    // 15. CAM-02 Directional Enforcement: Reject OUT event
    const cam2WrongRes = await apiRequest({
      method: "POST",
      path: "/api/attendance",
      headers: { Authorization: AUTH_HEADER },
      body: {
        employeeId: testEmp.employeeCode,
        cameraId: "CAM-02",
        eventType: "OUT",
        similarity: 0.91,
        eventId: "test-cam2-wrong-" + Date.now(),
      },
    });
    assert(
      cam2WrongRes.status === 400 && cam2WrongRes.data?.message?.includes("CAM-02"),
      "15. CAM-02 cannot accidentally generate OUT event (rejected with 400 Bad Request)",
      JSON.stringify(cam2WrongRes.data)
    );

    // 16. Inactive Employee Rejection
    const inactiveEmpCode = "TEST_INACTIVE_" + Date.now().toString().slice(-6);
    const inactiveEmp = await Employee.create({
      employeeCode: inactiveEmpCode,
      firstName: "Inactive",
      lastName: "User",
      status: "INACTIVE",
      shiftId: generalShift.id,
    });
    const inactiveRes = await apiRequest({
      method: "POST",
      path: "/api/attendance",
      headers: { Authorization: AUTH_HEADER },
      body: {
        employeeId: inactiveEmp.employeeCode,
        cameraId: "CAM-02",
        eventType: "IN",
        similarity: 0.95,
        eventId: "test-inactive-" + Date.now(),
      },
    });
    assert(
      inactiveRes.status === 400 && inactiveRes.data?.message?.includes("inactive"),
      "16. Inactive employee attendance punch is rejected (400 Bad Request)",
      JSON.stringify(inactiveRes.data)
    );

    // 17. Incomplete Attendance Scenario 1: Only IN event (Missing OUT)
    const incEmp1Code = "TEST_INC1_" + Date.now().toString().slice(-6);
    const incEmp1 = await Employee.create({
      employeeCode: incEmp1Code,
      firstName: "Incomplete",
      lastName: "EntryOnly",
      status: "ACTIVE",
      shiftId: generalShift.id,
    });
    const incDate = "2026-03-10";
    await apiRequest({
      method: "POST",
      path: "/api/attendance",
      headers: { Authorization: AUTH_HEADER },
      body: {
        employeeId: incEmp1.employeeCode,
        cameraId: "CAM-02",
        eventType: "IN",
        similarity: 0.88,
        eventId: "test-inc1-" + Date.now(),
        timestamp: `${incDate}T09:05:00.000Z`,
      },
    });
    const inc1Summary = await apiRequest({
      method: "GET",
      path: `/api/attendance/daily-summary/${incEmp1.employeeCode}?date=${incDate}`,
      headers: { Authorization: AUTH_HEADER },
    });
    assert(
      inc1Summary.status === 200 &&
        inc1Summary.data?.data?.firstPunchIn !== null &&
        inc1Summary.data?.data?.lastPunchOut === null &&
        inc1Summary.data?.data?.isIncomplete === true &&
        inc1Summary.data?.data?.incompleteReason?.includes("Missing exit punch"),
      "17. Incomplete Attendance (Entry only) flags isIncomplete=true and does not invent exit time",
      JSON.stringify(inc1Summary.data?.data)
    );

    // 18. Incomplete Attendance Scenario 2: Only OUT event (Missing IN)
    const incEmp2Code = "TEST_INC2_" + Date.now().toString().slice(-6);
    const incEmp2 = await Employee.create({
      employeeCode: incEmp2Code,
      firstName: "Incomplete",
      lastName: "ExitOnly",
      status: "ACTIVE",
      shiftId: generalShift.id,
    });
    await apiRequest({
      method: "POST",
      path: "/api/attendance",
      headers: { Authorization: AUTH_HEADER },
      body: {
        employeeId: incEmp2.employeeCode,
        cameraId: "CAM-01",
        eventType: "OUT",
        similarity: 0.89,
        eventId: "test-inc2-" + Date.now(),
        timestamp: `${incDate}T18:05:00.000Z`,
      },
    });
    const inc2Summary = await apiRequest({
      method: "GET",
      path: `/api/attendance/daily-summary/${incEmp2.employeeCode}?date=${incDate}`,
      headers: { Authorization: AUTH_HEADER },
    });
    assert(
      inc2Summary.status === 200 &&
        inc2Summary.data?.data?.firstPunchIn === null &&
        inc2Summary.data?.data?.lastPunchOut !== null &&
        inc2Summary.data?.data?.isIncomplete === true &&
        inc2Summary.data?.data?.incompleteReason?.includes("Missing entry punch"),
      "18. Incomplete Attendance (Exit only) flags isIncomplete=true and does not invent entry time",
      JSON.stringify(inc2Summary.data?.data)
    );

    // 19. Report Service Consistency: No fabricated timestamps
    const reportRes = await apiRequest({
      method: "GET",
      path: `/api/reports/attendance?startDate=${incDate}&endDate=${incDate}&employeeId=${incEmp1.id}`,
      headers: { Authorization: AUTH_HEADER },
    });
    const reportItem = reportRes.data?.data?.[0];
    assert(
      reportRes.status === 200 &&
        reportItem &&
        reportItem.firstPunch !== null &&
        reportItem.lastPunch === null &&
        reportItem.isIncomplete === true,
      "19. Reports API agrees with PostgreSQL records and does not invent exit timestamps",
      JSON.stringify(reportItem)
    );

    // 20. Out-of-order Delivery: OUT punch arrives at Node.js backend BEFORE IN punch
    console.log("\nTesting out-of-order punch delivery (CAM-01 OUT arrives before CAM-02 IN)...");
    const oooEmpCode = "TEST_OOO_" + Date.now().toString().slice(-6);
    const oooEmp = await Employee.create({
      employeeCode: oooEmpCode,
      firstName: "OutOf",
      lastName: "Order",
      status: "ACTIVE",
      shiftId: generalShift.id,
    });

    const oooTestDate = "2026-10-14";
    const inTimeDate = new Date(`${oooTestDate}T09:05:00+05:30`);
    const outTimeDate = new Date(`${oooTestDate}T18:10:00+05:30`);

    // Step 1: Send OUT event FIRST
    const earlyOutRes = await apiRequest({
      method: "POST",
      path: "/api/attendance",
      headers: { Authorization: AUTH_HEADER },
      body: {
        employeeId: oooEmp.employeeCode,
        cameraId: "CAM-01",
        eventType: "OUT",
        similarity: 0.91,
        eventId: "test-ooo-out-" + Date.now(),
        timestamp: outTimeDate.toISOString(),
      },
    });

    assert(
      earlyOutRes.status === 201 && earlyOutRes.data?.data?.eventType === "OUT",
      "20a. CAM-01 OUT event arriving before IN is accepted and persisted without error"
    );

    // Step 2: Send IN event SECOND (delayed arrival)
    const delayedInRes = await apiRequest({
      method: "POST",
      path: "/api/attendance",
      headers: { Authorization: AUTH_HEADER },
      body: {
        employeeId: oooEmp.employeeCode,
        cameraId: "CAM-02",
        eventType: "IN",
        similarity: 0.93,
        eventId: "test-ooo-in-" + Date.now(),
        timestamp: inTimeDate.toISOString(),
      },
    });

    assert(
      delayedInRes.status === 201 && delayedInRes.data?.data?.eventType === "IN",
      "20b. Delayed CAM-02 IN event is accepted and persisted with original capture timestamp"
    );

    // Step 3: Verify daily summary reconciles them chronologically using actual timestamps
    const oooSummary = await apiRequest({
      method: "GET",
      path: `/api/attendance/daily-summary/${oooEmp.employeeCode}?date=${oooTestDate}`,
      headers: { Authorization: AUTH_HEADER },
    });

    assert(
      oooSummary.status === 200 &&
        new Date(oooSummary.data?.data?.firstPunchIn).getTime() === inTimeDate.getTime() &&
        new Date(oooSummary.data?.data?.lastPunchOut).getTime() === outTimeDate.getTime() &&
        oooSummary.data?.data?.totalDurationMinutes > 500 &&
        oooSummary.data?.data?.isIncomplete === false,
      "20c. Out-of-order punches reconciled chronologically (firstPunchIn=09:05, lastPunchOut=18:10, not incomplete)",
      JSON.stringify(oooSummary.data?.data)
    );

    // 21. Multi-Punch Re-Entry Support (IN -> OUT -> IN -> OUT)
    console.log("\nTesting multi-punch valid re-entry (morning + afternoon intervals)...");
    const reEntryEmpCode = "TEST_RE_" + Date.now().toString().slice(-6);
    const reEntryEmp = await Employee.create({
      employeeCode: reEntryEmpCode,
      firstName: "Re",
      lastName: "Entry",
      status: "ACTIVE",
      shiftId: generalShift.id,
    });

    const reDate = "2026-10-13";
    const p1In = new Date(`${reDate}T09:00:00+05:30`);
    const p1Out = new Date(`${reDate}T12:30:00+05:30`); // 3.5 hrs = 210 mins
    const p2In = new Date(`${reDate}T13:30:00+05:30`);
    const p2Out = new Date(`${reDate}T18:00:00+05:30`); // 4.5 hrs = 270 mins

    for (const [evtType, camId, tVal] of [
      ["IN", "CAM-02", p1In],
      ["OUT", "CAM-01", p1Out],
      ["IN", "CAM-02", p2In],
      ["OUT", "CAM-01", p2Out],
    ]) {
      await apiRequest({
        method: "POST",
        path: "/api/attendance",
        headers: { Authorization: AUTH_HEADER },
        body: {
          employeeId: reEntryEmp.employeeCode,
          cameraId: camId,
          eventType: evtType,
          similarity: 0.90,
          eventId: `test-re-${evtType}-${tVal.getTime()}`,
          timestamp: tVal.toISOString(),
        },
      });
    }

    const reSummary = await apiRequest({
      method: "GET",
      path: `/api/attendance/daily-summary/${reEntryEmp.employeeCode}?date=${reDate}`,
      headers: { Authorization: AUTH_HEADER },
    });

    assert(
      reSummary.status === 200 &&
        reSummary.data?.data?.workingIntervals?.length === 2 &&
        reSummary.data?.data?.totalDurationMinutes === 480 && // 210 + 270 = 480
        reSummary.data?.data?.netDurationMinutes === 420, // 480 - 60 break = 420
      "21. Multi-punch re-entry correctly pairs separate intervals and calculates net duration",
      JSON.stringify(reSummary.data?.data)
    );

    // 22. Ambiguous Sequence Detection (Exit punch before Entry)
    console.log("\nTesting ambiguous punch sequence flagging...");
    const ambEmpCode = "TEST_AMB_" + Date.now().toString().slice(-6);
    const ambEmp = await Employee.create({
      employeeCode: ambEmpCode,
      firstName: "Ambiguous",
      lastName: "Sequence",
      status: "ACTIVE",
      shiftId: generalShift.id,
    });

    const ambDate = "2026-10-12";
    await apiRequest({
      method: "POST",
      path: "/api/attendance",
      headers: { Authorization: AUTH_HEADER },
      body: {
        employeeId: ambEmp.employeeCode,
        cameraId: "CAM-01",
        eventType: "OUT",
        similarity: 0.88,
        eventId: "test-amb-out-" + Date.now(),
        timestamp: new Date(`${ambDate}T09:15:00+05:30`).toISOString(),
      },
    });

    const ambSummary = await apiRequest({
      method: "GET",
      path: `/api/attendance/daily-summary/${ambEmp.employeeCode}?date=${ambDate}`,
      headers: { Authorization: AUTH_HEADER },
    });

    assert(
      ambSummary.status === 200 &&
        ambSummary.data?.data?.isAmbiguousSequence === true &&
        ambSummary.data?.data?.reconciliationNotes !== null,
      "22. Ambiguous punch sequence (exit without entry) is explicitly flagged for review",
      JSON.stringify(ambSummary.data?.data)
    );

    // 23. Night Shift Midnight Crossing
    console.log("\nTesting night shift crossing midnight boundary...");
    const [nightShift] = await Shift.findOrCreate({
      where: { name: "Night Shift Test" },
      defaults: {
        startTime: "21:00:00",
        endTime: "05:00:00",
        gracePeriod: 15,
        breakDuration: 30,
        isCrossMidnight: true,
        isActive: true,
      },
    });

    const nightEmpCode = "TEST_NIGHT_" + Date.now().toString().slice(-6);
    const nightEmp = await Employee.create({
      employeeCode: nightEmpCode,
      firstName: "Night",
      lastName: "Worker",
      status: "ACTIVE",
      shiftId: nightShift.id,
    });

    const shiftDate = "2026-10-10";
    const nightIn = new Date(`${shiftDate}T21:05:00+05:30`);
    const nightOut = new Date("2026-10-11T05:05:00+05:30"); // Next morning

    await apiRequest({
      method: "POST",
      path: "/api/attendance",
      headers: { Authorization: AUTH_HEADER },
      body: {
        employeeId: nightEmp.employeeCode,
        cameraId: "CAM-02",
        eventType: "IN",
        similarity: 0.91,
        eventId: "test-night-in-" + Date.now(),
        timestamp: nightIn.toISOString(),
      },
    });

    await apiRequest({
      method: "POST",
      path: "/api/attendance",
      headers: { Authorization: AUTH_HEADER },
      body: {
        employeeId: nightEmp.employeeCode,
        cameraId: "CAM-01",
        eventType: "OUT",
        similarity: 0.89,
        eventId: "test-night-out-" + Date.now(),
        timestamp: nightOut.toISOString(),
      },
    });

    const nightSummary = await apiRequest({
      method: "GET",
      path: `/api/attendance/daily-summary/${nightEmp.employeeCode}?date=${shiftDate}`,
      headers: { Authorization: AUTH_HEADER },
    });

    assert(
      nightSummary.status === 200 &&
        nightSummary.data?.data?.shift?.isCrossMidnight === true &&
        nightSummary.data?.data?.totalDurationMinutes === 480 && // 8 hours = 480 mins
        nightSummary.data?.data?.netDurationMinutes === 450, // 480 - 30 break = 450
      "23. Night shift spanning midnight crossing correctly calculates working duration",
      JSON.stringify(nightSummary.data?.data)
    );

    // Cleanup test records
    const allTestEmpIds = [
      testEmp.id,
      lateEmp.id,
      incEmp1.id,
      incEmp2.id,
      oooEmp.id,
      reEntryEmp.id,
      ambEmp.id,
      nightEmp.id,
    ];
    await Attendance.destroy({ where: { employeeId: allTestEmpIds } });
    await Leave.destroy({ where: { employeeId: testEmp.id } });
    await Employee.destroy({
      where: {
        id: [...allTestEmpIds, inactiveEmp.id],
      },
    });
    console.log("\nCleanup: Removed test employee records.");

  } catch (error) {
    console.error("Test execution failed with error:", error);
    failed++;
  } finally {
    console.log("\n===============================================================");
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("===============================================================");
    await sequelize.close();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
