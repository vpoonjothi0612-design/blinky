import api from "./api";
import { getImageUrl } from "../config/apiConfig";

// 1. Authenticate against main backend
export const loginApi = async (email, password) => {
  const res = await api.post("/auth/login", { email, password });
  return res.data;
};

// 2. Fetch all employees
export const getEmployeesApi = async () => {
  const res = await api.get("/employees");
  return res.data?.data || [];
};

// 2b. Delete employee
export const deleteEmployeeApi = async (id) => {
  const res = await api.delete(`/employees/${id}`);
  return res.data;
};

// 2c. Update employee
export const updateEmployeeApi = async (id, data) => {
  const res = await api.put(`/employees/${id}`, data);
  return res.data;
};

// 3. Fetch attendance records
export const getAttendancesApi = async (page = 1, limit = 100) => {
  const res = await api.get(`/attendance?page=${page}&limit=${limit}`);
  return res.data?.data?.rows || res.data?.data || [];
};

// 4. Fetch unrecognized / unknown faces
export const getUnknownFacesApi = async () => {
  const res = await api.get("/face-enrollments/unknown");
  const rawList = res.data?.data || [];
  // Exclude registered employees
  return rawList.filter(
    (f) => !f.employeeId && f.status !== "ASSIGNED" && f.status !== "REGISTERED_EMPLOYEE"
  );
};

export const getVehicleEventsApi = async (params = {}) => {
  const res = await api.get("/events", { params: { type: "VEHICLE", limit: 25, ...params } });
  return res.data;
};

// 5. Fetch overall report summary
export const getReportSummaryApi = async () => {
  try {
    const res = await api.get("/reports/summary");
    return res.data?.data || null;
  } catch {
    return null;
  }
};

// 6. Camera helper
export const resolveCameraInfo = (faceOrAttendance) => {
  const photo = (faceOrAttendance?.photoUrl || "").toUpperCase();
  const camName = (faceOrAttendance?.camera?.name || faceOrAttendance?.cameraId || "").toUpperCase();

  if (camName.includes("CAM-01") || camName.includes("207") || photo.includes("CAM-01") || photo.includes("207")) {
    return {
      name: "CAM-01 (Exit Gate)",
      ip: "192.168.9.207",
      direction: "OUT",
      location: "Turnstile / Exit",
    };
  }

  return {
    name: "CAM-02 (Entrance Gate)",
    ip: "192.168.9.208",
    direction: "IN",
    location: "Main Entrance Gate",
  };
};

// 7. Compute live metrics from raw data
export const computeDashboardMetrics = (employees = [], attendances = [], unknownFaces = []) => {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];

  // Filter today's punches
  const todayPunches = attendances.filter((att) => {
    const attDate = new Date(att.timestamp || att.createdAt).toISOString().split("T")[0];
    return attDate === todayStr;
  });

  // Group by employee
  const employeePunchesMap = new Map();
  todayPunches.forEach((punch) => {
    const empId = punch.employeeId;
    if (!employeePunchesMap.has(empId)) {
      employeePunchesMap.set(empId, []);
    }
    employeePunchesMap.get(empId).push(punch);
  });

  const todayPresentCount = employeePunchesMap.size;
  let todayInCount = 0;
  let todayOutCount = 0;

  employeePunchesMap.forEach((punches) => {
    // Sort chronological
    const sorted = punches.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const latest = sorted[sorted.length - 1];
    if (latest.eventType === "IN") {
      todayInCount++;
    } else {
      todayOutCount++;
    }
  });

  // Recent activity stream (last 8 punches)
  const sortedRecent = [...attendances]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 8)
    .map((item) => {
      const emp = item.employee;
      const empName = emp ? `${emp.firstName} ${emp.lastName || ""}`.trim() : "Employee";
      const cam = resolveCameraInfo(item);
      return {
        id: item.id,
        employeeName: empName,
        employeeCode: emp?.employeeCode || "EMP",
        eventType: item.eventType || "IN",
        camera: cam.name,
        timestamp: item.timestamp,
        timeFormatted: new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
    });

  return {
    date: todayStr,
    totalEmployees: employees.length,
    todayPresentCount,
    todayAbsentCount: Math.max(0, employees.length - todayPresentCount),
    todayInCount,
    todayOutCount,
    unknownCount: unknownFaces.length,
    recentActivity: sortedRecent,
  };
};

// 8. Compute employee roster status
export const computeEmployeeRoster = (employees = [], attendances = []) => {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];

  const todayPunches = attendances.filter((att) => {
    const attDate = new Date(att.timestamp || att.createdAt).toISOString().split("T")[0];
    return attDate === todayStr;
  });

  const empMap = new Map();
  todayPunches.forEach((att) => {
    if (!empMap.has(att.employeeId)) empMap.set(att.employeeId, []);
    empMap.get(att.employeeId).push(att);
  });

  return employees.map((emp) => {
    const punches = empMap.get(emp.id) || [];
    let currentStatus = "NOT_PRESENT";
    let firstIn = null;
    let lastOut = null;
    let lastSeenCamera = null;

    if (punches.length > 0) {
      const inPunches = punches.filter((p) => p.eventType === "IN");
      const outPunches = punches.filter((p) => p.eventType === "OUT");

      if (inPunches.length > 0) {
        firstIn = new Date(inPunches[0].timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }
      if (outPunches.length > 0) {
        lastOut = new Date(outPunches[outPunches.length - 1].timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }

      const latest = punches[punches.length - 1];
      currentStatus = latest.eventType === "IN" ? "IN" : "OUT";
      lastSeenCamera = resolveCameraInfo(latest).name;
    }

    return {
      id: emp.id,
      employeeCode: emp.employeeCode,
      name: `${emp.firstName} ${emp.lastName || ""}`.trim(),
      department: emp.department || "General",
      designation: emp.designation || "Staff",
      email: emp.email || null,
      phone: emp.phone || null,
      currentStatus,
      firstIn,
      lastOut,
      lastSeenCamera,
      todayPunchesCount: punches.length,
      rawEmployee: emp,
    };
  });
};

