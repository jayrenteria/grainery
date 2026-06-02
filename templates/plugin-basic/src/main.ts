import type { GraineryPlugin } from '@grainery/plugin-sdk';

const plugin: GraineryPlugin = {
  setup(api) {
    api.registerCommand({
      id: 'hello-world',
      title: 'Hello World',
      async handler(context) {
        const childCount = Array.isArray(context.document.content)
          ? context.document.content.length
          : 0;

        await api.hostCall('audit:log', {
          message: `Hello from __PLUGIN_NAME__. Document has ${childCount} top-level nodes.`,
        });
      },
    });
  },
};

export default plugin;
