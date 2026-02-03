import { Modal } from '../Modal';
import type { TitlePageData } from '../../lib/types';

interface TitlePagePreviewProps {
  titlePage: TitlePageData | null;
  onClose: () => void;
}

export function TitlePagePreview({ titlePage, onClose }: TitlePagePreviewProps) {
  return (
    <Modal onClose={onClose} className="w-[90%] max-w-4xl">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-lg text-base-content">Title Page Preview</h3>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
      </div>


      <div className="flex justify-center">
        {/* Page container - 8.5x11 aspect ratio */}
        <div
          className="bg-white border border-base-300 shadow-inner overflow-hidden"
          style={{
            width: '425px',
            height: '550px',
            fontFamily: 'Courier, monospace',
            fontSize: '10px',
            lineHeight: '10px',
            color: '#000',
            position: 'relative',
          }}
        >
          {titlePage ? (
            <>
              {/* Center block - title, credit, author, source */}
              <div
                className="absolute left-0 right-0 flex flex-col items-center text-center"
                style={{
                  top: '50%',
                  transform: 'translateY(-50%)',
                  padding: '0 54px',
                }}
              >
                {titlePage.title && (
                  <>
                    <div className="font-bold" style={{ textTransform: 'uppercase' }}>
                      {titlePage.title}
                    </div>
                    <div style={{ height: '10px' }} />
                  </>
                )}
                {titlePage.credit && <div>{titlePage.credit}</div>}
                {titlePage.author && (
                  <>
                    <div>{titlePage.author}</div>
                    <div style={{ height: '10px' }} />
                  </>
                )}
                {titlePage.source && (
                  <>
                    <div>{titlePage.source}</div>
                    <div style={{ height: '10px' }} />
                  </>
                )}
              </div>

              {/* Bottom left - contact & copyright */}
              <div
                className="absolute"
                style={{
                  left: '54px',
                  bottom: '72px',
                }}
              >
                {titlePage.contact && (
                  <div style={{ whiteSpace: 'pre-line' }}>{titlePage.contact}</div>
                )}
                {titlePage.copyright && <div>{titlePage.copyright}</div>}
              </div>

              {/* Bottom right - draft date */}
              {titlePage.draftDate && (
                <div
                  className="absolute"
                  style={{
                    right: '36px',
                    bottom: '72px',
                  }}
                >
                  {titlePage.draftDate}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-base-content/40">
              No title page data
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <button className="btn btn-primary btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
