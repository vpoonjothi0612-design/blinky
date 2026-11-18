import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import api, { getBackendBaseUrl } from '../../services/api';
import { mediaUrlForLegacyPath } from '../../services/media.service';
import { getAttendanceByEmployee, searchEmployeeByPhoto } from './attendance.service';
import { getEmployees } from '../employee/employee.service';
import './PhotoLog.css';

const PAGE_SIZE = 100;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const employeeName = (employee) =>
  [employee?.firstName, employee?.lastName].filter(Boolean).join(' ') || 'Employee';

const errorMessage = (error) =>
  error?.response?.data?.message ||
  error?.response?.data?.error?.message ||
  error?.message ||
  'Unable to load the photo log. Please try again.';

const formatTimestamp = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleString();
};

const getPhotoSource = (record) => record?.capturedImage || null;

const getPhotoRequestUrl = (value) => {
  if (!value) return null;
  const source = String(value).trim();
  if (/^data:/i.test(source)) return source;

  const employeeRoute = source.match(/(?:https?:\/\/[^/]+)?(\/employee-images\/[^?#]+)/i);
  if (employeeRoute) return `${getBackendBaseUrl()}${employeeRoute[1]}`;
  if (/^https?:\/\//i.test(source)) return source;
  const mediaUrl = mediaUrlForLegacyPath(source);
  const mediaKey = mediaUrl?.match(/^\/api\/media\/([^/?#]+)/)?.[1];
  return mediaKey ? `/media/${mediaKey}` : mediaUrl;
};

const fetchPhotoBlob = async (url) => {
  const targetOrigin = new URL(url, window.location.origin).origin;
  const backendOrigin = new URL(getBackendBaseUrl()).origin;
  const isTrustedOrigin = String(url).startsWith('/media/') ||
    targetOrigin === backendOrigin ||
    targetOrigin === window.location.origin;

  if (isTrustedOrigin) {
    const { data } = await api.get(url, { responseType: 'blob', timeout: 30000 });
    return data;
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Photo request failed with status ${response.status}`);
  return response.blob();
};

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error || new Error('Unable to prepare image for PDF.'));
  reader.readAsDataURL(blob);
});

const loadPhotoForPdf = async (source) => {
  if (!source) return null;
  if (/^data:image\/(jpeg|png);/i.test(String(source))) {
    return {
      data: source,
      format: /^data:image\/png/i.test(String(source)) ? 'PNG' : 'JPEG',
    };
  }

  const url = getPhotoRequestUrl(source);
  if (!url) return null;
  const blob = await fetchPhotoBlob(url);
  if (!['image/jpeg', 'image/png'].includes(String(blob?.type || '').toLowerCase())) {
    throw new Error('The saved attendance photo is not a supported JPEG or PNG image.');
  }
  return {
    data: await blobToDataUrl(blob),
    format: blob.type.includes('png') ? 'PNG' : 'JPEG',
  };
};

const PhotoLogImage = ({ source, alt, className }) => {
  const [imageUrl, setImageUrl] = useState('');
  const [status, setStatus] = useState(source ? 'loading' : 'missing');

  useEffect(() => {
    let active = true;
    let objectUrl = null;
    setImageUrl('');

    if (!source) {
      setStatus('missing');
      return undefined;
    }

    if (/^data:/i.test(String(source)) || (
      /^https?:\/\//i.test(String(source)) &&
      !/(?:https?:\/\/[^/]+)?\/employee-images\//i.test(String(source))
    )) {
      setImageUrl(source);
      setStatus('loaded');
      return undefined;
    }

    setStatus('loading');
    const url = getPhotoRequestUrl(source);
    if (!url) {
      setStatus('missing');
      return undefined;
    }

    fetchPhotoBlob(url)
      .then((data) => {
        if (!data?.type?.startsWith('image/')) throw new Error('Invalid image response');
        if (!active) return;
        objectUrl = URL.createObjectURL(data);
        setImageUrl(objectUrl);
        setStatus('loaded');
      })
      .catch(() => {
        if (active) setStatus('missing');
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source]);

  if (status === 'loading') {
    return <span className="photo-log-image-state">Loading...</span>;
  }
  if (status !== 'loaded' || !imageUrl) {
    return <span className="photo-log-image-state unavailable">No image</span>;
  }
  return <img src={imageUrl} alt={alt} className={className} />;
};

const PhotoLog = () => {
  const [employees, setEmployees] = useState([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [showMatches, setShowMatches] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [records, setRecords] = useState([]);
  const [recordCount, setRecordCount] = useState(0);
  const [page, setPage] = useState(1);
  const [eventFilter, setEventFilter] = useState('');
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [searchingImage, setSearchingImage] = useState(false);
  const [exporting, setExporting] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getEmployees()
      .then((response) => {
        if (active) {
          const employeeRows = response?.data;
          setEmployees(Array.isArray(employeeRows) ? employeeRows : []);
        }
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (active) setEmployeesLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!imageFile) {
      setImagePreview('');
      return undefined;
    }

    const objectUrl = URL.createObjectURL(imageFile);
    setImagePreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [imageFile]);

  useEffect(() => {
    if (!selectedEmployee?.id) {
      setRecords([]);
      setRecordCount(0);
      setLoadingRecords(false);
      return undefined;
    }

    let active = true;
    setLoadingRecords(true);
    setError('');
    const filters = eventFilter ? { eventType: eventFilter } : {};

    getAttendanceByEmployee(selectedEmployee.id, page, PAGE_SIZE, filters)
      .then((response) => {
        if (!active) return;
        const attendance = response?.data || {};
        setRecords(Array.isArray(attendance.rows) ? attendance.rows : []);
        setRecordCount(Number(attendance.count) || 0);
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (active) setLoadingRecords(false);
      });

    return () => {
      active = false;
    };
  }, [selectedEmployee?.id, page, eventFilter]);

  const matches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery || selectedEmployee) return [];

    return employees
      .filter((employee) => {
        const searchable = [
          employee.employeeCode,
          employee.firstName,
          employee.lastName,
          employeeName(employee),
          employee.department,
        ].filter(Boolean).join(' ').toLowerCase();
        return searchable.includes(normalizedQuery);
      })
      .slice(0, 10);
  }, [employees, query, selectedEmployee]);

  const pageCount = Math.max(1, Math.ceil(recordCount / PAGE_SIZE));

  const chooseEmployee = (employee) => {
    setSelectedEmployee(employee);
    setProfilePhoto(null);
    setQuery(`${employeeName(employee)} (${employee.employeeCode || 'no code'})`);
    setShowMatches(false);
    setPage(1);
    setEventFilter('');
    setNotice('');
    setError('');
  };

  const handleImageSearch = async () => {
    if (!imageFile) {
      setError('Choose a JPG or PNG image first.');
      return;
    }

    setSearchingImage(true);
    setError('');
    setNotice('');
    try {
      const response = await searchEmployeeByPhoto(imageFile);
      const result = response?.data;
      if (!result?.matched || !result.employee) {
        setSelectedEmployee(null);
        setQuery('');
        setNotice(result?.message || 'No confident employee match was found.');
        return;
      }

      chooseEmployee(result.employee);
      setNotice(`Verified employee match: ${employeeName(result.employee)}.`);
    } catch (searchError) {
      setError(errorMessage(searchError));
    } finally {
      setSearchingImage(false);
    }
  };

  const handleImageChange = (event) => {
    const file = event.target.files?.[0] || null;
    setError('');
    setNotice('');
    if (!file) {
      setImageFile(null);
      return;
    }
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setImageFile(null);
      setError('Upload a JPG or PNG image.');
      event.target.value = '';
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageFile(null);
      setError('Image must be 10 MB or smaller.');
      event.target.value = '';
      return;
    }
    setImageFile(file);
  };

  const loadAllRecords = async () => {
    const allRecords = [];
    let exportPage = 1;
    let total = recordCount;
    const filters = eventFilter ? { eventType: eventFilter } : {};

    while (true) {
      const response = await getAttendanceByEmployee(selectedEmployee.id, exportPage, PAGE_SIZE, filters);
      const attendance = response?.data || {};
      const rows = Array.isArray(attendance.rows) ? attendance.rows : [];
      total = Number(attendance.count) || total;
      allRecords.push(...rows);

      if (rows.length === 0 || allRecords.length >= total || rows.length < PAGE_SIZE) break;
      exportPage += 1;
    }

    if (allRecords.length === 0) throw new Error('There are no photo-log records to download.');
    return allRecords;
  };

  const handleDownloadExcel = async () => {
    if (!selectedEmployee) return;
    setExporting('excel');
    setError('');
    setNotice('');
    try {
      const allRecords = await loadAllRecords();
      const exportRows = allRecords.map((record) => ({
        'Employee Name': employeeName(selectedEmployee),
        'Employee Code': selectedEmployee.employeeCode || '',
        Department: selectedEmployee.department || '',
        Direction: record.eventType === 'IN' ? 'ENTRY' : record.eventType === 'OUT' ? 'EXIT' : record.eventType || '',
        'Date and Time': record.timestamp ? new Date(record.timestamp).toISOString() : '',
        Camera: record.camera?.name || record.cameraId || '',
        Status: record.status || '',
        Source: record.source || '',
        Similarity: record.similarity ?? '',
        'Photo Type': record.capturedImage ? 'Camera-detected face' : 'Camera image unavailable',
        'Photo Path': record.capturedImage || '',
      }));
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(exportRows);
      worksheet['!cols'] = [
        { wch: 24 }, { wch: 18 }, { wch: 20 }, { wch: 12 }, { wch: 26 },
        { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 22 }, { wch: 55 },
      ];
      worksheet['!autofilter'] = { ref: `A1:K${exportRows.length + 1}` };
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Photo Log');
      const safeCode = String(selectedEmployee.employeeCode || 'employee').replace(/[^a-z0-9_-]/gi, '_');
      XLSX.writeFile(workbook, `Photo_Log_${safeCode}.xlsx`);
      setNotice('Excel report downloaded. The Photo Path column references each saved image.');
    } catch (downloadError) {
      setError(errorMessage(downloadError));
    } finally {
      setExporting('');
    }
  };

  const handleDownloadPdf = async () => {
    if (!selectedEmployee) return;
    setExporting('pdf');
    setError('');
    setNotice('');
    try {
      const allRecords = await loadAllRecords();
      const photos = [];

      for (let index = 0; index < allRecords.length; index += 8) {
        const batch = allRecords.slice(index, index + 8);
        const loadedBatch = await Promise.all(batch.map(async (record) => {
          try {
            return await loadPhotoForPdf(getPhotoSource(record));
          } catch {
            return null;
          }
        }));
        photos.push(...loadedBatch);
      }

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(15, 23, 42);
      doc.text('Employee Photo Log', 14, 17);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(
        `${employeeName(selectedEmployee)} | ${selectedEmployee.employeeCode || 'No code'} | ${selectedEmployee.department || 'No department'}`,
        14,
        24
      );
      doc.text(`Generated ${new Date().toLocaleString()} | ${allRecords.length} attendance records`, 14, 30);

      autoTable(doc, {
        startY: 36,
        head: [['Photo', 'Photo type', 'Direction', 'Date and time', 'Camera', 'Status', 'Source', 'Similarity']],
        body: allRecords.map((record, index) => [
          photos[index] ? '' : 'No photo',
          record.capturedImage ? 'Camera-detected face' : 'Camera image unavailable',
          record.eventType === 'IN' ? 'ENTRY' : record.eventType === 'OUT' ? 'EXIT' : record.eventType || 'N/A',
          formatTimestamp(record.timestamp),
          record.camera?.name || record.cameraId || 'Not recorded',
          record.status || 'N/A',
          record.source || 'N/A',
          record.similarity ?? 'N/A',
        ]),
        theme: 'grid',
        margin: { left: 14, right: 14, bottom: 14 },
        styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.5, textColor: [30, 41, 59], minCellHeight: 19, valign: 'middle' },
        headStyles: { fillColor: [15, 118, 94], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 249, 248] },
        columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 30 }, 2: { cellWidth: 20 }, 3: { cellWidth: 39 }, 4: { cellWidth: 32 }, 5: { cellWidth: 22 }, 6: { cellWidth: 25 }, 7: { cellWidth: 22 } },
        didDrawCell: (cell) => {
          if (cell.section !== 'body' || cell.column.index !== 0) return;
          const photo = photos[cell.row.index];
          if (!photo) return;
          doc.addImage(photo.data, photo.format, cell.cell.x + 3, cell.cell.y + 2, 14, 14);
        },
      });

      const pageCount = doc.internal.getNumberOfPages();
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        doc.setPage(pageNumber);
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(`Page ${pageNumber} of ${pageCount}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 6, { align: 'right' });
      }

      const safeCode = String(selectedEmployee.employeeCode || 'employee').replace(/[^a-z0-9_-]/gi, '_');
      doc.save(`Photo_Log_${safeCode}.pdf`);
      const missingPhotos = photos.filter((photo) => !photo).length;
      setNotice(missingPhotos
        ? `PDF downloaded. ${missingPhotos} of ${allRecords.length} records did not have an accessible photo.`
        : 'PDF report downloaded with attendance photos.');
    } catch (downloadError) {
      setError(errorMessage(downloadError));
    } finally {
      setExporting('');
    }
  };

  const latestCameraImage = records.find((record) => record.capturedImage)?.capturedImage;

  return (
    <main className="photo-log-page page-container">
      <header className="photo-log-header">
        <div>
          <p className="photo-log-eyebrow">ATTENDANCE MANAGEMENT</p>
          <h1>Employee Photo Log</h1>
          <p>Search employee attendance, review entry and exit photos, and export a complete record.</p>
        </div>
        <span className="photo-log-security-label">ADMIN / SECURITY</span>
      </header>

      <section className="photo-log-search-grid" aria-label="Find an employee">
        <div className="photo-log-card">
          <div className="photo-log-card-heading">
            <span className="photo-log-card-step">01</span>
            <div>
              <h2>Find an employee</h2>
              <p>Search by name, employee code, or department.</p>
            </div>
          </div>
          <label htmlFor="photo-log-query">Name, employee code, or department</label>
          <input
            id="photo-log-query"
            type="search"
            value={query}
            placeholder="Start typing to find an employee"
            onFocus={() => setShowMatches(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedEmployee(null);
              setShowMatches(true);
              setPage(1);
              setError('');
              setNotice('');
            }}
          />
          {showMatches && query.trim() && !selectedEmployee && (
            <div className="photo-log-match-list" role="listbox" aria-label="Matching employees">
              {employeesLoading ? (
                <p className="photo-log-empty">Loading employees...</p>
              ) : matches.length ? matches.map((employee) => (
                <button
                  type="button"
                  className="photo-log-match"
                  key={employee.id}
                  onClick={() => chooseEmployee(employee)}
                >
                  <span>{employeeName(employee)}</span>
                  <small>{employee.employeeCode || 'No code'} | {employee.department || 'No department'}</small>
                </button>
              )) : (
                <p className="photo-log-empty">No matching employees found.</p>
              )}
            </div>
          )}
        </div>

        <div className="photo-log-card">
          <div className="photo-log-card-heading">
            <span className="photo-log-card-step">02</span>
            <div>
              <h2>Search with a photo</h2>
              <p>One clear face is required. Uncertain matches are not selected.</p>
            </div>
          </div>
          <div className="photo-log-upload-row">
            <input
              aria-label="Choose a face photo"
              type="file"
              accept=".jpg,.jpeg,.png,image/jpeg,image/png"
              onChange={handleImageChange}
            />
            <button type="button" className="photo-log-button photo-log-button-secondary" onClick={handleImageSearch} disabled={!imageFile || searchingImage}>
              {searchingImage ? 'Searching...' : 'Search photo'}
            </button>
          </div>
          {imagePreview && (
            <img className="photo-log-upload-preview" src={imagePreview} alt="Selected search photo" />
          )}
        </div>
      </section>

      {error && <div className="photo-log-message photo-log-error" role="alert">{error}</div>}
      {notice && <div className="photo-log-message photo-log-notice" role="status">{notice}</div>}

      {selectedEmployee && (
        <section className="photo-log-results" aria-label="Employee attendance photo log">
          <div className="photo-log-employee">
            <div>
              <div className="photo-log-identity-avatar" aria-hidden="true">
                {latestCameraImage ? (
                  <PhotoLogImage source={latestCameraImage} alt="" className="photo-log-profile-image" />
                ) : (
                  `${selectedEmployee.firstName?.[0] || ''}${selectedEmployee.lastName?.[0] || selectedEmployee.firstName?.[1] || ''}`.toUpperCase() || 'EM'
                )}
              </div>
              <div className="photo-log-identity-copy">
                <p className="photo-log-eyebrow">EMPLOYEE RECORD</p>
                <h2>{employeeName(selectedEmployee)}</h2>
                <p>{selectedEmployee.employeeCode || 'No code'} <span aria-hidden="true">|</span> {selectedEmployee.department || 'No department'}</p>
              </div>
            </div>
            <span className="photo-log-record-total">{recordCount} total records</span>
          </div>

          <div className="photo-log-summary-grid">
            <div className="photo-log-summary-card">
              <span>Records on this page</span>
              <strong>{records.length}</strong>
            </div>
            <div className="photo-log-summary-card">
              <span>Entries on this page</span>
              <strong>{records.filter((record) => record.eventType === 'IN').length}</strong>
            </div>
            <div className="photo-log-summary-card">
              <span>Exits on this page</span>
              <strong>{records.filter((record) => record.eventType === 'OUT').length}</strong>
            </div>
            <div className="photo-log-summary-card">
              <span>Photo references</span>
              <strong>{records.filter((record) => Boolean(getPhotoSource(record))).length}</strong>
            </div>
          </div>

          <div className="photo-log-table-toolbar">
            <div>
              <h2>Entry and exit history</h2>
              <p>{recordCount} record{recordCount === 1 ? '' : 's'} found for this employee</p>
            </div>
            <div className="photo-log-toolbar-actions">
              <label>
                <span>Direction</span>
                <select
                  value={eventFilter}
                  onChange={(event) => {
                    setEventFilter(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All entries and exits</option>
                  <option value="IN">Entry only</option>
                  <option value="OUT">Exit only</option>
                </select>
              </label>
              <button
                type="button"
                className="photo-log-button photo-log-button-outline"
                onClick={handleDownloadPdf}
                disabled={Boolean(exporting) || loadingRecords || recordCount === 0}
              >
                {exporting === 'pdf' ? 'Preparing PDF...' : 'Download PDF'}
              </button>
              <button
                type="button"
                className="photo-log-button"
                onClick={handleDownloadExcel}
                disabled={Boolean(exporting) || loadingRecords || recordCount === 0}
              >
                {exporting === 'excel' ? 'Preparing Excel...' : 'Download Excel'}
              </button>
            </div>
          </div>

          {loadingRecords ? (
            <div className="photo-log-empty-state">Loading photo log...</div>
          ) : records.length === 0 ? (
            <div className="photo-log-empty-state">No entry or exit records found for this employee.</div>
          ) : (
            <div className="photo-log-table-wrap">
              <table className="photo-log-table">
                <thead>
                  <tr>
                    <th>Photo</th>
                    <th>Direction</th>
                    <th>Date and time</th>
                    <th>Camera</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <PhotoLogImage
                          source={getPhotoSource(record)}
                          alt={`${record.eventType || 'Attendance'} camera-detected face`}
                          className="photo-log-thumbnail"
                        />
                        {!record.capturedImage && (
                          <span className="photo-log-photo-caption">Camera image unavailable</span>
                        )}
                      </td>
                      <td>
                        <span className={`photo-log-direction ${record.eventType === 'OUT' ? 'exit' : 'entry'}`}>
                          {record.eventType === 'IN' ? 'ENTRY' : record.eventType === 'OUT' ? 'EXIT' : record.eventType || 'N/A'}
                        </span>
                      </td>
                      <td>{formatTimestamp(record.timestamp)}</td>
                      <td>{record.camera?.name || record.cameraId || 'N/A'}</td>
                      <td>{record.status || 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {recordCount > PAGE_SIZE && (
            <div className="photo-log-pagination">
              <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loadingRecords}>
                Previous
              </button>
              <span>Page {page} of {pageCount}</span>
              <button type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page >= pageCount || loadingRecords}>
                Next
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
};

export default PhotoLog;
