import api from './api';
import { getBackendBaseUrl } from './api';

const encodeBase64Url = (value) => {
  const bytes = new TextEncoder().encode(String(value));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const mediaUrlForLegacyPath = (value) => {
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || String(value).startsWith('data:')) return value;
  const match = String(value).match(/\/api\/media\/([^/?#]+)/);
  if (match) return `/api/media/${match[1]}`;
  const path = String(value).replace(/^\/+/, '')
    .replace(/^captured-images\//, 'captures/')
    .replace(/^unknown-images\//, 'unknown/')
    .replace(/^vehicle-images\//, 'vehicle/')
    .replace(/^animal-images\//, 'animal/')
    .replace(/^snapshot-images\//, 'snapshots/')
    .replace(/^enrollment-images\//, 'enrollment/');
  return `/api/media/${encodeBase64Url(path.includes('/') ? path : `captures/${path}`)}`;
};

export const openAuthenticatedMediaInNewTab = async (mediaKey) => {
  if (!mediaKey) return false;
  const tab = window.open('about:blank', '_blank');
  if (!tab) return false;
  try {
    const value = String(mediaKey);
    const employeeRoute = value.match(/(?:https?:\/\/[^/]+)?(\/employee-images\/[^?#]+)/)?.[1];
    const key = value.match(/\/api\/media\/([^/?#]+)/)?.[1] || value.replace(/^\/+/, '');
    const requestUrl = employeeRoute
      ? `${getBackendBaseUrl()}${employeeRoute}`
      : `/media/${encodeURIComponent(key)}`;
    const { data } = await api.get(requestUrl, { responseType: 'blob' });
    const objectUrl = URL.createObjectURL(data);
    tab.opener = null;
    tab.location.href = objectUrl;
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return true;
  } catch {
    tab.close();
    return false;
  }
};
