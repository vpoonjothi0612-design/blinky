import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { getBackendBaseUrl } from '../../services/api';

const getMediaKey = (value) => {
  if (!value) return null;
  const match = String(value).match(/\/api\/media\/([^/?#]+)/);
  return match ? match[1] : String(value).replace(/^\/+/, '');
};

const getEmployeeImageRoute = (value) => {
  const match = String(value || '').match(/(?:https?:\/\/[^/]+)?(\/employee-images\/[^?#]+)/);
  return match?.[1] || null;
};

export default function AuthenticatedMediaImage({ mediaKey, alt = '', className, style, fallback = null, onClick, onLoad, onError, title }) {
  const directUrl = typeof mediaKey === 'string' && (/^https?:\/\//i.test(mediaKey) || mediaKey.startsWith('data:')) ? mediaKey : null;
  const employeeRoute = getEmployeeImageRoute(mediaKey);
  const key = getMediaKey(mediaKey);
  const [objectUrl, setObjectUrl] = useState(null);
  const [failedKey, setFailedKey] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let currentUrl = null;
    setObjectUrl(null);
    if ((!key && !employeeRoute) || directUrl) {
      setFailedKey(null);
      return undefined;
    }
    const request = employeeRoute
      ? api.get(`${getBackendBaseUrl()}${employeeRoute}`, { responseType: 'blob' })
      : api.get(`/media/${encodeURIComponent(key)}`, { responseType: 'blob' });
    request
      .then(({ data }) => {
        if (cancelled) return;
        currentUrl = URL.createObjectURL(data);
        setObjectUrl(currentUrl);
        setFailedKey(null);
      })
      .catch(() => {
        if (!cancelled) setFailedKey(key);
      });
    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [key, directUrl, employeeRoute]);

  if (directUrl) return <img src={directUrl} alt={alt} className={className} style={style} onClick={onClick} onLoad={onLoad} onError={onError} title={title} />;

  if (!key || failedKey === key || !objectUrl) return fallback;
  return <img src={objectUrl} alt={alt} className={className} style={style} onClick={onClick} onLoad={onLoad} onError={onError} title={title} />;
}
