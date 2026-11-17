import React from 'react';
import Button from './Button';

const Modal = ({
  isOpen,
  title,
  onClose,
  children,
  footer,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  confirmVariant = 'danger',
  loading = false,
  className = '',
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal-content ${className}`.trim()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close-btn" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">
          {footer ? (
            footer
          ) : (
            <>
              <Button variant="secondary" onClick={onClose} disabled={loading}>
                {cancelText}
              </Button>
              {onConfirm && (
                <Button
                  variant={confirmVariant}
                  onClick={onConfirm}
                  loading={loading}
                  disabled={loading}
                >
                  {confirmText}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Modal;
