export type {
  BuiltinIconId,
  CommandMenuLocation,
  ConfigurationPropertyType,
  ContributedCommand,
  ContributedCommandMenu,
  ContributedConfiguration,
  ContributedConfigurationProperty,
  ContributedExporter,
  ContributedImporter,
  ContributedInlineAnnotationProvider,
  ContributedEditorCompletionProvider,
  ContributedEditorLandmarkProvider,
  ContributedKeybinding,
  ContributedStatusBadge,
  ContributedTransform,
  ContributedUIControl,
  ContributedUIPanel,
  CorePermission,
  Disposable,
  DocumentTransform,
  DocumentTransformContext,
  DocumentTransformHook,
  EditorCompletionContext,
  EditorCompletionItem,
  EditorCompletionProvider,
  EditorLandmark,
  EditorLandmarkContext,
  EditorLandmarkProvider,
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
  PluginStorage,
  ProposedPluginApi,
  RegisteredExporter,
  RegisteredImporter,
  RegisteredInlineAnnotationProvider,
  RegisteredEditorCompletionProvider,
  RegisteredEditorLandmarkProvider,
  RegisteredCommandMenu,
  RegisteredKeybinding,
  RegisteredPluginConfiguration,
  RegisteredPluginCommand,
  RegisteredStatusBadge,
  RegisteredUIControl,
  RegisteredUIPanel,
  RenderedInlineAnnotation,
  RenderedEditorCompletion,
  RenderedEditorLandmark,
  RenderedStatusBadge,
  ScreenplayMutationApi,
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

export type {
  ResolvedScreenplayAnchor,
  ScreenplayAnchor,
  ScreenplayBlock,
  ScreenplayBlockInput,
  ScreenplayBlockRef,
  ScreenplayDialogueBlock,
  ScreenplayDocument,
  ScreenplayDocumentContext,
  ScreenplayRange,
  ScreenplayScene,
  ScreenplaySelection,
} from './document-helpers';

import type {
  DocumentTransform,
  Exporter,
  GraineryPlugin as GraineryPluginType,
  Importer,
  InlineAnnotationProvider,
  EditorCompletionProvider,
  EditorLandmarkProvider,
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

export function defineEditorCompletionProvider<T extends EditorCompletionProvider>(provider: T): T {
  return provider;
}

export function defineEditorLandmarkProvider<T extends EditorLandmarkProvider>(provider: T): T {
  return provider;
}

export function defineUIControl<T extends UIControlDefinition>(control: T): T {
  return control;
}

export function defineUIPanel<T extends UIPanelDefinition>(panel: T): T {
  return panel;
}
