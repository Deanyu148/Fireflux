<script lang="ts">
	import { getContext } from 'svelte'
	import { pinyin } from 'pinyin-pro'
	import DragBar from './DragBar.svelte'
	import MarkdownPreview from './MarkdownPreview.svelte'
	import type { ContentItem } from '../lib/api'
	import { errMsg } from '../lib/err'

	interface Props {
		folder: 'posts' | 'projects' | 'spec'
		title: string
		icon?: string
		canCreate?: boolean
		createKind?: 'post' | 'project'
		createLabel?: string
		canImage?: boolean
		hint?: string
	}
	let { folder, title, icon = '📄', canCreate = false, createKind, createLabel = '新建', canImage = false, hint = '' }: Props = $props()

	let items = $state<ContentItem[]>([])
	let active = $state('')
	let text = $state('')
	let dirty = $state(false)
	let busy = $state(false)
	let showNew = $state(false)
	let newTitle = $state('')
	let newSlug = $state('')
	let filter = $state('')
	let viewMode = $state<'edit' | 'split' | 'preview'>('preview')
	// 中间那条分隔条调的是「编辑器宽度」，列表吃掉剩下的空间（列表 flex:1、编辑器定宽）。
	// 这样两条分隔条互不干扰：拖侧栏那条只动列表的左边界，编辑器右对齐、宽度不变，
	// 于是中间那条分界线纹丝不动；拖中间那条只动分界线，侧栏那条也不动
	let editorW = $state(Number(localStorage.getItem('ff.editor-w')) || 560)
	function setEditorW(w: number): void {
		editorW = w
	}
	function persistEditorW(w: number): void {
		localStorage.setItem('ff.editor-w', String(w))
	}

	const notify = getContext<(m: string, ok?: boolean) => void>('notify')

	async function load(): Promise<void> {
		try {
			items = await window.api.contentList(folder)
		} catch (e) {
			notify(errMsg(e), false)
		}
	}
	$effect(() => {
		void load()
	})

	async function open(rel: string): Promise<void> {
		if (dirty && !confirm('当前内容未保存，确定切换？')) return
		try {
			text = await window.api.fileRead(rel)
			active = rel
			dirty = false
		} catch (e) {
			notify(errMsg(e), false)
		}
	}

	async function save(): Promise<void> {
		if (!active) return
		busy = true
		try {
			await window.api.fileWrite(active, text)
			dirty = false
			notify('已保存到本地文件')
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			busy = false
		}
	}

	async function remove(): Promise<void> {
		if (!active || !confirm(`确定删除 ${active} 吗？删除后需在「发布上线」推送才生效。`)) return
		try {
			await window.api.fileDelete(active)
			active = ''
			text = ''
			dirty = false
			await load()
			notify('已删除')
		} catch (e) {
			notify(errMsg(e), false)
		}
	}

	function makeSlug(t: string): string {
		const s = pinyin(t, { toneType: 'none', type: 'array' })
			.join('-')
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, '-')
			.replace(/-{2,}/g, '-')
			.replace(/^-+|-+$/g, '')
		return s || 'untitled'
	}

	async function create(): Promise<void> {
		if (!createKind) return
		busy = true
		try {
			const rel = await window.api.contentCreate({
				folder,
				kind: createKind,
				title: newTitle || '未命名',
				slug: newSlug.trim() || makeSlug(newTitle || 'untitled')
			})
			showNew = false
			newTitle = ''
			newSlug = ''
			await load()
			await open(rel)
			notify('已创建，写完记得「发布上线」推送')
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			busy = false
		}
	}

	async function importFiles(): Promise<void> {
		try {
			const rels = await window.api.contentImport(folder)
			if (rels.length) {
				notify(`已复制 ${rels.length} 个文件到 src/content/${folder}/`)
				await load()
			}
		} catch (e) {
			notify(errMsg(e), false)
		}
	}

	async function addImage(): Promise<void> {
		if (!active) {
			notify('先从左侧打开一篇文章，再插入图片', false)
			return
		}
		try {
			const refs = await window.api.assetImport('post-image')
			if (!refs.length) return
			text += refs.map((r) => `\n![](${r})`).join('')
			dirty = true
			notify(`图片已复制到 src/content/posts/images/，引用追加到文末（${refs.length} 张）`)
		} catch (e) {
			notify(errMsg(e), false)
		}
	}

	const filtered = $derived(items.filter((i) => !filter || i.rel.toLowerCase().includes(filter.toLowerCase())))
</script>

<div class="cm-page">
<div class="row" style="justify-content:space-between; margin-bottom:10px">
	<h2 style="margin:0">{icon} {title}</h2>
	<div class="row">
		{#if canImage}
			<button class="btn" onclick={addImage}>📂 插入本地图片</button>
		{/if}
		<button class="btn" onclick={importFiles}>📥 从磁盘导入</button>
		{#if canCreate}
			<button class="btn primary" onclick={() => (showNew = !showNew)}>＋ {createLabel}</button>
		{/if}
	</div>
</div>
{#if hint}<p class="muted" style="margin-top:0">{hint}</p>{/if}

<!-- 三个视图模式里重复出现的两个块（编辑框 / 预览），抽成 snippet 保持一致 -->
{#snippet editor()}
	<textarea class="code" rows="22" bind:value={text} oninput={() => (dirty = true)}></textarea>
{/snippet}
{#snippet preview()}
	<MarkdownPreview content={text} rel={active} isMdx={active.toLowerCase().endsWith('.mdx')} />
{/snippet}

{#if showNew && canCreate}
	<div class="card" style="margin-bottom:12px">
		<h3>{createLabel}</h3>
		<div class="row">
			<input placeholder="标题" bind:value={newTitle} style="max-width:300px" oninput={() => (newSlug = makeSlug(newTitle))} />
			<input placeholder="文件名 / slug（自动生成，可改）" bind:value={newSlug} style="max-width:300px" />
			<button class="btn primary" onclick={create} disabled={busy}>创建</button>
		</div>
		<p class="hint">标题中文会自动转拼音作为文件名和 slug（与博客 new-post 脚本行为一致）。</p>
	</div>
{/if}

<div class="cm-layout">
	<div class="card cm-list">
		<input placeholder="搜索文件…" bind:value={filter} style="margin-bottom:8px" />
		{#each filtered as it}
			<button class="cm-item" class:active={active === it.rel} onclick={() => open(it.rel)} title={it.rel}>
				{it.rel.replace(`src/content/${folder}/`, '')}
			</button>
		{/each}
		{#if !filtered.length}<p class="muted">（空）</p>{/if}
	</div>
	<!-- side="left"：手柄在编辑器左侧，往左拖才是把编辑器拖宽（分界线始终跟手） -->
	<DragBar side="left" width={editorW} onresize={setEditorW} onfinish={persistEditorW} min={320} max={860} />
	<div class="card cm-editor" style="width:{editorW}px">
		{#if active}
			<div class="row" style="justify-content:space-between; margin-bottom:8px">
				<code style="font-size:12.5px">{active}</code>
				<div class="row">
					<div class="row seg">
						<button class="btn small" class:primary={viewMode === 'edit'} onclick={() => (viewMode = 'edit')}>✏️ 编辑</button>
						<button class="btn small" class:primary={viewMode === 'split'} onclick={() => (viewMode = 'split')}>⬒ 分屏</button>
						<button class="btn small" class:primary={viewMode === 'preview'} onclick={() => (viewMode = 'preview')}>👁 预览</button>
					</div>
					{#if dirty}<span class="tag" style="background:#fff3cd; color:#8a6d3b">未保存</span>{/if}
					<button class="btn" onclick={remove}>删除</button>
					<button class="btn primary" onclick={save} disabled={!dirty || busy}>保存</button>
				</div>
			</div>
			{#if viewMode === 'edit'}
				{@render editor()}
			{:else if viewMode === 'split'}
				<div class="split">
					{@render editor()}
					{@render preview()}
				</div>
			{:else}
				<div class="solo-preview">
					{@render preview()}
				</div>
			{/if}
		{:else}
			<p class="muted">从左侧选择文件开始编辑；或导入/新建。</p>
		{/if}
	</div>
</div>
</div>

<style>
	.cm-page {
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: 12px;
		box-sizing: border-box;
	}
	.cm-layout {
		flex: 1;
		min-height: 0;
		display: flex;
		gap: 14px;
		align-items: stretch;
	}
	.cm-list {
		/* 列表吃掉剩余宽度：拖侧栏那条分隔条时只有它的宽度变化，
		   右边界（也就是中间分界线）跟着编辑器一起钉在右边不动 */
		flex: 1 1 240px;
		min-width: 160px;
		height: 100%;
		overflow: auto;
		box-sizing: border-box;
	}
	.cm-item {
		display: block;
		width: 100%;
		text-align: left;
		border: none;
		background: transparent;
		border-radius: 8px;
		padding: 7px 10px;
		font-size: 13px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--text);
	}
	.cm-item:hover {
		background: #f3f8f8;
		color: var(--accent);
	}
	.cm-item.active {
		background: var(--accent-soft);
		color: var(--accent);
		font-weight: 600;
	}
	.cm-editor {
		/* 宽度由中间那条分隔条控制（width 内联），窗口太窄时允许被压缩到 min-width */
		flex-shrink: 1;
		min-width: 300px;
		min-height: 0;
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
		overflow: hidden;
	}
	.cm-editor > .row {
		flex-shrink: 0;
	}
	.cm-editor textarea.code {
		flex: 1;
		min-height: 0;
	}
	.split {
		flex: 1;
		min-height: 0;
		display: flex;
		gap: 12px;
	}
	.split textarea {
		flex: 1;
		min-width: 0;
		height: 100%;
		resize: none;
	}
	.split :global(.md-preview) {
		flex: 1;
		min-width: 0;
		border-left: 1px dashed var(--line);
		padding-left: 14px;
	}
	.solo-preview {
		flex: 1;
		min-height: 0;
	}
	.seg {
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 2px;
		gap: 2px;
	}
	.seg .btn {
		border: none;
	}
</style>
