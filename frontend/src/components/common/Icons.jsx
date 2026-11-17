import React from 'react';

export const IconBase = ({ d, viewBox = '0 0 24 24', fill = 'none' }) => (
  <svg viewBox={viewBox} fill={fill} stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="w-full h-full">
    {typeof d === 'string' ? <path d={d} /> : d}
  </svg>
);

export const Icons = {
  dashboard: (
    <IconBase d={
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    } />
  ),
  employees: (
    <IconBase d={
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    } />
  ),
  face: (
    <IconBase d={
      <>
        {/* Biometric face scan bounds */}
        <path d="M5 8V6a2 2 0 0 1 2-2h2" />
        <path d="M15 4h2a2 2 0 0 1 2 2v2" />
        <path d="M5 16v2a2 2 0 0 0 2 2h2" />
        <path d="M15 20h2a2 2 0 0 0 2-2v-2" />
        {/* Inner scan grid/face placeholder */}
        <path d="M9 10h.01" />
        <path d="M15 10h.01" />
        <path d="M12 14c-1.5 0-2.5-.5-2.5-.5" />
      </>
    } />
  ),
  camera: (
    <IconBase d={
      <>
        <path d="M23 7l-7 5 7 5V7z" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </>
    } />
  ),
  vehicle: (
    <IconBase d={
      <>
        <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v9a2 2 0 0 1-2 2h-3" />
        <circle cx="7.5" cy="17.5" r="2.5" />
        <circle cx="17.5" cy="17.5" r="2.5" />
      </>
    } />
  ),
  attendance: (
    <IconBase d={
      <>
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </>
    } />
  ),
  shifts: (
    <IconBase d={
      <>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </>
    } />
  ),
  workHours: (
    <IconBase d={
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </>
    } />
  ),
  reports: (
    <IconBase d={
      <>
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
        <path d="M2 20h20" />
      </>
    } />
  ),
  ai: (
    <IconBase d={
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    } />
  ),
  logout: (
    <IconBase d={
      <>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </>
    } />
  ),
  shieldAlert: (
    <IconBase d={
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </>
    } />
  ),
  shieldCheck: (
    <IconBase d={
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </>
    } />
  ),
  bell: (
    <IconBase d={
      <>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </>
    } />
  ),
  search: (
    <IconBase d={
      <>
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </>
    } />
  ),
  settings: (
    <IconBase d={
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>
    } />
  ),
  logo: (
    <IconBase d={
      <>
        {/* Modern Biometric Frame & Sensor */}
        <path d="M4 8V6a2 2 0 0 1 2-2h2" />
        <path d="M16 4h2a2 2 0 0 1 2 2v2" />
        <path d="M4 16v2a2 2 0 0 0 2 2h2" />
        <path d="M16 20h2a2 2 0 0 0 2-2v-2" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 9v1" />
        <path d="M12 14v1" />
      </>
    } />
  ),
};
