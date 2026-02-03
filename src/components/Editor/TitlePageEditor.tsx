import { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import type { TitlePageData } from '../../lib/types';

interface TitlePageEditorProps {
  titlePage: TitlePageData | null;
  onSave: (titlePage: TitlePageData | null) => void;
  onClose: () => void;
}

const EMPTY_TITLE_PAGE: TitlePageData = {
  title: '',
  credit: 'Written by',
  author: '',
  source: '',
  draftDate: '',
  contact: '',
  copyright: '',
  notes: '',
};

export function TitlePageEditor({ titlePage, onSave, onClose }: TitlePageEditorProps) {
  const [formData, setFormData] = useState<TitlePageData>(
    titlePage || EMPTY_TITLE_PAGE
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleChange = (field: keyof TitlePageData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.title.trim() || formData.author.trim()) {
      onSave(formData);
    } else {
      onSave(null);
    }
    onClose();
  };

  const handleClear = () => {
    onSave(null);
    onClose();
  };

  return (
    <Modal onClose={onClose} className="w-[90%] max-w-4xl max-h-[80vh] overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-lg text-base-content">Title Page</h3>
        <button className="btn btn-sm btn-circle btn-ghost" onClick={onClose}>✕</button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="form-control">
          <label className="label">
            <span className="label-text font-semibold">Title</span>
          </label>
          <input
            type="text"
            className="input input-bordered w-full"
            value={formData.title}
            onChange={(e) => handleChange('title', e.target.value)}
            placeholder="SCREENPLAY TITLE"
            autoFocus
          />
        </div>

        <div className="form-control">
          <label className="label">
            <span className="label-text font-semibold">Credit</span>
          </label>
          <input
            type="text"
            className="input input-bordered w-full"
            value={formData.credit || ''}
            onChange={(e) => handleChange('credit', e.target.value)}
            placeholder="Written by"
          />
        </div>

        <div className="form-control">
          <label className="label">
            <span className="label-text font-semibold">Author</span>
          </label>
          <input
            type="text"
            className="input input-bordered w-full"
            value={formData.author}
            onChange={(e) => handleChange('author', e.target.value)}
            placeholder="Author Name"
          />
        </div>

        <div className="form-control">
          <label className="label">
            <span className="label-text font-semibold">Source</span>
          </label>
          <input
            type="text"
            className="input input-bordered w-full"
            value={formData.source || ''}
            onChange={(e) => handleChange('source', e.target.value)}
            placeholder="Based on..."
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="form-control">
            <label className="label">
              <span className="label-text font-semibold">Draft Date</span>
            </label>
            <input
              type="text"
              className="input input-bordered w-full"
              value={formData.draftDate || ''}
              onChange={(e) => handleChange('draftDate', e.target.value)}
              placeholder="January 2025"
            />
          </div>

          <div className="form-control">
            <label className="label">
              <span className="label-text font-semibold">Copyright</span>
            </label>
            <input
              type="text"
              className="input input-bordered w-full"
              value={formData.copyright || ''}
              onChange={(e) => handleChange('copyright', e.target.value)}
              placeholder="© 2025"
            />
          </div>
        </div>

        <div className="form-control">
          <label className="label">
            <span className="label-text font-semibold">Contact</span>
          </label>
          <textarea
            className="textarea textarea-bordered w-full"
            value={formData.contact || ''}
            onChange={(e) => handleChange('contact', e.target.value)}
            placeholder="Contact information..."
            rows={3}
          />
        </div>

        <div className="form-control">
          <label className="label">
            <span className="label-text font-semibold">Notes</span>
          </label>
          <textarea
            className="textarea textarea-bordered w-full"
            value={formData.notes || ''}
            onChange={(e) => handleChange('notes', e.target.value)}
            placeholder="Additional notes..."
            rows={2}
          />
        </div>

        <div className="divider my-2" />

        <div className="flex justify-between">
          <button type="button" className="btn btn-error btn-outline" onClick={handleClear}>
            Clear Title Page
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
