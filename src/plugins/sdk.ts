export type {
  BuiltinIconId,
  ContributedCommand,
  ContributedExporter,
  ContributedImporter,
  ContributedInlineAnnotationProvider,
  ContributedStatusBadge,
  ContributedTransform,
  ContributedUIControl,
  ContributedUIPanel,
  CorePermission,
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
  InlineAnnotation,
  InlineAnnotationContext,
  InlineAnnotationKind,
  InlineAnnotationProvider,
  Importer,
  OptionalPermission,
  PluginActivationEvent,
  PluginApi,
  PluginCommand,
  PluginCommandContext,
  PluginContributions,
  PluginManifest,
  PluginManifestEngine,
  PluginPermission,
  PluginSignature,
  ProposedPluginApi,
  RegisteredExporter,
  RegisteredImporter,
  RegisteredInlineAnnotationProvider,
  RegisteredPluginCommand,
  RegisteredStatusBadge,
  RegisteredUIControl,
  RegisteredUIPanel,
  RenderedInlineAnnotation,
  RenderedStatusBadge,
  StatusBadge,
  StatusBadgeContext,
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

import type {
  DocumentTransform,
  Exporter,
  GraineryPlugin as GraineryPluginType,
  Importer,
  InlineAnnotationProvider,
  PluginCommand,
  PluginManifest,
  StatusBadge,
  UIControlDefinition,
  UIPanelDefinition,
} from './types';

export type PluginDocument = import('@tiptap/react').JSONContent;
export type PluginSetup = GraineryPluginType['setup'];
export type PluginDispose = NonNullable<GraineryPluginType['dispose']>;

export function definePlugin<T extends GraineryPluginType>(plugin: T): T {
  return plugin;
}

export function defineManifest<T extends PluginManifest>(manifest: T): T {
  return manifest;
}

export function defineCommand<T extends PluginCommand>(command: T): T {
  return command;
}

export function defineDocumentTransform<T extends DocumentTransform>(transform: T): T {
  return transform;
}

export function defineExporter<T extends Exporter>(exporter: T): T {
  return exporter;
}

export function defineImporter<T extends Importer>(importer: T): T {
  return importer;
}

export function defineStatusBadge<T extends StatusBadge>(badge: T): T {
  return badge;
}

export function defineInlineAnnotationProvider<T extends InlineAnnotationProvider>(provider: T): T {
  return provider;
}

export function defineUIControl<T extends UIControlDefinition>(control: T): T {
  return control;
}

export function defineUIPanel<T extends UIPanelDefinition>(panel: T): T {
  return panel;
}
