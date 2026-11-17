export const validateLogin = (values) => {
  const errors = {};

  const identifier = (values.email || '').trim();
  if (!identifier) {
    errors.email = 'Username or email is required';
  } else if (identifier.includes('@')) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(identifier)) {
      errors.email = 'Please enter a valid email address';
    }
  } else if (identifier.length < 2) {
    errors.email = 'Username must be at least 2 characters';
  }

  if (!values.password) {
    errors.password = 'Password is required';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};

export const validateRegister = (values) => {
  const errors = {};

  if (!values.name || !values.name.trim()) {
    errors.name = 'Name is required';
  } else if (values.name.trim().length < 2) {
    errors.name = 'Name must be at least 2 characters';
  }

  if (!values.email || !values.email.trim()) {
    errors.email = 'Email is required';
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(values.email.trim())) {
      errors.email = 'Please enter a valid email address';
    }
  }

  if (!values.password) {
    errors.password = 'Password is required';
  } else if (values.password.length < 6) {
    errors.password = 'Password must be at least 6 characters';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};
