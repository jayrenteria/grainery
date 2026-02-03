import { createPortal } from 'react-dom';
import { useTheme, THEMES, Theme } from '../../contexts/ThemeContext';

interface SettingsModalProps {
  onClose: () => void;
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

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { theme, setTheme } = useTheme();

  const modal = (
    <div data-theme={theme} className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div 
        className="absolute inset-0 bg-black/40" 
        onClick={onClose}
      />
      <div className="relative bg-base-100 rounded-lg shadow-xl w-[90%] max-w-md max-h-[80vh] overflow-y-auto p-6! flex gap-2 flex-col z-10">
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

        <p className="text-sm text-base-content/60 italic">
          More settings coming soon...
        </p>

        <div className="mt-6 flex justify-end">
          <button className="btn btn-primary px-6!" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
