import { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../contexts/ThemeContext';

interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

export function Modal({ onClose, children, className = '' }: ModalProps) {
  const { theme } = useTheme();

  const modal = (
    <div data-theme={theme} className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative bg-base-100 rounded-lg shadow-xl p-6 flex flex-col gap-4 z-10 ${className}`}>
        {children}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
