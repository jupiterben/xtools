<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ArrowLeft, ArrowRight, Box, Star, Settings2, Search, ShieldCheck, Download, Trash2, LoaderCircle, CircleCheck, CircleAlert, History, X, RefreshCw, Monitor, Sun, Moon, Check, SlidersHorizontal, FolderCog, FolderInput } from 'lucide-svelte';
  import { catalog as bundledCatalog, categories } from '@xtools/tool-manifest';
  import type { Category, Snapshot, ToolId, ToolManifest, Settings } from '@xtools/tool-sdk';
  import { bridge, desktopMode } from './lib/bridge';
  import { toolIcons } from './lib/icons';
  import ToolCard from './components/ToolCard.svelte';
  import ToolRunner from './components/ToolRunner.svelte';
  import Modal from './components/Modal.svelte';
  import GroupManager from './components/GroupManager.svelte';
  import { cachedCatalog, fetchCatalog, latestReleases, marketUrl } from './lib/market';
<<<<<<< Updated upstream
  import { version as appVersion } from '../package.json';
=======
  import { listenForInstallLinks, parseInstallLink } from './lib/deep-link';
>>>>>>> Stashed changes

  type Page = 'workspace' | 'market' | 'tasks' | 'settings';
  const pages = { workspace: '我的工具', market: '工具市场', tasks: '任务记录', settings: '设置' };
  let page = $state<Page>('workspace');
  let snapshot = $state<Snapshot>({ groups: [], installed: [], tasks: [], settings: { theme: 'light', confirmUninstall: true } });
  let loading = $state(true);
  let fatalError = $state('');
  let search = $state('');
  let category = $state<Category>('全部工具');
  let favoritesOnly = $state(false);
  let managing = $state(false);
  let groupFilter = $state('');
  let groupManager = $state(false);
  let selectedIds = $state<string[]>([]);
  let destinationGroup = $state('');
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
  let installLinkRequest = 0;
  let installLinkLoading = $state(false);
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
      if (isLibrary && groupFilter && (groupFilter === 'ungrouped' ? !!installed?.groupId : installed?.groupId !== groupFilter)) return false;
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
  const selectedTools = $derived(filtered.filter((tool) => selectedIds.includes(tool.id)).map((tool) => tool.id));
  const groupCounts = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const tool of snapshot.installed) {
      const id = tool.groupId ?? 'ungrouped';
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
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
  async function receiveInstallLinks(urls: string[]) {
    const id = urls.map(parseInstallLink).find((value) => value !== null);
    if (!id) { notify('无效的工具安装链接', true); return; }
    if (busy || groupManager) { notify('请等待当前操作完成后，再从网页打开安装链接', true); return; }
    const request = ++installLinkRequest;
    notice = null;
    detail = null;
    uninstallId = null;
    active = null;
    page = 'market';
    resetFilters();
    managing = false;
    installLinkLoading = true;
    try {
      const releases = latestReleases((await fetchCatalog()).catalog);
      if (request !== installLinkRequest) return;
      marketTools = releases.map((release) => release.manifest);
      marketLoaded = true;
      marketError = '';
      const tool = marketTools.find((item) => item.id === id);
      if (!tool) throw new Error('工具不在受信任的市场目录中');
      detail = tool;
    } catch (error) {
      if (request === installLinkRequest) notify(String(error), true);
    } finally {
      if (request === installLinkRequest) installLinkLoading = false;
    }
  }
  onMount(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      await initialize();
      if (!desktopMode || disposed) return;
      try {
        const stop = await listenForInstallLinks((urls) => {
          if (!disposed) void receiveInstallLinks(urls);
        });
        if (disposed) stop();
        else unlisten = stop;
      } catch (error) { if (!disposed) notify(`无法接收网页安装请求：${String(error)}`, true); }
    })();
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    systemDark = query.matches;
    const listener = (event: MediaQueryListEvent) => { systemDark = event.matches; };
    query.addEventListener('change', listener);
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !active && !detail && !uninstallId && !groupManager) {
        event.preventDefault();
        searchInput?.focus();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => {
      disposed = true;
      installLinkRequest++;
      unlisten?.();
      query.removeEventListener('change', listener);
      window.removeEventListener('keydown', keydown);
      clearTimeout(noticeTimer);
    };
  });
  function navigate(next: Page) {
    installLinkRequest++;
    installLinkLoading = false;
    page = next;
    active = null;
    search = '';
    category = '全部工具';
    favoritesOnly = false;
    managing = false;
    selectedIds = [];
    if (next === 'market') void refreshMarket();
  }
  async function backToTools() {
    const id = active?.tool.id;
    active = null;
    await tick();
    if (id) document.getElementById(`open-${id}`)?.focus();
  }
  function resetFilters() { search = ''; category = '全部工具'; favoritesOnly = false; groupFilter = ''; selectedIds = []; }
  function updateGroups(value: Snapshot) {
    snapshot = value;
    if (groupFilter !== 'ungrouped' && !snapshot.groups.some((group) => group.id === groupFilter)) groupFilter = '';
    if (!snapshot.groups.some((group) => group.id === destinationGroup)) destinationGroup = '';
  }
  async function moveSelected() {
    if (busy || !selectedTools.length) return;
    busy = ':groups';
    try {
      const count = selectedTools.length;
      snapshot = await bridge.setToolGroup(selectedTools, destinationGroup || null);
      selectedIds = [];
      notify(`已移动 ${count} 个工具`);
    } catch (error) { notify(String(error), true); }
    finally { busy = null; }
  }
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

  <main id="main-content" class:tool-page={!!active} class:library-page={!active && (isLibrary || page === 'market')}>
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
          <div class="library-actions">
            <button class="icon-button" title="管理分组" aria-label="管理分组" disabled={!!busy} onclick={() => groupManager = true}><FolderCog size={18} /></button>
            <button class:chosen={managing} class="button quiet" aria-pressed={managing} disabled={!!busy} onclick={() => { managing = !managing; selectedIds = []; }}>{#if managing}<Check size={16} />完成{:else}<SlidersHorizontal size={16} />管理{/if}</button>
          </div>
        {:else}<span class="source-label"><ShieldCheck size={14} />官方市场<button class="icon-button" title="刷新市场" aria-label="刷新市场" onclick={refreshMarket} disabled={marketLoading}><RefreshCw size={15} class={marketLoading ? 'spinning' : ''} /></button></span>{/if}
      </div>

      <div class="search-bar">
        <div class="search-field">
          <Search size={19} />
          <input bind:this={searchInput} bind:value={search} aria-label="搜索工具" placeholder="搜索工具…" oninput={() => selectedIds = []}
            onkeydown={(event) => {
              if (event.key === 'Enter' && !event.isComposing && search.trim() && filtered.length === 1 && installedMap.get(filtered[0].id)?.enabled) {
                event.preventDefault();
                void open(filtered[0].id);
              }
            }} />
          {#if search}<button class="icon-button" onclick={() => { search = ''; searchInput?.focus(); }} title="清除搜索" aria-label="清除搜索"><X size={16} /></button>{/if}
        </div>
        {#if isLibrary}
          <select class="category-select group-filter" aria-label="工具分组" bind:value={groupFilter} onchange={() => selectedIds = []}>
            <option value="">全部工具 ({snapshot.installed.length})</option>
            <option value="ungrouped">未分组 ({groupCounts.get('ungrouped') ?? 0})</option>
            {#each snapshot.groups as group (group.id)}<option value={group.id}>{group.name} ({groupCounts.get(group.id) ?? 0})</option>{/each}
          </select>
          <button class:chosen={favoritesOnly} class="icon-button favorite-filter" aria-label="只看收藏" title="只看收藏" aria-pressed={favoritesOnly} onclick={() => { favoritesOnly = !favoritesOnly; selectedIds = []; }}><Star size={18} fill={favoritesOnly ? 'currentColor' : 'none'} /></button>
        {:else}
          <select class="category-select" aria-label="工具分类" bind:value={category}>{#each categories as item}<option value={item}>{item}</option>{/each}</select>
        {/if}
      </div>

      {#if isLibrary && managing}
        <div class="group-bulk" role="group" aria-label="批量分组">
          <label><input type="checkbox" aria-label="选择当前结果" checked={!!filtered.length && selectedTools.length === filtered.length} indeterminate={selectedTools.length > 0 && selectedTools.length < filtered.length} disabled={!!busy || !filtered.length} onchange={(event) => selectedIds = event.currentTarget.checked ? filtered.map((tool) => tool.id) : []} />全选</label>
          <span class="muted">已选 {selectedTools.length} 项</span>
          <select aria-label="目标分组" bind:value={destinationGroup} disabled={!!busy}>
            <option value="">未分组</option>
            {#each snapshot.groups as group (group.id)}<option value={group.id}>{group.name}</option>{/each}
          </select>
          <button class="button secondary" disabled={!!busy || !selectedTools.length} onclick={moveSelected}><FolderInput size={16} />移动到分组</button>
        </div>
      {/if}

      {#if page === 'market' && marketError}<div class="market-error" role="alert">市场暂不可用{marketTools.length ? '，显示已验证的缓存目录' : ''}。<span>{marketError}</span><button class="text-button" onclick={refreshMarket}>重试</button></div>{/if}
      {#if page === 'market' && (installLinkLoading || (marketLoading && !marketTools.length))}
        <div class="empty-state" role="status"><LoaderCircle class="spinning" size={24} /><p>正在加载市场</p></div>
      {:else if !filtered.length}
        <div class="empty-state">
          {#if search}<Search size={28} />{:else if favoritesOnly}<Star size={28} />{:else}<Box size={28} />{/if}
          <h2>{search ? '没有找到匹配的工具' : favoritesOnly ? '暂无收藏' : groupFilter ? '此分组暂无工具' : '暂无工具'}</h2>
          {#if search || favoritesOnly || category !== '全部工具' || groupFilter}
            <button class="button secondary" onclick={resetFilters}>重置筛选</button>
          {:else}<button class="button primary" onclick={() => navigate('market')}>浏览工具市场<ArrowRight size={15} /></button>{/if}
        </div>
      {:else}
        <div class="tool-grid" aria-label={isLibrary ? '已安装工具' : '市场工具'} role="group">
          {#each filtered as tool (tool.id)}
            <ToolCard {tool} installed={installedMap.get(tool.id)} busy={busy === tool.id} locked={!!busy} manage={isLibrary && managing}
              selected={selectedTools.includes(tool.id)} onselect={() => selectedIds = selectedIds.includes(tool.id) ? selectedIds.filter((id) => id !== tool.id) : [...selectedIds, tool.id]}
              groupName={isLibrary ? snapshot.groups.find((group) => group.id === installedMap.get(tool.id)?.groupId)?.name : undefined}
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
          <div class="setting-row"><strong>版本</strong><span class="muted" data-testid="runtime-mode">{desktopMode ? '桌面版' : '浏览器预览'} · {appVersion}</span></div>
        </section>
      {/if}
    {/if}
  </main>
</div>

{#if groupManager}
  <GroupManager {snapshot} onupdate={updateGroups} onclose={() => groupManager = false} />
{/if}

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
