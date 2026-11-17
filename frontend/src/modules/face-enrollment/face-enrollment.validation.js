export const validateEnrollment = (values) => {
  const errors = {};

  if (!values.employeeId || !values.employeeId.trim()) {
    errors.employeeId = 'Please select an employee';
  }

  const photos = values.images?.photos || [];
  if (photos.length < 3 || photos.length > 5) {
    errors.photos = 'Select 3 to 5 photos. The first photo must be a frontal view.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};
