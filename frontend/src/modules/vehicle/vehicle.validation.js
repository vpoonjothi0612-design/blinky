export const validateVehicle = (values) => {
  const errors = {};

  if (!values.registrationNumber || !values.registrationNumber.trim()) {
    errors.registrationNumber = 'Registration number is required';
  }

  if (values.status && !['ACTIVE', 'INACTIVE'].includes(values.status)) {
    errors.status = 'Status must be ACTIVE or INACTIVE';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};
