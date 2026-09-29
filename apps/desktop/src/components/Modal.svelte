<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { X } from 'lucide-svelte';
  let { title, children, onclose }: { title: string; children: Snippet; onclose: () => void } = $props();
  let dialog: HTMLDialogElement;
  onMount(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { previous?.focus(); };
  });
</script>
<dialog bind:this={dialog} oncancel={(event) => { event.preventDefault(); onclose(); }}>
  <div class="modal-heading"><h2>{title}</h2><button class="icon-button" onclick={onclose} aria-label="关闭" title="关闭"><X size={18} /></button></div>
  {@render children()}
</dialog>
