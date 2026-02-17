import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { getFindReplaceState, type FindReplaceState } from '../../extensions';

interface FindReplaceBarProps {
  editor: Editor | null;
  isOpen: boolean;
  onClose: () => void;
}

const EMPTY_STATE: FindReplaceState = {
  query: '',
  replaceWith: '',
  matchCase: false,
  matches: [],
  activeIndex: -1,
  isOpen: false,
};

export function FindReplaceBar({ editor, isOpen, onClose }: FindReplaceBarProps) {
  const [state, setState] = useState<FindReplaceState>(EMPTY_STATE);
  const findInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editor) {
      setState(EMPTY_STATE);
      return;
    }

    const syncState = () => {
      setState(getFindReplaceState(editor));
    };

    syncState();
    editor.on('transaction', syncState);

    return () => {
      editor.off('transaction', syncState);
    };
  }, [editor]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }, [isOpen]);

  const totalMatches = state.matches.length;
  const currentMatch = totalMatches === 0 ? 0 : state.activeIndex + 1;
  const canNavigate = state.query.length > 0 && totalMatches > 0;
  const canReplace = canNavigate;

  const matchLabel = useMemo(() => `${currentMatch}/${totalMatches}`, [currentMatch, totalMatches]);

  const handleClose = () => {
    if (!editor) {
      return;
    }
    editor.commands.closeFind();
    onClose();
  };

  if (!editor || !isOpen) {
    return null;
  }

  return (
    <div className="find-replace-bar">
      <div className="find-replace-row">
        <label className="find-replace-field">
          <span className="find-replace-label">Find</span>
          <input
            ref={findInputRef}
            type="text"
            value={state.query}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            onChange={(event) => {
              editor.commands.setFindQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (event.shiftKey) {
                  editor.commands.findPrevious();
                } else {
                  editor.commands.findNext();
                }
              } else if (event.key === 'Escape') {
                event.preventDefault();
                handleClose();
              }
            }}
            className="input input-bordered input-sm"
            placeholder="Find text..."
          />
        </label>

        <label className="find-replace-field">
          <span className="find-replace-label">Replace</span>
          <input
            type="text"
            value={state.replaceWith}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            onChange={(event) => {
              editor.commands.setReplaceText(event.target.value);
            }}
            className="input input-bordered input-sm"
            placeholder="Replace with..."
          />
        </label>
      </div>

      <div className="find-replace-row">
        <label className="find-replace-toggle">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={state.matchCase}
            onChange={(event) => {
              editor.commands.toggleMatchCase(event.target.checked);
            }}
          />
          <span>Match case</span>
        </label>

        <div className="find-replace-controls">
          <span className="find-replace-count">{matchLabel}</span>
          <button
            type="button"
            className="btn btn-outline btn-xs"
            disabled={!canNavigate}
            onClick={() => {
              editor.commands.findPrevious();
            }}
          >
            Prev
          </button>
          <button
            type="button"
            className="btn btn-outline btn-xs"
            disabled={!canNavigate}
            onClick={() => {
              editor.commands.findNext();
            }}
          >
            Next
          </button>
          <button
            type="button"
            className="btn btn-outline btn-xs"
            disabled={!canReplace}
            onClick={() => {
              editor.commands.replaceCurrent();
            }}
          >
            Replace
          </button>
          <button
            type="button"
            className="btn btn-primary btn-xs"
            disabled={!canReplace}
            onClick={() => {
              editor.commands.replaceAll();
            }}
          >
            Replace All
          </button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={handleClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
