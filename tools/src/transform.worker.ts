import { transform, type ToolInput } from './transforms';

self.onmessage = async (event: MessageEvent<ToolInput>) => {
  try {
    self.postMessage({ output: await transform(event.data) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '处理失败' });
  }
};
