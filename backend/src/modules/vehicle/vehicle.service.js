import {
  createVehicle as createVehicleRepository,
  findAllVehicles,
  findVehicleById,
  findVehicleByRegistrationNumber,
  updateVehicle as updateVehicleRepository,
  deleteVehicle as deleteVehicleRepository,
} from "./vehicle.repository.js";
import { getEmployeeById } from "../employee/employee.service.js";

export const createVehicle = async (data) => {
  const existingReg = await findVehicleByRegistrationNumber(data.registrationNumber);

  if (existingReg) {
    const error = new Error("Vehicle registration number already exists");
    error.statusCode = 409;
    throw error;
  }

  if (data.employeeId) {
    await getEmployeeById(data.employeeId);
  }

  return createVehicleRepository(data);
};

export const getAllVehicles = async () => {
  return findAllVehicles();
};

export const getVehicleById = async (id) => {
  const vehicle = await findVehicleById(id);

  if (!vehicle) {
    const error = new Error("Vehicle not found");
    error.statusCode = 404;
    throw error;
  }

  return vehicle;
};

export const updateVehicle = async (id, data) => {
  const vehicle = await findVehicleById(id);

  if (!vehicle) {
    const error = new Error("Vehicle not found");
    error.statusCode = 404;
    throw error;
  }

  if (data.registrationNumber && data.registrationNumber !== vehicle.registrationNumber) {
    const existingReg = await findVehicleByRegistrationNumber(data.registrationNumber);

    if (existingReg) {
      const error = new Error("Vehicle registration number already exists");
      error.statusCode = 409;
      throw error;
    }
  }

  if (data.employeeId && data.employeeId !== vehicle.employeeId) {
    await getEmployeeById(data.employeeId);
  }

  return updateVehicleRepository(vehicle, data);
};

export const deleteVehicle = async (id) => {
  const vehicle = await findVehicleById(id);

  if (!vehicle) {
    const error = new Error("Vehicle not found");
    error.statusCode = 404;
    throw error;
  }

  await deleteVehicleRepository(vehicle);

  return true;
};
