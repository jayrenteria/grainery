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
  UIPanelBlock,
  UIPanelContent,
} from '../../plugins';
import type { ScreenplayElementType } from '../../lib/types';

interface EditorAdapter {
  getCurrentElementType: () => ScreenplayElementType | null;
  getPreviousElementType: () => string | null;
  isCurrentElementEmpty: () => boolean;
  getSelectionRange: () => { from: number; to: number };
  setElementType: (type: ScreenplayElementType) => void;
  jumpToPosition: (position: number, offsetTop?: number) => void;
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

const DEFAULT_INPUT_MAX_LENGTH = 200;
const DEFAULT_TEXTAREA_MAX_LENGTH = 4000;

interface PanelFormField {
  fieldId: string;
  defaultValue: string;
  maxLength: number;
}

function sanitizePanelFieldValue(value: string, maxLength: number): string {
  const normalized = value.replace(/\u0000/g, '');
  return normalized.slice(0, maxLength);
}

function getPanelFormField(block: UIPanelBlock): PanelFormField | null {
  if (block.type === 'input') {
    const maxLength = Number.isFinite(block.maxLength ?? NaN)
      ? Math.max(1, Math.floor(block.maxLength ?? DEFAULT_INPUT_MAX_LENGTH))
      : DEFAULT_INPUT_MAX_LENGTH;
    return {
      fieldId: block.fieldId,
      defaultValue: typeof block.value === 'string' ? block.value : '',
      maxLength,
    };
  }

  if (block.type === 'textarea') {
    const maxLength = Number.isFinite(block.maxLength ?? NaN)
      ? Math.max(1, Math.floor(block.maxLength ?? DEFAULT_TEXTAREA_MAX_LENGTH))
      : DEFAULT_TEXTAREA_MAX_LENGTH;
    return {
      fieldId: block.fieldId,
      defaultValue: typeof block.value === 'string' ? block.value : '',
      maxLength,
    };
  }

  return null;
}

function reconcilePanelFormState(
  content: UIPanelContent,
  previousValues: Record<string, string>,
  previousDefaults: Record<string, string>
): {
  values: Record<string, string>;
  defaults: Record<string, string>;
} {
  const values: Record<string, string> = {};
  const defaults: Record<string, string> = {};

  for (const block of content.blocks) {
    const field = getPanelFormField(block);
    if (!field || !field.fieldId) {
      continue;
    }

    const defaultValue = sanitizePanelFieldValue(field.defaultValue, field.maxLength);
    defaults[field.fieldId] = defaultValue;

    const previousValue = previousValues[field.fieldId];
    const previousDefault = previousDefaults[field.fieldId];

    if (typeof previousValue !== 'string') {
      values[field.fieldId] = defaultValue;
      continue;
    }

    const sanitizedPreviousValue = sanitizePanelFieldValue(previousValue, field.maxLength);

    if (
      typeof previousDefault === 'string' &&
      sanitizedPreviousValue === sanitizePanelFieldValue(previousDefault, field.maxLength)
    ) {
      values[field.fieldId] = defaultValue;
      continue;
    }

    values[field.fieldId] = sanitizedPreviousValue;
  }

  return {
    values,
    defaults,
  };
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
  const [panelFormValuesMap, setPanelFormValuesMap] = useState<Record<string, Record<string, string>>>({});
  const [panelFormDefaultsMap, setPanelFormDefaultsMap] = useState<Record<string, Record<string, string>>>({});
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
          const nextPanelContentMap: Record<string, UIPanelContent> = {};
          for (const panel of panels) {
            nextPanelContentMap[panel.id] =
              evaluated.panels[panel.id] ?? panel.content ?? defaultPanelContent();
          }

          setControlStateMap(evaluated.controls);
          setPanelContentMap(nextPanelContentMap);
          setPanelFormValuesMap((prevValues) => {
            const nextValues: Record<string, Record<string, string>> = {};
            setPanelFormDefaultsMap((prevDefaults) => {
              const nextDefaults: Record<string, Record<string, string>> = {};

              for (const [panelId, content] of Object.entries(nextPanelContentMap)) {
                const reconciled = reconcilePanelFormState(
                  content,
                  prevValues[panelId] ?? {},
                  prevDefaults[panelId] ?? {}
                );
                nextValues[panelId] = reconciled.values;
                nextDefaults[panelId] = reconciled.defaults;
              }

              return nextDefaults;
            });

            return nextValues;
          });
        }
      } catch (error) {
        if (!cancelled) {
          console.error('[PluginUIHost] Failed to evaluate plugin UI state', error);
          setControlStateMap({});
          setPanelContentMap({});
          setPanelFormValuesMap({});
          setPanelFormDefaultsMap({});
        }
      }
    };

    if (allControlIds.length > 0 || allPanelIds.length > 0) {
      void evaluate();
    } else {
      setControlStateMap({});
      setPanelContentMap({});
      setPanelFormValuesMap({});
      setPanelFormDefaultsMap({});
    }

    return () => {
      cancelled = true;
    };
  }, [allControlIds, allPanelIds, context, panels, pluginManager, pluginStateVersion]);

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
      case 'editor:jump-to':
        editorAdapter.jumpToPosition(action.position, action.offsetTop);
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
        const formValues = panelFormValuesMap[panelId] ?? {};
        const response = await pluginManager.dispatchUIPanelAction(panelId, actionId, context, formValues);
        if (response.content) {
          setPanelContentMap((prev) => ({
            ...prev,
            [panelId]: response.content as UIPanelContent,
          }));
          setPanelFormValuesMap((prevValues) => {
            const currentValues = prevValues[panelId] ?? {};
            const currentDefaults = panelFormDefaultsMap[panelId] ?? {};
            const reconciled = reconcilePanelFormState(
              response.content as UIPanelContent,
              currentValues,
              currentDefaults
            );

            setPanelFormDefaultsMap((prevDefaults) => ({
              ...prevDefaults,
              [panelId]: reconciled.defaults,
            }));

            return {
              ...prevValues,
              [panelId]: reconciled.values,
            };
          });
        }
        await runAction(response.action);
      } catch (error) {
        console.error(`[PluginUIHost] Failed to dispatch panel action ${panelId}:${actionId}`, error);
      }
    })();
  };

  const handlePanelFormValueChange = (panelId: string, fieldId: string, value: string) => {
    setPanelFormValuesMap((prev) => ({
      ...prev,
      [panelId]: {
        ...(prev[panelId] ?? {}),
        [fieldId]: value,
      },
    }));
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
        formValues={evaluatedPanel ? panelFormValuesMap[evaluatedPanel.id] ?? {} : {}}
        onClose={() => setActivePanelId(null)}
        onAction={handlePanelAction}
        onFormValueChange={handlePanelFormValueChange}
      />
    </>
  );
}
