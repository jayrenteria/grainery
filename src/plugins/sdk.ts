import type { GraineryPlugin } from './types';

export type {
  BuiltinIconId,
  DocumentTransform,
  DocumentTransformContext,
  DocumentTransformHook,
  ElementLoopContext,
  ElementLoopEvent,
  ElementLoopProvider,
  ElementLoopRule,
  EvaluatedUIControl,
  EvaluatedUIPanel,
  Exporter,
  ExporterContext,
  ExporterOutput,
  GraineryPlugin,
  HostOperation,
  Importer,
  OptionalPermission,
  PluginApi,
  PluginCommand,
  PluginCommandContext,
  UIControlAction,
  UIControlDefinition,
  UIControlKind,
  UIControlMount,
  UIControlState,
  UIControlStateContext,
  UIControlTriggerResult,
  UIEvaluateResponse,
  UIPanelActionContext,
  UIPanelActionItem,
  UIPanelActionResult,
  UIPanelBlock,
  UIPanelContent,
  UIPanelDefinition,
  UIPanelStateContext,
} from './types';

export function definePlugin(plugin: GraineryPlugin): GraineryPlugin {
  return plugin;
}
