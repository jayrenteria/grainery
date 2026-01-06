import { useState, useEffect } from 'react';
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
    // Only save if at least title or author is filled
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content title-page-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Title Page</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="title">Title</label>
            <input
              id="title"
              type="text"
              value={formData.title}
              onChange={(e) => handleChange('title', e.target.value)}
              placeholder="SCREENPLAY TITLE"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="credit">Credit</label>
            <input
              id="credit"
              type="text"
              value={formData.credit || ''}
              onChange={(e) => handleChange('credit', e.target.value)}
              placeholder="Written by"
            />
          </div>

          <div className="form-group">
            <label htmlFor="author">Author</label>
            <input
              id="author"
              type="text"
              value={formData.author}
              onChange={(e) => handleChange('author', e.target.value)}
              placeholder="Author Name"
            />
          </div>

          <div className="form-group">
            <label htmlFor="source">Source</label>
            <input
              id="source"
              type="text"
              value={formData.source || ''}
              onChange={(e) => handleChange('source', e.target.value)}
              placeholder="Based on..."
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="draftDate">Draft Date</label>
              <input
                id="draftDate"
                type="text"
                value={formData.draftDate || ''}
                onChange={(e) => handleChange('draftDate', e.target.value)}
                placeholder="January 2025"
              />
            </div>

            <div className="form-group">
              <label htmlFor="copyright">Copyright</label>
              <input
                id="copyright"
                type="text"
                value={formData.copyright || ''}
                onChange={(e) => handleChange('copyright', e.target.value)}
                placeholder="© 2025"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="contact">Contact</label>
            <textarea
              id="contact"
              value={formData.contact || ''}
              onChange={(e) => handleChange('contact', e.target.value)}
              placeholder="Contact information..."
              rows={3}
            />
          </div>

          <div className="form-group">
            <label htmlFor="notes">Notes</label>
            <textarea
              id="notes"
              value={formData.notes || ''}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="Additional notes..."
              rows={2}
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={handleClear}>
              Clear Title Page
            </button>
            <div className="modal-actions-right">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Save
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
