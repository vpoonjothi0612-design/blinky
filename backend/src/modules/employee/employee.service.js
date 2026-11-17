import {
  createEmployee as createEmployeeRepository,
  findAllEmployees,
  findEmployeeById,
  findEmployeeByCode,
  findEmployeeByEmail,
  updateEmployee as updateEmployeeRepository,
  deleteEmployee as deleteEmployeeRepository,
  bulkDeleteEmployees as bulkDeleteEmployeesRepository,
} from "./employee.repository.js";

export const generateNextEmployeeCode = async () => {
  const employees = await findAllEmployees();

  let maxNum = 0;
  for (const emp of employees) {
    const code = emp.employeeCode || "";
    const match = code.match(/^EMP[-_]?(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  let nextNum = maxNum + 1;
  let candidateCode = `EMP${String(nextNum).padStart(3, "0")}`;

  while (await findEmployeeByCode(candidateCode)) {
    nextNum += 1;
    candidateCode = `EMP${String(nextNum).padStart(3, "0")}`;
  }

  return candidateCode;
};

export const createEmployee = async (data) => {
  if (data.joiningDate === "" || data.joiningDate === "Invalid date" || !data.joiningDate) {
    data.joiningDate = null;
  }
  if (data.email === "" || !data.email) {
    data.email = null;
  }
  if (data.phone === "") data.phone = null;
  if (data.department === "") data.department = null;
  if (data.designation === "") data.designation = null;
  if (data.lastName === "") data.lastName = null;

  if (!data.employeeCode || !String(data.employeeCode).trim()) {
    data.employeeCode = await generateNextEmployeeCode();
  } else {
    data.employeeCode = String(data.employeeCode).trim();
  }

  const existingCode = await findEmployeeByCode(data.employeeCode);

  if (existingCode) {
    const error = new Error("Employee code already exists");
    error.status = 409;
    error.statusCode = 409;
    throw error;
  }

  if (data.email) {
    const existingEmail = await findEmployeeByEmail(data.email);

    if (existingEmail) {
      const error = new Error("Employee email already exists");
      error.status = 409;
      error.statusCode = 409;
      throw error;
    }
  }

  if (data.email) {
    data.email = data.email.toLowerCase();
  }

  return createEmployeeRepository(data);
};

export const getAllEmployees = async () => {
  return findAllEmployees();
};

export const getEmployeeById = async (id) => {
  const employee = await findEmployeeById(id);

  if (!employee) {
    const error = new Error("Employee not found");
    error.statusCode = 404;
    throw error;
  }

  return employee;
};

export const getEmployeeByCode = async (employeeCode) => {
  const employee = await findEmployeeByCode(employeeCode);

  if (!employee) {
    const error = new Error("Employee not found");
    error.statusCode = 404;
    throw error;
  }

  return employee;
};

export const updateEmployee = async (id, data) => {
  if (data.joiningDate === "" || data.joiningDate === "Invalid date" || !data.joiningDate) {
    data.joiningDate = null;
  }
  if (data.email === "" || !data.email) {
    data.email = null;
  }
  if (data.phone === "") data.phone = null;
  if (data.department === "") data.department = null;
  if (data.designation === "") data.designation = null;
  if (data.lastName === "") data.lastName = null;

  const employee = await findEmployeeById(id);

  if (!employee) {
    const error = new Error("Employee not found");
    error.status = 404;
    error.statusCode = 404;
    throw error;
  }

  if (
    data.employeeCode &&
    data.employeeCode !== employee.employeeCode
  ) {
    const existingCode = await findEmployeeByCode(data.employeeCode);

    if (existingCode) {
      const error = new Error("Employee code already exists");
      error.status = 409;
      error.statusCode = 409;
      throw error;
    }
  }

  if (data.email) {
    data.email = data.email.toLowerCase();

    const existingEmail = await findEmployeeByEmail(data.email);

    if (existingEmail && existingEmail.id !== employee.id) {
      const error = new Error("Employee email already exists");
      error.status = 409;
      error.statusCode = 409;
      throw error;
    }
  }

  return updateEmployeeRepository(employee, data);
};

export const deleteEmployee = async (id) => {
  const employee = await findEmployeeById(id);

  if (!employee) {
    const error = new Error("Employee not found");
    error.statusCode = 404;
    throw error;
  }

  // Safely clean up child references
  try {
    const Attendance = (await import("../attendance/attendance.model.js")).default;
    await Attendance.destroy({ where: { employeeId: id } });
  } catch (e) {
    // ignore
  }

  try {
    const FaceEnrollment = (await import("../face-enrollment/face-enrollment.model.js")).default;
    await FaceEnrollment.destroy({ where: { employeeId: id } });
  } catch (e) {
    // ignore
  }

  await deleteEmployeeRepository(employee);

  return true;
};

export const bulkDeleteEmployees = async (ids) => {
  if (!Array.isArray(ids) || ids.length === 0) {
    return 0;
  }

  // Safely clean up child references
  try {
    const Attendance = (await import("../attendance/attendance.model.js")).default;
    await Attendance.destroy({ where: { employeeId: ids } });
  } catch (e) {
    // ignore
  }

  try {
    const FaceEnrollment = (await import("../face-enrollment/face-enrollment.model.js")).default;
    await FaceEnrollment.destroy({ where: { employeeId: ids } });
  } catch (e) {
    // ignore
  }

  return bulkDeleteEmployeesRepository(ids);
};