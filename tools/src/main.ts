import TransformWorker from './transform.worker?worker&inline';
import { PROTOCOL_VERSION, type ToolId } from '@xtools/tool-sdk';
import './style.css';

const samples: Record<ToolId, string> = {
  json: '{"project":"XTools","version":"0.1.0","tools":["JSON","Base64","Timestamp"],"localFirst":true,"settings":{"theme":"light","language":"zh-CN"}}',
  base64: '你好，开发者。Hello, developer.',
  url: 'https://example.com/search?q=开发者工具&sort=recent',
  timestamp: String(Math.floor(Date.now() / 1000)),
  uuid: '5',
  hash: 'Hello, XTools!',
  regex: 'Contact: hello@example.com\nSupport: dev@xtools.app',
  diff: '{\n  "name": "xtools",\n  "version": "0.1.0"\n}',
};
let session = '';
let toolId: ToolId = 'json';
let worker: Worker | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const root = document.querySelector<HTMLElement>('#tool')!;

function sendResult(output: string) {
  parent.postMessage({ type: 'xtools:result', protocol: PROTOCOL_VERSION, session, output }, '*');
}

function render() {
  root.innerHTML = `
    <div class="toolbar">
      <div class="options"></div>
      <div class="commands"><button id="sample" class="secondary">载入示例</button><button id="clear" class="secondary">清空</button><button id="run" class="primary">运行</button></div>
    </div>
    <div id="error" role="alert" hidden></div>
    <div class="editors">
      <section class="editor"><div class="editor-heading"><label for="input">输入</label><span id="input-count"></span></div><textarea id="input" spellcheck="false" aria-label="输入"></textarea></section>
      <section class="editor" id="secondary-editor" hidden><div class="editor-heading"><label for="secondary">对比文本</label></div><textarea id="secondary" spellcheck="false" aria-label="对比文本"></textarea></section>
      <section class="editor result"><div class="editor-heading"><label for="output">输出</label><span id="result-state">就绪</span></div><textarea id="output" spellcheck="false" readonly aria-label="输出"></textarea></section>
    </div>
    <div class="editor-footer"><span id="syntax"></span><span id="output-count">0 字符</span></div>
  `;
  const options = root.querySelector<HTMLElement>('.options')!;
  const input = root.querySelector<HTMLTextAreaElement>('#input')!;
  const secondary = root.querySelector<HTMLTextAreaElement>('#secondary')!;
  const output = root.querySelector<HTMLTextAreaElement>('#output')!;
  const run = root.querySelector<HTMLButtonElement>('#run')!;
  const error = root.querySelector<HTMLElement>('#error')!;
  const state = root.querySelector<HTMLElement>('#result-state')!;
  const count = root.querySelector<HTMLElement>('#input-count')!;
  const outputCount = root.querySelector<HTMLElement>('#output-count')!;
  const select = (id: string, label: string, values: [string, string][]) =>
    `<label class="select-label">${label}<select id="${id}">${values.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></label>`;
  if (toolId === 'json') {
    options.innerHTML = select('mode', '操作', [['format', '格式化'], ['compact', '压缩']])
      + select('option', '缩进', [['2', '2 空格'], ['4', '4 空格']]);
  } else if (toolId === 'base64' || toolId === 'url') {
    options.innerHTML = select('mode', '操作', [['encode', '编码'], ['decode', '解码']]);
  } else if (toolId === 'timestamp') {
    options.innerHTML = select('option', '时间戳单位', [['seconds', '秒'], ['milliseconds', '毫秒']]);
  } else if (toolId === 'hash') {
    options.innerHTML = select('option', '算法', [['SHA-256', 'SHA-256'], ['SHA-384', 'SHA-384'], ['SHA-512', 'SHA-512']]);
  } else if (toolId === 'regex') {
    options.innerHTML = '<label class="select-label">表达式<input id="pattern" aria-label="表达式" value="[\\\\w.+-]+@[\\\\w.-]+\\\\.[a-zA-Z]{2,}" /></label>'
      + select('option', '标记', [['g', 'g'], ['gi', 'gi'], ['gm', 'gm'], ['gim', 'gim'], ['gu', 'gu']]);
  } else if (toolId === 'uuid') {
    options.innerHTML = '<span class="mode-label">UUID v4</span>';
    root.querySelector('label[for="input"]')!.textContent = '生成数量';
  } else {
    options.innerHTML = '<span class="mode-label">逐行对比</span>';
    root.querySelector<HTMLElement>('#secondary-editor')!.hidden = false;
    root.querySelector('.editors')!.classList.add('three-columns');
  }
  root.querySelector('#syntax')!.textContent = toolId === 'json' ? 'JSON / UTF-8' : 'TEXT / UTF-8';
  const updateCount = () => { count.textContent = `${input.value.length.toLocaleString()} 字符`; };
  input.oninput = updateCount;
  const resetWorker = () => { worker?.terminate(); clearTimeout(timer); run.disabled = false; };
  const setOutput = (value: string) => {
    output.value = value;
    outputCount.textContent = `${value.length.toLocaleString()} 字符`;
    sendResult(value);
  };
  function execute() {
    resetWorker();
    error.hidden = true;
    setOutput('');
    state.textContent = '处理中';
    run.disabled = true;
    worker = new TransformWorker();
    const started = performance.now();
    timer = setTimeout(() => {
      resetWorker();
      error.hidden = false;
      error.textContent = '处理超时，已停止任务。请缩小输入范围或检查表达式。';
      state.textContent = '已停止';
    }, 1800);
    worker.onmessage = (event: MessageEvent<{ output?: string; error?: string }>) => {
      resetWorker();
      if (event.data.error) {
        error.hidden = false;
        error.textContent = event.data.error;
        state.textContent = '处理失败';
      } else {
        setOutput(event.data.output ?? '');
        state.textContent = `${Math.round(performance.now() - started)} ms`;
      }
    };
    worker.onerror = () => {
      resetWorker();
      error.hidden = false;
      error.textContent = '工具运行失败，请重新打开工具';
      state.textContent = '处理失败';
    };
    worker.postMessage({
      id: toolId,
      input: input.value,
      secondary: toolId === 'regex' ? root.querySelector<HTMLInputElement>('#pattern')!.value : secondary.value,
      mode: root.querySelector<HTMLSelectElement>('#mode')?.value ?? '',
      option: root.querySelector<HTMLSelectElement>('#option')?.value ?? '',
    });
  }
  function loadSample() {
    input.value = toolId === 'timestamp' ? String(Math.floor(Date.now() / 1000)) : samples[toolId];
    secondary.value = '{\n  "name": "xtools",\n  "version": "0.2.0",\n  "private": true\n}';
    updateCount();
    execute();
  }
  run.onclick = execute;
  root.querySelector<HTMLButtonElement>('#sample')!.onclick = loadSample;
  root.querySelector<HTMLButtonElement>('#clear')!.onclick = () => {
    resetWorker();
    input.value = '';
    secondary.value = '';
    setOutput('');
    updateCount();
    state.textContent = '就绪';
    error.hidden = true;
  };
  loadSample();
}

window.addEventListener('message', (event) => {
  if (event.source !== parent || !event.data || event.data.protocol !== PROTOCOL_VERSION) return;
  if (event.data.type === 'xtools:init' && !session
    && typeof event.data.session === 'string' && Object.hasOwn(samples, event.data.toolId)) {
    session = event.data.session;
    toolId = event.data.toolId;
    document.documentElement.dataset.theme = event.data.theme === 'dark' ? 'dark' : 'light';
    render();
  }
  if (event.data.type === 'xtools:theme' && event.data.session === session) {
    document.documentElement.dataset.theme = event.data.theme === 'dark' ? 'dark' : 'light';
  }
});
