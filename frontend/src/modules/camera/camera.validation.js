export const validateCamera = (values) => {
  const errors = {};

  if (!values.name || !values.name.trim()) {
    errors.name = 'Camera name is required';
  }

  if (values.status && !['ACTIVE', 'INACTIVE'].includes(values.status)) {
    errors.status = 'Status must be ACTIVE or INACTIVE';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};
