import { resolveStaffEmployee } from "../attendance/attendance.controller.js";
import {
  createEmployee,
  generateNextEmployeeCode,
  getAllEmployees,
  getEmployeeById,
  getEmployeeByCode,
  updateEmployee,
  deleteEmployee,
  bulkDeleteEmployees,
} from "./employee.service.js";

export const getNextCode = async (req, res, next) => {
  try {
    const nextCode = await generateNextEmployeeCode();

    return res.status(200).json({
      success: true,
      message: "Next employee code generated successfully",
      data: {
        employeeCode: nextCode,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const create = async (req, res, next) => {
  try {
    const employee = await createEmployee(req.body);

    return res.status(201).json({
      success: true,
      message: "Employee created successfully",
      data: employee,
    });
  } catch (error) {
    next(error);
  }
};

export const getAll = async (req, res, next) => {
  try {
    if (req.user?.role === "STAFF") {
      const emp = await resolveStaffEmployee(req.user);
      if (!emp) {
        return res.status(200).json({
          success: true,
          message: "Staff profile retrieved",
          data: [
            {
              id: req.user.id,
              employeeCode: "STAFF",
              firstName: req.user.name || "Staff",
              lastName: "",
              email: req.user.email,
              department: "General",
              designation: "Staff Member",
              isActive: true,
            },
          ],
        });
      }

      return res.status(200).json({
        success: true,
        message: "Staff profile retrieved successfully",
        data: [emp],
      });
    }

    const employees = await getAllEmployees();

    return res.status(200).json({
      success: true,
      message: "Employees retrieved successfully",
      data: employees,
    });
  } catch (error) {
    next(error);
  }
};

export const getById = async (req, res, next) => {
  try {
    const employee = await getEmployeeById(req.params.id);

    return res.status(200).json({
      success: true,
      message: "Employee retrieved successfully",
      data: employee,
    });
  } catch (error) {
    next(error);
  }
};

export const getByCode = async (req, res, next) => {
  try {
    const employee = await getEmployeeByCode(
      req.params.employeeCode
    );

    return res.status(200).json({
      success: true,
      message: "Employee retrieved successfully",
      data: employee,
    });
  } catch (error) {
    next(error);
  }
};

export const update = async (req, res, next) => {
  try {
    const employee = await updateEmployee(
      req.params.id,
      req.body
    );

    return res.status(200).json({
      success: true,
      message: "Employee updated successfully",
      data: employee,
    });
  } catch (error) {
    next(error);
  }
};

export const remove = async (req, res, next) => {
  try {
    await deleteEmployee(req.params.id);

    return res.status(200).json({
      success: true,
      message: "Employee deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const bulkDelete = async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Array of employee ids is required for bulk delete.",
      });
    }

    const count = await bulkDeleteEmployees(ids);

    return res.status(200).json({
      success: true,
      message: `${count} employee(s) deleted successfully`,
      data: { count },
    });
  } catch (error) {
    next(error);
  }
};