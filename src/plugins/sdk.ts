import type { GraineryPlugin } from './types';

export type {
  DocumentTransform,
  DocumentTransformContext,
  DocumentTransformHook,
  ElementLoopContext,
  ElementLoopEvent,
  ElementLoopProvider,
  ElementLoopRule,
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
} from './types';

export function definePlugin(plugin: GraineryPlugin): GraineryPlugin {
  return plugin;
}
