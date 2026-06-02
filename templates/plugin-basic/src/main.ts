import type { GraineryPlugin } from '@grainery/plugin-sdk';

const plugin: GraineryPlugin = {
  setup(api) {
    api.registerCommand({
      id: 'hello-world',
      title: 'Hello World',
      async handler(context) {
        const screenplay = context.screenplay || api.screenplay.from(context.document, context);
        const sceneCount = screenplay.scenes().length;
        const wordCount = screenplay.plainText().split(/\s+/).filter(Boolean).length;

        await api.hostCall('audit:log', {
          message: `Hello from __PLUGIN_NAME__. Document has ${sceneCount} scenes and ${wordCount} words.`,
        });
      },
    });
  },
};

export default plugin;
