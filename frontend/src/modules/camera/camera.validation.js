export const validateCamera = (values) => {
  const errors = {};

  if (!values.name || !values.name.trim()) {
    errors.name = 'Camera name is required';
  }

  if (values.status && !['ACTIVE', 'INACTIVE'].includes(values.status)) {
    errors.status = 'Status must be ACTIVE or INACTIVE';
  }

  if (values.rtspUrl) {
    try {
      const url = new URL(values.rtspUrl);
      if (url.username || url.password) {
        errors.rtspUrl = 'Store camera credentials in the AI service environment, not the RTSP URL.';
      }
    } catch {
      if (/^rtsps?:\/\/[^/]*@/i.test(values.rtspUrl)) {
        errors.rtspUrl = 'Store camera credentials in the AI service environment, not the RTSP URL.';
      }
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};
