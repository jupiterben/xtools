<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ArrowLeft, ArrowRight, Box, Star, Settings2, Search, ShieldCheck, Download, Trash2, LoaderCircle, CircleCheck, CircleAlert, History, X, RefreshCw, Monitor, Sun, Moon, Check, SlidersHorizontal } from 'lucide-svelte';
  import { catalog as bundledCatalog, categories } from '@xtools/tool-manifest';
  import type { Category, Snapshot, ToolId, ToolManifest, Settings } from '@xtools/tool-sdk';
  import { bridge, desktopMode } from './lib/bridge';
  import { toolIcons } from './lib/icons';
  import ToolCard from './components/ToolCard.svelte';
  import ToolRunner from './components/ToolRunner.svelte';
  import Modal from './components/Modal.svelte';
  import { cachedCatalog, fetchCatalog, latestReleases, marketUrl } from './lib/market';

  type Page = 'workspace' | 'market' | 'tasks' | 'settings';
  const pages = { workspace: '我的工具', market: '工具市场', tasks: '任务记录', settings: '设置' };
  let page = $state<Page>('workspace');
  let snapshot = $state<Snapshot>({ installed: [], tasks: [], settings: { theme: 'light', confirmUninstall: true } });
  let loading = $state(true);
  let fatalError = $state('');
  let search = $state('');
  let category = $state<Category>('全部工具');
  let favoritesOnly = $state(false);
  let managing = $state(false);
  let busy = $state<ToolId | null>(null);
  let notice = $state<{ text: string; error: boolean } | null>(null);
  let active = $state<{ tool: ToolManifest; html: string } | null>(null);
  let detail = $state<ToolManifest | null>(null);
  let uninstallId = $state<ToolId | null>(null);
  let systemDark = $state(false);
  let marketTools = $state<ToolManifest[]>([]);
  let marketLoading = $state(false);
  let marketError = $state('');
  let marketLoaded = $state(false);
  let noticeTimer: ReturnType<typeof setTimeout>;
  let searchInput = $state<HTMLInputElement>();
  const theme = $derived(snapshot.settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : snapshot.settings.theme);
  const installedMap = $derived(new Map(snapshot.installed.map((tool) => [tool.id, tool])));
  const isLibrary = $derived(page === 'workspace');
  const catalog = $derived(isLibrary ? snapshot.installed.map((tool) =>
    tool.manifest ?? bundledCatalog.find((item) => item.id === tool.id) ?? fallbackTool(tool.id)) : marketTools);
  function fallbackTool(id: string): ToolManifest {
    return { id, name: id, subtitle: '', description: '', category: '开发辅助', version: '1.0.0', color: 'teal', permissions: [], tags: [] };
  }
  function getTool(id: string): ToolManifest {
    return snapshot.installed.find((tool) => tool.id === id)?.manifest
      ?? marketTools.find((tool) => tool.id === id) ?? bundledCatalog.find((tool) => tool.id === id) ?? fallbackTool(id);
  }
  async function refreshMarket() {
    if (marketLoading) return;
    marketLoading = true;
    marketError = '';
    const cached = cachedCatalog();
    if (!marketLoaded && cached) marketTools = latestReleases(cached).map((release) => release.manifest);
    try {
      marketTools = latestReleases((await fetchCatalog()).catalog).map((release) => release.manifest);
      marketLoaded = true;
    } catch (error) { marketError = error instanceof Error ? error.message : String(error); }
    finally { marketLoading = false; }
  }
  const filtered = $derived.by(() => {
    const term = search.trim().toLowerCase();
    const tools = catalog.filter((tool) => {
      const installed = installedMap.get(tool.id);
      if (isLibrary && (!installed || (favoritesOnly && !installed.favorite))) return false;
      return (isLibrary || category === '全部工具' || tool.category === category)
        && (!term || `${tool.name} ${tool.subtitle} ${tool.description} ${tool.tags.join(' ')}`.toLowerCase().includes(term));
    });
    if (isLibrary) tools.sort((a, b) => {
      const first = installedMap.get(a.id)!;
      const second = installedMap.get(b.id)!;
      return Number(second.favorite) - Number(first.favorite)
        || (second.lastOpenedAt ?? 0) - (first.lastOpenedAt ?? 0);
    });
    return tools;
  });
  $effect(() => { document.documentElement.dataset.theme = theme; });

  function notify(text: string, error = false) {
    notice = { text, error };
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice = null; }, error ? 6000 : 3000);
  }
  async function initialize() {
    loading = true;
    fatalError = '';
    try { snapshot = await bridge.snapshot(); }
    catch (error) { fatalError = error instanceof Error ? error.message : String(error); }
    finally { loading = false; }
  }
  onMount(() => {
    void initialize();
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    systemDark = query.matches;
    const listener = (event: MediaQueryListEvent) => { systemDark = event.matches; };
    query.addEventListener('change', listener);
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !active && !detail && !uninstallId) {
        event.preventDefault();
        searchInput?.focus();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => { query.removeEventListener('change', listener); window.removeEventListener('keydown', keydown); clearTimeout(noticeTimer); };
  });
  function navigate(next: Page) {
    page = next;
    active = null;
    search = '';
    category = '全部工具';
    favoritesOnly = false;
    managing = false;
    if (next === 'market') void refreshMarket();
  }
  async function backToTools() {
    const id = active?.tool.id;
    active = null;
    await tick();
    if (id) document.getElementById(`open-${id}`)?.focus();
  }
  function resetFilters() { search = ''; category = '全部工具'; favoritesOnly = false; }
  async function install(id: ToolId) {
    if (busy) return;
    busy = id;
    try { snapshot = await bridge.install(id); notify(`${getTool(id).name}已安装`); }
    catch (error) {
      notify(String(error), true);
      try { snapshot = await bridge.snapshot(); } catch { /* Keep the last usable snapshot. */ }
    }
    finally { busy = null; }
  }
  async function open(id: ToolId) {
    if (busy) return;
    busy = id;
    try {
      const result = await bridge.openTool(id);
      snapshot = result.snapshot;
      active = { tool: getTool(id), html: result.html };
      detail = null;
    } catch (error) { notify(String(error), true); }
    finally { busy = null; }
  }
  async function favorite(id: ToolId) {
    if (busy) return;
    busy = id;
    try { snapshot = await bridge.setFavorite(id, !installedMap.get(id)?.favorite); }
    catch (error) { notify(String(error), true); }
    finally { busy = null; }
  }
  async function enabled(id: ToolId) {
    if (busy) return;
    busy = id;
    try { snapshot = await bridge.setEnabled(id, !installedMap.get(id)?.enabled); }
    catch (error) { notify(String(error), true); }
    finally { busy = null; }
  }
  async function uninstall(id: ToolId) {
    if (busy) return;
    busy = id;
    if (active?.tool.id === id) active = null;
    try {
      snapshot = await bridge.uninstall(id);
      uninstallId = null;
      detail = null;
      notify(`${getTool(id).name}已卸载`);
    } catch (error) { notify(String(error), true); }
    finally { busy = null; }
  }
  function requestUninstall(id: ToolId) {
    if (snapshot.settings.confirmUninstall) { detail = null; uninstallId = id; }
    else void uninstall(id);
  }
  async function settings(value: Partial<Settings>) {
    try { snapshot = await bridge.saveSettings({ ...snapshot.settings, ...value }); }
    catch (error) { notify(String(error), true); }
  }
  async function clearTasks() {
    try { snapshot = await bridge.clearTasks(); notify('任务记录已清空'); }
    catch (error) { notify(String(error), true); }
  }
  function date(value: number) {
    return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(value);
  }
</script>

<svelte:head><title>{active ? active.tool.name : pages[page]} · XTools</title></svelte:head>
<a class="skip-link" href="#main-content">跳到主内容</a>
<div class="app-shell">
  <header class="app-header">
    <div class="header-inner">
      <a class="brand" href="#workspace" onclick={(event) => { event.preventDefault(); navigate('workspace'); }} aria-label="XTools 我的工具">
        <img src="/favicon.png" alt="" width="28" height="28" /><span>XTools</span>
      </a>
      <nav class="main-nav" aria-label="主导航">
        <button class:selected={isLibrary} aria-current={isLibrary ? 'page' : undefined} onclick={() => navigate('workspace')}>我的工具</button>
        <button class:selected={page === 'market'} aria-current={page === 'market' ? 'page' : undefined} onclick={() => navigate('market')}>工具市场</button>
      </nav>
      <nav class="utility-nav" aria-label="应用导航">
        <button class:chosen={page === 'tasks'} class="icon-button" title="任务记录" aria-label="任务记录" onclick={() => navigate('tasks')}><History size={18} /></button>
        <button class:chosen={page === 'settings'} class="icon-button" title="设置" aria-label="设置" onclick={() => navigate('settings')}><Settings2 size={18} /></button>
      </nav>
    </div>
  </header>

  <main id="main-content" class:tool-page={!!active}>
    {#if loading}
      <div class="empty-state" role="status"><LoaderCircle class="spinning" size={24} /><p>正在载入</p></div>
    {:else if fatalError}
      <div class="empty-state"><CircleAlert size={28} /><h1>工作空间未能载入</h1><p>{fatalError}</p><button class="button primary" onclick={initialize}><RefreshCw size={16} />重新尝试</button></div>
    {:else if active}
      {#key active.tool.id}<ToolRunner tool={active.tool} html={active.html} {theme} onback={backToTools} onerror={(message) => notify(message, true)} />{/key}
    {:else if isLibrary || page === 'market'}
      <div class="page-heading">
        <div class="heading-title"><h1>{pages[page]}</h1><span class="item-count">{isLibrary ? snapshot.installed.length : catalog.length}</span></div>
        {#if isLibrary}
          <button class:chosen={managing} class="button quiet" aria-pressed={managing} onclick={() => managing = !managing}>{#if managing}<Check size={16} />完成{:else}<SlidersHorizontal size={16} />管理{/if}</button>
        {:else}<span class="source-label"><ShieldCheck size={14} />官方市场<button class="icon-button" title="刷新市场" aria-label="刷新市场" onclick={refreshMarket} disabled={marketLoading}><RefreshCw size={15} class={marketLoading ? 'spinning' : ''} /></button></span>{/if}
      </div>

      <div class="search-bar">
        <div class="search-field">
          <Search size={19} />
          <input bind:this={searchInput} bind:value={search} aria-label="搜索工具" placeholder="搜索工具…"
            onkeydown={(event) => {
              if (event.key === 'Enter' && !event.isComposing && search.trim() && filtered.length === 1 && installedMap.get(filtered[0].id)?.enabled) {
                event.preventDefault();
                void open(filtered[0].id);
              }
            }} />
          {#if search}<button class="icon-button" onclick={() => { search = ''; searchInput?.focus(); }} title="清除搜索" aria-label="清除搜索"><X size={16} /></button>{/if}
        </div>
        {#if isLibrary}
          <button class:chosen={favoritesOnly} class="icon-button favorite-filter" aria-label="只看收藏" title="只看收藏" aria-pressed={favoritesOnly} onclick={() => favoritesOnly = !favoritesOnly}><Star size={18} fill={favoritesOnly ? 'currentColor' : 'none'} /></button>
        {:else}
          <select class="category-select" aria-label="工具分类" bind:value={category}>{#each categories as item}<option value={item}>{item}</option>{/each}</select>
        {/if}
      </div>

      {#if page === 'market' && marketError}<div class="market-error" role="alert">市场暂不可用{marketTools.length ? '，显示已验证的缓存目录' : ''}。<span>{marketError}</span><button class="text-button" onclick={refreshMarket}>重试</button></div>{/if}
      {#if page === 'market' && marketLoading && !marketTools.length}
        <div class="empty-state" role="status"><LoaderCircle class="spinning" size={24} /><p>正在加载市场</p></div>
      {:else if !filtered.length}
        <div class="empty-state">
          {#if search}<Search size={28} />{:else if favoritesOnly}<Star size={28} />{:else}<Box size={28} />{/if}
          <h2>{search ? '没有找到匹配的工具' : favoritesOnly ? '暂无收藏' : '暂无工具'}</h2>
          {#if search || favoritesOnly || category !== '全部工具'}
            <button class="button secondary" onclick={resetFilters}>重置筛选</button>
          {:else}<button class="button primary" onclick={() => navigate('market')}>浏览工具市场<ArrowRight size={15} /></button>{/if}
        </div>
      {:else}
        <div class="tool-grid" aria-label={isLibrary ? '已安装工具' : '市场工具'} role="group">
          {#each filtered as tool (tool.id)}
            <ToolCard {tool} installed={installedMap.get(tool.id)} busy={busy === tool.id} locked={!!busy} manage={isLibrary && managing}
              onopen={() => open(tool.id)} oninstall={() => install(tool.id)} onfavorite={() => favorite(tool.id)}
              ondetail={() => detail = tool} onenabled={() => enabled(tool.id)} onuninstall={() => requestUninstall(tool.id)} />
          {/each}
        </div>
      {/if}
      {#if isLibrary && filtered.length}
        <div class="list-footer"><button class="text-button" onclick={() => navigate('market')}>添加工具<ArrowRight size={15} /></button></div>
      {/if}
    {:else}
      <div class="page-heading">
        <div class="heading-title"><button class="icon-button" title="返回我的工具" aria-label="返回我的工具" onclick={() => navigate('workspace')}><ArrowLeft size={19} /></button><h1>{pages[page]}</h1></div>
        {#if page === 'tasks'}<button class="icon-button" title="清空记录" aria-label="清空记录" onclick={clearTasks} disabled={!snapshot.tasks.length || !!busy}><Trash2 size={17} /></button>{/if}
      </div>
      {#if page === 'tasks'}
        {#if snapshot.tasks.length}
          <div class="task-list">{#each snapshot.tasks as task (task.id)}
            <div class="task-row">
              <span class:error={task.status === 'failed'} class="task-status">{#if task.status === 'completed'}<CircleCheck size={19} />{:else}<CircleAlert size={19} />{/if}</span>
              <div><strong>{task.action === 'install' ? '安装' : '卸载'} {task.toolName ?? getTool(task.toolId).name}</strong><span>{task.message}</span></div>
              <span class="task-badge" class:failed={task.status === 'failed'}>{task.status === 'completed' ? '已完成' : '失败'}</span><time>{date(task.createdAt)}</time>
            </div>
          {/each}</div>
        {:else}<div class="empty-state"><History size={28} /><h2>暂无任务记录</h2></div>{/if}
      {:else}
        <section class="settings-section" aria-label="偏好设置">
          <div class="setting-row"><strong>外观</strong><div class="segmented" role="group" aria-label="主题模式">
            {#each [{ id: 'light', label: '浅色', icon: Sun }, { id: 'dark', label: '深色', icon: Moon }, { id: 'system', label: '系统', icon: Monitor }] as item}
              <button class:chosen={snapshot.settings.theme === item.id} aria-pressed={snapshot.settings.theme === item.id} onclick={() => settings({ theme: item.id as Settings['theme'] })}><item.icon size={16} />{item.label}</button>
            {/each}
          </div></div>
          <div class="setting-row"><strong>卸载前确认</strong><label class="toggle"><input type="checkbox" checked={snapshot.settings.confirmUninstall} onchange={(event) => settings({ confirmUninstall: event.currentTarget.checked })} aria-label="卸载前确认" /><span></span></label></div>
          <div class="setting-row"><strong>工具源</strong><span class="muted">{marketUrl}</span></div>
          <div class="setting-row"><strong>版本</strong><span class="muted" data-testid="runtime-mode">{desktopMode ? '桌面版' : '浏览器预览'} · 0.1.0</span></div>
        </section>
      {/if}
    {/if}
  </main>
</div>

{#if detail}
  <Modal title="工具详情" onclose={() => detail = null}>
    {@const Icon = toolIcons[detail.id]}{@const installed = installedMap.get(detail.id)}
    <div class="detail-identity"><span class="tool-icon {detail.color}"><Icon size={25} /></span><div><h3>{detail.name}</h3><span>v{detail.version} · {detail.category}</span></div></div>
    <p class="detail-description">{detail.description}</p>
    <div class="permission-summary"><ShieldCheck size={18} /><span>官方工具 · 无需系统权限 · 本地处理</span></div>
    <div class="modal-actions">
      {#if installed}
        <button class="button danger-outline" onclick={() => detail && requestUninstall(detail.id)} disabled={!!busy}><Trash2 size={15} />卸载</button>
        <button class="button primary" onclick={() => detail && open(detail.id)} disabled={!installed.enabled || !!busy}>{installed.enabled ? '打开工具' : '已停用'}<ArrowRight size={15} /></button>
      {:else}
        <button class="button primary" onclick={() => detail && install(detail.id)} disabled={!!busy}>{#if busy}<LoaderCircle class="spinning" size={15} />正在安装{:else}<Download size={15} />安装工具{/if}</button>
      {/if}
    </div>
  </Modal>
{/if}
{#if uninstallId}
  <Modal title="卸载工具" onclose={() => { if (!busy) uninstallId = null; }}>
    <p class="uninstall-copy">确定卸载 <strong>{getTool(uninstallId).name}</strong>？</p>
    <p class="muted">收藏和使用记录也会被移除。</p>
    <div class="modal-actions"><button class="button secondary" onclick={() => uninstallId = null} disabled={!!busy}>取消</button><button class="button destructive" onclick={() => uninstallId && uninstall(uninstallId)} disabled={!!busy}><Trash2 size={15} />确认卸载</button></div>
  </Modal>
{/if}
{#if notice}
  <div class:error={notice.error} class="toast" role={notice.error ? 'alert' : 'status'}>
    {#if notice.error}<CircleAlert size={18} />{:else}<CircleCheck size={18} />{/if}
    <span>{notice.text}</span><button class="icon-button" onclick={() => notice = null} title="关闭通知" aria-label="关闭通知"><X size={14} /></button>
  </div>
{/if}
