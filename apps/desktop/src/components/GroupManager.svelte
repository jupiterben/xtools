<script lang="ts">
  import { Check, FolderPlus, Pencil, Trash2, X } from 'lucide-svelte';
  import type { Snapshot } from '@xtools/tool-sdk';
  import { bridge } from '../lib/bridge';
  import Modal from './Modal.svelte';

  let { snapshot, onupdate, onclose }: {
    snapshot: Snapshot; onupdate: (value: Snapshot) => void; onclose: () => void;
  } = $props();
  let name = $state('');
  let editing = $state<string | null>(null);
  let editName = $state('');
  let deleting = $state<string | null>(null);
  let pending = $state(false);
  let error = $state('');
  async function save(action: () => Promise<Snapshot>) {
    if (pending) return;
    pending = true;
    error = '';
    try {
      onupdate(await action());
      name = '';
      editing = null;
      deleting = null;
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { pending = false; }
  }
</script>

<Modal title="管理分组" onclose={() => { if (!pending) onclose(); }}>
  <form class="group-create" onsubmit={(event) => { event.preventDefault(); void save(() => bridge.createGroup(name)); }}>
    <label class="sr-only" for="new-group-name">新分组名称</label>
    <input id="new-group-name" bind:value={name} placeholder="新分组名称" maxlength="80" required disabled={pending} />
    <button class="button primary" type="submit" disabled={pending || !name.trim()}><FolderPlus size={16} />新建</button>
  </form>
  {#if error}<p class="group-error" role="alert">{error}</p>{/if}
  <div class="group-list">
    {#each snapshot.groups as group (group.id)}
      <div class="group-row">
        {#if editing === group.id}
          <form class="group-edit" onsubmit={(event) => { event.preventDefault(); void save(() => bridge.renameGroup(group.id, editName)); }}>
            <input aria-label={`重命名${group.name}`} bind:value={editName} maxlength="80" required disabled={pending} />
            <button class="icon-button" type="submit" title="保存名称" aria-label="保存名称" disabled={pending || !editName.trim()}><Check size={16} /></button>
            <button class="icon-button" type="button" title="取消重命名" aria-label="取消重命名" onclick={() => editing = null} disabled={pending}><X size={16} /></button>
          </form>
        {:else}
          <span class="group-row-name">{group.name}</span>
          <span class="muted">{snapshot.installed.filter((tool) => tool.groupId === group.id).length}</span>
          <button class="icon-button" title={`重命名${group.name}`} aria-label={`重命名${group.name}`} disabled={pending} onclick={() => { editing = group.id; editName = group.name; deleting = null; error = ''; }}><Pencil size={16} /></button>
          <button class="icon-button danger" title={`删除${group.name}`} aria-label={`删除${group.name}`} disabled={pending} onclick={() => { deleting = group.id; error = ''; }}><Trash2 size={16} /></button>
        {/if}
        {#if deleting === group.id}
          <div class="group-delete">
            <p>删除「{group.name}」？组内工具将移至未分组，不会卸载。</p>
            <div class="group-delete-actions">
              <button class="button secondary" onclick={() => deleting = null} disabled={pending}>取消</button>
              <button class="button destructive" onclick={() => save(() => bridge.deleteGroup(group.id))} disabled={pending}>确认删除分组</button>
            </div>
          </div>
        {/if}
      </div>
    {:else}
      <p class="muted group-empty">暂无自定义分组</p>
    {/each}
  </div>
</Modal>
