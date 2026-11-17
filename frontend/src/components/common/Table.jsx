import React from 'react';

const Table = ({
  columns = [],
  data = [],
  totalCount,
  emptyMessage = 'No records found.',
  keyField = 'id',
  minWidth = 'auto',
  noWrapper = false,
  renderMobileCard = null,
}) => {
  const count = data.length;
  const total = totalCount !== undefined ? totalCount : count;

  const content = (
    <>
      {!noWrapper && <div className="table-accent-bar" aria-hidden="true"></div>}
      
      {renderMobileCard && (
        <div className="table-mobile-cards">
          {data.length === 0 ? (
            <div className="empty-table-state">
              <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <p>{emptyMessage}</p>
            </div>
          ) : (
            data.map((item, rowIdx) => React.cloneElement(renderMobileCard(item, rowIdx), { key: item[keyField] || rowIdx }))
          )}
        </div>
      )}

      <div className={`table-responsive ${renderMobileCard ? 'desktop-only-table' : ''}`} style={{ overflowX: 'auto', width: '100%' }}>
        <table className="custom-table" style={{ minWidth }}>
          <thead>
            <tr>
              {columns.map((col, idx) => (
                <th
                  key={col.key || idx}
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="table-empty">
                  <div className="empty-table-state">
                    <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <p>{emptyMessage}</p>
                  </div>
                </td>
              </tr>
            ) : (
              data.map((item, rowIdx) => (
                <tr key={item[keyField] || rowIdx} className="table-row-hover">
                  {columns.map((col, colIdx) => (
                    <td key={col.key || colIdx} data-label={col.header}>
                      <div className="td-content">
                        {col.render
                          ? col.render(item, rowIdx)
                          : col.accessor
                          ? item[col.accessor]
                          : ''}
                      </div>
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span className="table-footer-text">
          Showing {count} of {total} {total === 1 ? 'record' : 'records'}
        </span>
      </div>
    </>
  );

  return noWrapper ? <>{content}</> : <div className="table-card-wrapper">{content}</div>;
};

export default Table;
