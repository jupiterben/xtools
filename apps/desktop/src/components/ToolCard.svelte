<script lang="ts">
  import { ArrowRight, Download, Info, LoaderCircle, Star, Trash2 } from 'lucide-svelte';
  import type { InstalledTool, ToolManifest } from '@xtools/tool-sdk';
  import { toolIcons } from '../lib/icons';
  let { tool, installed, busy = false, locked = false, manage = false, onopen, oninstall, onfavorite, ondetail, onenabled, onuninstall }: {
    tool: ToolManifest; installed?: InstalledTool; busy?: boolean; locked?: boolean; manage?: boolean;
    onopen: () => void; oninstall: () => void; onfavorite: () => void; ondetail: () => void;
    onenabled: () => void; onuninstall: () => void;
  } = $props();
  const Icon = $derived(toolIcons[tool.id]);
</script>

<article class="tool-card" class:managing={manage} data-testid={`card-${tool.id}`}>
  <button id={`open-${tool.id}`} class="tool-main" onclick={installed ? onopen : ondetail}
    disabled={locked || !!(installed && !installed.enabled)}
    aria-label={installed ? `打开${tool.name}` : `查看${tool.name}详情`}>
    <span class="tool-icon {tool.color}"><Icon size={23} strokeWidth={1.7} /></span>
    <span class="tool-copy"><strong>{tool.name}{#if installed && !installed.enabled}<small class="disabled-label">已停用</small>{/if}</strong><span>{tool.description}</span></span>
    {#if installed && !manage}<ArrowRight size={16} class="open-arrow" />{/if}
  </button>
  <div class="tool-actions">
    {#if manage && installed}
      <label class="toggle" title={installed.enabled ? '停用工具' : '启用工具'}>
        <input type="checkbox" aria-label={`启用${tool.name}`} checked={installed.enabled} disabled={locked} onchange={onenabled} /><span></span>
      </label>
      <button class="icon-button danger" onclick={onuninstall} disabled={locked} title="卸载工具" aria-label={`卸载${tool.name}`}><Trash2 size={17} /></button>
    {:else if installed}
      <button class:starred={installed.favorite} class="icon-button favorite-button" title={installed.favorite ? '取消收藏' : '收藏工具'} aria-label={`${installed.favorite ? '取消收藏' : '收藏'}${tool.name}`} aria-pressed={installed.favorite} onclick={onfavorite} disabled={locked}><Star size={17} fill={installed.favorite ? 'currentColor' : 'none'} /></button>
    {:else}
      <button class="button install-button" onclick={oninstall} disabled={locked}>
        {#if busy}<LoaderCircle size={15} class="spinning" />安装中{:else}<Download size={15} />安装{/if}
      </button>
    {/if}
    <button class="icon-button detail-button" onclick={ondetail} title="工具详情" aria-label={`${tool.name}详情`}><Info size={16} /></button>
  </div>
</article>
