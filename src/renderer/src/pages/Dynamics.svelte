<script lang="ts">
	import { getContext, onMount } from 'svelte'
	import MarkdownPreview from '../components/MarkdownPreview.svelte'
	import type { ConfigReadResult, NetworkFailure } from '../lib/api'
	import { errMsg } from '../lib/err'

	let tab = $state<'remote' | 'local'>('remote')
	let memosUrl = $state('')
	let memosEnabled = $state(true)
	let loaded = $state(false)

	let content = $state('')
	let pinned = $state(false)
	let location = $state('')
	let busy = $state(false)
	let previewOn = $state(false)

	// 内嵌网页的状态：加载中 / 已加载 / 主文档失败（失败时给出 URL 与错误码，而不是一片白）
	let wvEl = $state<HTMLElement | null>(null)
	let wvState = $state<'idle' | 'loading' | 'loaded' | 'failed'>('idle')
	let wvError = $state<{ url: string; code: number; desc: string } | null>(null)

	// 连接诊断：主进程收集的请求失败与证书错误（图片裂、接口断都会记在这里）
	let diagOpen = $state(false)
	let diagList = $state<NetworkFailure[]>([])

	const notify = getContext<(m: string, ok?: boolean) => void>('notify')

	async function loadDiagnostics(): Promise<void> {
		try {
			diagList = await window.api.webviewDiagnostics()
		} catch {
			/* 读不到就当没有记录 */
		}
	}

	/** 诊断面板展开时每 2 秒刷一次（图片是按需加载的，失败会随时冒出来） */
	$effect(() => {
		if (!diagOpen) return
		void loadDiagnostics()
		const timer = setInterval(() => void loadDiagnostics(), 2000)
		return () => clearInterval(timer)
	})

	/** 给 webview 挂加载事件：只做提示，不改加载行为 */
	$effect(() => {
		const el = wvEl
		if (!el) return
		const onStart = (): void => {
			wvState = 'loading'
			wvError = null
		}
		const onDone = (): void => {
			wvState = 'loaded'
			void loadDiagnostics()
		}
		type FailEvent = Event & { errorCode?: number; errorDescription?: string; validatedURL?: string; isMainFrame?: boolean }
		const onFail = (e: Event): void => {
			const d = e as FailEvent
			if (d.isMainFrame === false) return // 子框架失败由主进程的请求诊断负责
			wvState = 'failed'
			wvError = { url: d.validatedURL || memosUrl, code: d.errorCode ?? 0, desc: d.errorDescription ?? '' }
			void loadDiagnostics()
		}
		el.addEventListener('did-start-loading', onStart)
		el.addEventListener('did-finish-load', onDone)
		el.addEventListener('did-fail-load', onFail)
		return () => {
			el.removeEventListener('did-start-loading', onStart)
			el.removeEventListener('did-finish-load', onDone)
			el.removeEventListener('did-fail-load', onFail)
		}
	})

	function reloadWebview(): void {
		const el = wvEl as (HTMLElement & { reload?: () => void }) | null
		wvError = null
		wvState = 'loading'
		el?.reload?.()
	}

	/** 诊断文本：可直接贴给 AI 助手或自己排查 */
	const diagText = $derived(
		diagList.length
			? diagList
					.map(
						(f) =>
							`${f.at}  [${f.kind === 'certificate' ? '证书错误' : '请求失败'}]  ${f.error}  ${f.url}${f.count > 1 ? `  ×${f.count}` : ''}`
					)
					.join('\n')
			: '（暂无失败记录）'
	)

	async function copyDiagnostics(): Promise<void> {
		try {
			await navigator.clipboard.writeText(`Memos: ${memosUrl}\n${diagText}`)
			notify('诊断信息已复制')
		} catch {
			// 剪贴板不可用时也不用慌：下面的 pre 可以直接选中复制
			notify('复制失败，请直接选中下面的文本复制', false)
		}
	}

	// 默认 Tab 跟着博客配置走：开了 Memos 就默认远端，否则本地
	onMount(async () => {
		try {
			const res: ConfigReadResult = await window.api.configRead({
				rel: 'src/config/dynamicConfig.ts',
				kind: 'ts',
				exports: ['dynamicConfig']
			})
			if (res.kind !== 'ts') return
			const dyn = res.exports.find((x) => x.name === 'dynamicConfig')?.values as
				| { memos?: { enable?: boolean; apiUrl?: string } }
				| undefined
			if (dyn?.memos?.apiUrl) memosUrl = String(dyn.memos.apiUrl)
			memosEnabled = !!dyn?.memos?.enable
			tab = memosEnabled ? 'remote' : 'local'
		} catch {
			// 配置读不到（未绑定项目等）：按「没有远端数据源」处理，别让横幅出现没有依据的说明
			memosEnabled = false
			tab = 'remote'
		} finally {
			loaded = true
		}
	})

	async function addImage(): Promise<void> {
		try {
			const refs = await window.api.assetImport('dynamic-image')
			for (const r of refs) content = `${content.trimEnd()}\n\n![图片](${r})`
			if (refs.length) notify('图片已复制到项目 public/images/dynamic/')
		} catch (e) {
			notify(errMsg(e), false)
		}
	}

	async function importMd(): Promise<void> {
		try {
			const rels = await window.api.contentImport('dynamic')
			if (rels.length) notify(`已导入 ${rels.length} 个动态文件到 src/content/dynamic/`)
		} catch (e) {
			notify(errMsg(e), false)
		}
	}

	async function publish(): Promise<void> {
		if (!content.trim()) {
			notify('先写点什么再发布吧', false)
			return
		}
		busy = true
		try {
			await window.api.contentCreate({ folder: 'dynamic', kind: 'dynamic', content, pinned, location })
			notify('动态已保存到本地文件！打开「发布上线」页推送后才会出现在网站上。')
			content = ''
			pinned = false
			location = ''
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			busy = false
		}
	}
</script>

<div class="dyn-page">
	<div class="dyn-head">
		<h2>💬 动态发布</h2>
		{#if loaded && memosEnabled}
			<div class="card" style="background: var(--warn-bg); border-color: #f0dcb4">
				<p class="muted" style="margin:0">
					当前博客配置启用了 <b>Memos 远端数据源</b>，网页端发布的动态会实时显示；<b>本地动态文件默认不会显示在网站上</b>。
					想改用本地文件作为数据源，请到「配置中心 → 动态页面」关闭 memos.enable。
				</p>
			</div>
		{/if}
	</div>

	<div class="row" style="margin-bottom:12px">
		<button class="btn" class:primary={tab === 'remote'} onclick={() => (tab = 'remote')}>🌐 远端发布（Memos）</button>
		<button class="btn" class:primary={tab === 'local'} onclick={() => (tab = 'local')}>📝 本地发布（文件）</button>
	</div>

	{#if tab === 'remote'}
		{#if memosUrl}
			<div class="card web-card">
				<div class="row" style="justify-content:space-between; margin-bottom:8px">
					<code style="font-size:12.5px">{memosUrl}</code>
					<div class="row" style="gap:8px">
						{#if wvState === 'loading'}<span class="muted">加载中…</span>{/if}
						{#if wvState === 'loaded'}<span class="muted">已加载</span>{/if}
						{#if wvState === 'failed'}<span class="wv-fail">加载失败</span>{/if}
						<button class="btn small" onclick={reloadWebview}>↻ 重新加载</button>
						<button class="btn small" onclick={() => window.api.openExternal(memosUrl)}>↗ 在浏览器打开</button>
					</div>
				</div>
				{#if wvError}
					<div class="card wv-warn">
						无法加载 <code>{wvError.url}</code>：<b>{wvError.desc || '未知错误'}</b>（错误码 {wvError.code}）。
						服务没起来、地址写错、证书不受信任都会这样 —— 可以点右上角「在浏览器打开」用系统浏览器对照，或展开下面的「连接诊断」看具体是哪个请求失败了。
					</div>
				{/if}
				<webview bind:this={wvEl} src={memosUrl} allowpopups></webview>
				<div class="row" style="justify-content:space-between; margin-top:8px">
					<p class="hint" style="margin:0">首次使用请在页面里登录 Memos；登录状态会被记住。在这里发的动态网站实时可见。</p>
					<button class="btn small" onclick={() => (diagOpen = !diagOpen)}>
						{diagOpen ? '收起连接诊断' : `🔍 连接诊断${diagList.length ? `（${diagList.length}）` : ''}`}
					</button>
				</div>
				{#if diagOpen}
					<div class="diag">
						<div class="row" style="justify-content:space-between; margin-bottom:6px">
							<span class="muted">最近的加载失败（图片裂开、接口断连都会记在这里，最多 20 条）</span>
							<button class="btn small" onclick={copyDiagnostics}>复制</button>
						</div>
						<pre>{diagText}</pre>
					</div>
				{/if}
			</div>
		{:else}
			<div class="card" style="background: var(--warn-bg); border-color: #f0dcb4">
				<b>还没有配置远端动态服务地址</b>
				<p class="muted">到「配置中心 → 动态页面」把 memos.apiUrl 填好后，这里就会内嵌显示远端发布页。</p>
			</div>
		{/if}
	{:else}
		<div class="card local-card">
			<h3>新建本地动态</h3>
			<textarea rows="8" placeholder="写点什么… 支持 Markdown 语法；图片用下方按钮插入" bind:value={content}></textarea>
			<div class="row" style="margin-top:10px">
				<label class="row" style="gap:6px">
					<input type="checkbox" bind:checked={pinned} style="width:auto" /> 置顶
				</label>
				<input placeholder="位置（可选，如：皮诺康尼）" bind:value={location} style="max-width:220px" />
			</div>
			<div class="row" style="margin-top:12px">
				<button class="btn primary" onclick={publish} disabled={busy}>保存动态文件</button>
				<button class="btn" onclick={addImage}>📂 插入本地图片</button>
				<button class="btn" onclick={importMd}>📥 从磁盘导入 md 文件</button>
				<button class="btn" class:primary={previewOn} onclick={() => (previewOn = !previewOn)}>
					{previewOn ? '关闭预览' : '👁 预览效果'}
				</button>
			</div>
			{#if previewOn}
				<div class="dyn-preview card">
					<MarkdownPreview content={content || '（还没有内容）'} rel="src/content/dynamic/preview.md" />
				</div>
			{/if}
			<p class="hint">保存 = 在 src/content/dynamic/ 生成按时间命名的 md 文件；去「发布上线」页推送后生效。</p>
		</div>
	{/if}
</div>

<style>
	.dyn-page {
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: 12px;
		box-sizing: border-box;
	}
	.dyn-head {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.dyn-head h2 {
		margin: 0;
	}
	.web-card {
		flex: 1;
		min-height: 320px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		box-sizing: border-box;
	}
	.local-card {
		overflow: auto;
	}
	.wv-fail {
		color: var(--danger);
		font-weight: 600;
	}
	.wv-warn {
		background: var(--warn-bg);
		border-color: #f0dcb4;
		margin-bottom: 8px;
		line-height: 1.6;
	}
	.diag {
		margin-top: 8px;
		max-height: 170px;
		overflow: auto;
		border-top: 1px dashed var(--line);
		padding-top: 8px;
	}
	.diag pre {
		margin: 0;
		font-family: var(--mono);
		font-size: 12px;
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-all;
		user-select: text;
	}
	webview {
		flex: 1;
		width: 100%;
		min-height: 0;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #fff;
	}
	.dyn-preview {
		margin-top: 12px;
		flex: 1;
		min-height: 260px;
		overflow: auto;
	}
</style>
