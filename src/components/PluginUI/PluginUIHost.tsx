import { useEffect, useMemo, useState } from 'react';
import type { JSONContent } from '@tiptap/react';
import { PluginToolbar } from './PluginToolbar';
import { PluginSidePanel } from './PluginSidePanel';
import type {
  EvaluatedUIControl,
  EvaluatedUIPanel,
  PluginManager,
  UIControlAction,
  UIControlState,
  UIControlStateContext,
  UIPanelContent,
} from '../../plugins';
import type { ScreenplayElementType } from '../../lib/types';

interface EditorAdapter {
  getCurrentElementType: () => ScreenplayElementType | null;
  getPreviousElementType: () => string | null;
  isCurrentElementEmpty: () => boolean;
  getSelectionRange: () => { from: number; to: number };
  setElementType: (type: ScreenplayElementType) => void;
  cycleElement: (direction: 'next' | 'prev') => void;
  escapeToAction: () => void;
}

interface PluginUIHostProps {
  pluginManager: PluginManager;
  pluginStateVersion: number;
  editorVersion: number;
  document: JSONContent;
  editorAdapter: EditorAdapter;
}

function defaultPanelContent(): UIPanelContent {
  return { blocks: [] };
}

export function PluginUIHost({
  pluginManager,
  pluginStateVersion,
  editorVersion,
  document,
  editorAdapter,
}: PluginUIHostProps) {
  const topControls = useMemo(() => pluginManager.getUIControls('top-bar'), [pluginManager, pluginStateVersion]);
  const bottomControls = useMemo(
    () => pluginManager.getUIControls('bottom-bar'),
    [pluginManager, pluginStateVersion]
  );
  const panels = useMemo(() => pluginManager.getUIPanels(), [pluginManager, pluginStateVersion]);

  const [controlStateMap, setControlStateMap] = useState<Record<string, UIControlState>>({});
  const [panelContentMap, setPanelContentMap] = useState<Record<string, UIPanelContent>>({});
  const [activePanelId, setActivePanelId] = useState<string | null>(null);

  const allControlIds = useMemo(
    () => [...topControls, ...bottomControls].map((control) => control.id),
    [topControls, bottomControls]
  );
  const allPanelIds = useMemo(() => panels.map((panel) => panel.id), [panels]);

  const context = useMemo<UIControlStateContext>(
    () => {
      const selection = editorAdapter.getSelectionRange();
      return {
        document,
        currentElementType: editorAdapter.getCurrentElementType(),
        previousElementType: editorAdapter.getPreviousElementType(),
        isCurrentEmpty: editorAdapter.isCurrentElementEmpty(),
        selectionFrom: selection.from,
        selectionTo: selection.to,
      };
    },
    [document, editorAdapter, editorVersion]
  );

  useEffect(() => {
    let cancelled = false;

    const evaluate = async () => {
      try {
        const evaluated = await pluginManager.evaluateUIState(allControlIds, allPanelIds, context);
        if (!cancelled) {
          setControlStateMap(evaluated.controls);
          setPanelContentMap(evaluated.panels);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('[PluginUIHost] Failed to evaluate plugin UI state', error);
          setControlStateMap({});
          setPanelContentMap({});
        }
      }
    };

    if (allControlIds.length > 0 || allPanelIds.length > 0) {
      void evaluate();
    } else {
      setControlStateMap({});
      setPanelContentMap({});
    }

    return () => {
      cancelled = true;
    };
  }, [allControlIds, allPanelIds, context, pluginManager, pluginStateVersion]);

  useEffect(() => {
    if (!activePanelId) {
      return;
    }

    const exists = panels.some((panel) => panel.id === activePanelId);
    if (!exists) {
      setActivePanelId(null);
    }
  }, [activePanelId, panels]);

  const runAction = async (action: UIControlAction | null | undefined) => {
    if (!action) {
      return;
    }

    switch (action.type) {
      case 'command':
        await pluginManager.executeCommand(action.commandId, { source: 'plugin-ui' });
        break;
      case 'editor:set-element':
        editorAdapter.setElementType(action.elementType);
        break;
      case 'editor:cycle-element':
        editorAdapter.cycleElement(action.direction);
        break;
      case 'editor:escape-to-action':
        editorAdapter.escapeToAction();
        break;
      case 'panel:open':
        setActivePanelId(action.panelId);
        break;
      case 'panel:close':
        if (activePanelId === action.panelId) {
          setActivePanelId(null);
        }
        break;
      case 'panel:toggle':
        setActivePanelId((current) => (current === action.panelId ? null : action.panelId));
        break;
      default:
        break;
    }
  };

  const handleTriggerControl = (controlId: string) => {
    void (async () => {
      try {
        const action = await pluginManager.triggerUIControl(controlId, context);
        await runAction(action);
      } catch (error) {
        console.error(`[PluginUIHost] Failed to trigger control ${controlId}`, error);
      }
    })();
  };

  const handlePanelAction = (panelId: string, actionId: string) => {
    void (async () => {
      try {
        const response = await pluginManager.dispatchUIPanelAction(panelId, actionId, context);
        if (response.content) {
          setPanelContentMap((prev) => ({
            ...prev,
            [panelId]: response.content as UIPanelContent,
          }));
        }
        await runAction(response.action);
      } catch (error) {
        console.error(`[PluginUIHost] Failed to dispatch panel action ${panelId}:${actionId}`, error);
      }
    })();
  };

  const evaluatedTopControls: EvaluatedUIControl[] = topControls
    .map((control) => ({
      ...control,
      state: controlStateMap[control.id] ?? {
        visible: true,
        disabled: false,
        active: false,
      },
    }))
    .filter((control) => control.state.visible);

  const evaluatedBottomControls: EvaluatedUIControl[] = bottomControls
    .map((control) => ({
      ...control,
      state: controlStateMap[control.id] ?? {
        visible: true,
        disabled: false,
        active: false,
      },
    }))
    .filter((control) => control.state.visible);

  const activePanel =
    panels.find((panel) => panel.id === activePanelId) ?? null;

  const evaluatedPanel: EvaluatedUIPanel | null = activePanel
    ? {
        ...activePanel,
        content:
          panelContentMap[activePanel.id] ??
          activePanel.content ??
          defaultPanelContent(),
      }
    : null;

  return (
    <>
      <PluginToolbar mount="top-bar" controls={evaluatedTopControls} onTrigger={handleTriggerControl} />
      <PluginToolbar
        mount="bottom-bar"
        controls={evaluatedBottomControls}
        onTrigger={handleTriggerControl}
      />
      <PluginSidePanel
        panel={evaluatedPanel}
        onClose={() => setActivePanelId(null)}
        onAction={handlePanelAction}
      />
    </>
  );
}
