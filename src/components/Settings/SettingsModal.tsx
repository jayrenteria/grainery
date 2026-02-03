import { useState } from 'react';
import { useTheme, THEMES, Theme } from '../../contexts/ThemeContext';
import { Modal } from '../Modal';
import { TitlePagePreview } from '../TitlePage';
import type { TitlePageData } from '../../lib/types';

interface SettingsModalProps {
  onClose: () => void;
  onOpenTitlePage: () => void;
  titlePage: TitlePageData | null;
}

function capitalizeTheme(theme: string): string {
  return theme.charAt(0).toUpperCase() + theme.slice(1);
}

function ThemeCard({ t, isSelected, onClick }: { t: Theme; isSelected: boolean; onClick: () => void }) {
  return (
    <button
      data-theme={t}
      onClick={onClick}
      className={`flex flex-col rounded-lg overflow-hidden cursor-pointer transition-all ${
        isSelected ? 'ring-2 ring-primary ring-offset-2 ring-offset-base-100' : 'hover:scale-105'
      }`}
    >
      <div className="flex h-10 w-full">
        <div className="w-1/3 h-full bg-primary" />
        <div className="w-1/3 h-full bg-secondary" />
        <div className="w-1/3 h-full bg-accent" />
      </div>
      <div className="bg-base-100 px-2 py-2 text-sm font-semibold text-base-content text-center">
        {capitalizeTheme(t)}
      </div>
    </button>
  );
}

export function SettingsModal({ onClose, onOpenTitlePage, titlePage }: SettingsModalProps) {
  const { theme, setTheme } = useTheme();
  const [showPreview, setShowPreview] = useState(false);

  const handleOpenTitlePage = () => {
    onClose();
    onOpenTitlePage();
  };

  return (
    <>
      <Modal onClose={onClose} className="w-[90%] max-w-4xl max-h-[80vh] overflow-y-auto gap-2">
        <h3 className="font-bold text-lg mb-6 text-base-content">Settings</h3>
        
        <div className="form-control">
          <label className="label">
            <span className="label-text text-base font-bold">Theme</span>
          </label>
          <div className="grid grid-cols-4 gap-3 mt-2">
            {THEMES.map((t) => (
              <ThemeCard
                key={t}
                t={t}
                isSelected={theme === t}
                onClick={() => setTheme(t)}
              />
            ))}
          </div>
        </div>

        <div className="divider" />

        <div className="form-control">
          <label className="label">
            <span className="label-text text-base font-bold">Title Page</span>
          </label>
          <div className="flex gap-2 mt-2">
            <button
              className="btn btn-outline btn-sm"
              onClick={handleOpenTitlePage}
            >
              Edit Title Page
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setShowPreview(true)}
            >
              Preview
            </button>
          </div>
        </div>

        <div className="divider" />

        <p className="text-sm text-base-content/60 italic">
          More settings coming soon...
        </p>

        <div className="mt-6 flex justify-end">
          <button className="btn btn-primary px-6!" onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>

      {showPreview && (
        <TitlePagePreview
          titlePage={titlePage}
          onClose={() => setShowPreview(false)}
        />
      )}
    </>
  );
}
