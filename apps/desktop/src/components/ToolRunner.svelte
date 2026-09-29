<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowLeft, Copy, Check, Maximize2, Minimize2 } from 'lucide-svelte';
  import { isToolResult, PROTOCOL_VERSION, type ToolManifest } from '@xtools/tool-sdk';
  import { toolIcons } from '../lib/icons';
  let { tool, html, theme, onback, onerror }: { tool: ToolManifest; html: string; theme: string; onback: () => void; onerror: (message: string) => void } = $props();
  const session = crypto.randomUUID();
  let frame: HTMLIFrameElement;
  let result = $state('');
  let copied = $state(false);
  let expanded = $state(false);
  let copyTimer: ReturnType<typeof setTimeout>;
  const Icon = $derived(toolIcons[tool.id]);
  function initialize() {
    frame.contentWindow?.postMessage({ type: 'xtools:init', protocol: PROTOCOL_VERSION, session, toolId: tool.id, theme }, '*');
  }
  $effect(() => {
    frame?.contentWindow?.postMessage({ type: 'xtools:theme', protocol: PROTOCOL_VERSION, session, theme }, '*');
  });
  onMount(() => {
    const receive = (event: MessageEvent) => {
      if (event.source === frame.contentWindow && isToolResult(event.data, session)) {
        result = event.data.output;
        copied = false;
      }
    };
    window.addEventListener('message', receive);
    return () => { window.removeEventListener('message', receive); clearTimeout(copyTimer); };
  });
  async function copy() {
    try {
      await navigator.clipboard.writeText(result);
      copied = true;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { copied = false; }, 2000);
    } catch { onerror('无法访问剪贴板，请在输出区域选择并复制'); }
  }
</script>

<section class:expanded class="runner">
  <div class="runner-header">
    <button class="icon-button" onclick={onback} aria-label="返回工具列表" title="返回工具列表"><ArrowLeft size={19} /></button>
    <span class="tool-icon small {tool.color}"><Icon size={20} /></span>
    <div class="runner-title"><h1>{tool.name}</h1></div>
    <div class="runner-actions">
      <button class="button secondary" onclick={copy} disabled={!result}>{#if copied}<Check size={15} />已复制{:else}<Copy size={15} />复制结果{/if}</button>
      <button class="icon-button" onclick={() => expanded = !expanded} title={expanded ? '退出专注模式' : '专注模式'} aria-label={expanded ? '退出专注模式' : '专注模式'}>{#if expanded}<Minimize2 size={17} />{:else}<Maximize2 size={17} />{/if}</button>
    </div>
  </div>
  <iframe bind:this={frame} srcdoc={html} title={tool.name} sandbox="allow-scripts" referrerpolicy="no-referrer" onload={initialize}></iframe>
</section>
