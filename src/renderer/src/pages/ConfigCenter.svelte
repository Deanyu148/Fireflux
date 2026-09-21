<script lang="ts">
	import { getContext, onMount } from 'svelte'
	import DragBar from '../components/DragBar.svelte'
	import FormKit from '../components/FormKit.svelte'
	import type { ConfigExportData, ConfigReadResult, DiscoveredConfig } from '../lib/api'
	import { errMsg, plain } from '../lib/err'
	import { SCHEMAS } from '../lib/schemas/configs'
	import type { FieldDef } from '../lib/schema-types'
	import { CONFIG_REGISTRY } from '../../../shared/registry'

	interface DisplayEntry {
		rel: string
		kind: 'ts' | 'html'
		exports: string[]
		title: string
		desc: string
		group: string
	}

	let discovered = $state<DiscoveredConfig[]>([])
	let selectedRel = $state('')
	let rel = $state('')
	let isHtml = $state(false)
	let htmlContent = $state('')
	let exportsData = $state<ConfigExportData[]>([])
	let activeExport = $state(0)
	let originalJson = $state('')
	let busy = $state(false)
	let search = $state('')
	let ccW = $state(Number(localStorage.getItem('ff.cc-w')) || 280)
	function setCcW(w: number): void {
		ccW = w
	}
	function persistCcW(w: number): void {
		localStorage.setItem('ff.cc-w', String(w))
	}

	const notify = getContext<(m: string, ok?: boolean) => void>('notify')

	const GROUP_ORDER = ['基础', '外观', '功能', '内容', '其他']
	const registryByRel = new Map(CONFIG_REGISTRY.map((e) => [e.rel, e]))
	const relToId = new Map(CONFIG_REGISTRY.map((e) => [e.rel, e.id]))

	/** 项目文件动态发现 + 注册表别名合并：新配置文件自动出现，删除的自动消失 */
	const entries = $derived.by(() => {
		const out: DisplayEntry[] = []
		for (const d of discovered) {
			const reg = registryByRel.get(d.rel)
			if (reg) {
				out.push({ rel: d.rel, kind: d.kind, exports: d.exports, title: reg.title, desc: reg.desc, group: reg.group })
			} else {
				const base = (d.rel.split('/').pop() ?? d.rel).replace(/\.(ts|html)$/i, '')
				out.push({ rel: d.rel, kind: d.kind, exports: d.exports, title: base, desc: d.rel, group: '其他' })
			}
		}
		return out
	})
	const filtered = $derived(entries.filter((e) => !search || e.title.includes(search) || e.desc.includes(search) || e.rel.includes(search)))
	// 分组标题按「搜索结果里还剩哪些组」生成，避免搜索时留下一堆空标题
	const groups = $derived.by(() => {
		const set = [...new Set(filtered.map((e) => e.group))]
		return set.sort((a, b) => {
			const ia = GROUP_ORDER.indexOf(a)
			const ib = GROUP_ORDER.indexOf(b)
			return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
		})
	})

	const selected = $derived(entries.find((e) => e.rel === selectedRel))
	const dirty = $derived(isHtml ? htmlContent !== originalJson : JSON.stringify(exportsData) !== originalJson)
	const currentSchema = $derived.by(() => {
		if (!selected || isHtml || !exportsData[activeExport]) return {}
		const id = relToId.get(selected.rel) ?? ''
		return SCHEMAS[id]?.[exportsData[activeExport].name] ?? {}
	})
	const rootDef = $derived<FieldDef | undefined>(buildRootDef(currentSchema, exportsData[activeExport]?.values))

	interface EntrySchemaView {
		fields?: FieldDef[]
		rootItem?: FieldDef[]
		rootTitleKey?: string
	}

	/** 一个导出对象对应一个表单：根是数组就渲染成列表，否则渲染成字段组 */
	function buildRootDef(schema: EntrySchemaView, values: unknown): FieldDef | undefined {
		if (Array.isArray(values)) return { k: '__root', w: 'list', item: schema.rootItem, titleKey: schema.rootTitleKey }
		return { k: '__root', w: 'group', fields: schema.fields }
	}

	onMount(async () => {
		try {
			discovered = await window.api.configDiscover()
		} catch (e) {
			notify(errMsg(e), false)
		}
	})

	async function open(entry: DisplayEntry): Promise<void> {
		try {
			// entry 来自响应式状态，参数必须在调用前转纯（contextBridge 无法克隆代理）
			const res: ConfigReadResult = await window.api.configRead(plain({ rel: entry.rel, kind: entry.kind, exports: entry.exports }))
			selectedRel = entry.rel
			rel = res.rel
			if (res.kind === 'html') {
				isHtml = true
				htmlContent = res.content
				originalJson = res.content
				exportsData = []
			} else {
				isHtml = false
				exportsData = res.exports
				originalJson = JSON.stringify(res.exports)
				activeExport = 0
			}
		} catch (e) {
			notify(errMsg(e), false)
		}
	}

	async function save(): Promise<void> {
		busy = true
		try {
			if (isHtml) {
				await window.api.configWrite(plain({ rel, kind: 'html', content: htmlContent }))
			} else {
				const current = exportsData[activeExport]
				await window.api.configWrite(plain({ rel, kind: 'ts', exportName: current.name, values: current.values }))
			}
			originalJson = isHtml ? htmlContent : JSON.stringify(exportsData)
			notify('已保存，改动会在「发布上线」推送后生效（改动前的版本在 git 里）')
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			busy = false
		}
	}

	function resetValues(): void {
		if (isHtml) htmlContent = originalJson
		else exportsData = JSON.parse(originalJson) as ConfigExportData[]
	}

	async function refreshDiscovery(): Promise<void> {
		try {
			discovered = await window.api.configDiscover()
		} catch {
			/* 忽略 */
		}
	}
</script>

<div class="cc-page">
	<div class="row" style="justify-content:space-between; margin-bottom:14px">
		<h2 style="margin:0">🎛️ 配置中心</h2>
		<div class="row">
			<input placeholder="搜索配置…" bind:value={search} style="max-width:200px" />
			<button class="btn" onclick={refreshDiscovery}>🔄 重新扫描</button>
		</div>
	</div>

	<div class="cc-layout">
	<div class="cc-list" style="width:{ccW}px">
		{#each groups as grp}
			<div class="muted" style="margin:10px 4px 4px; font-weight:600">{grp}</div>
			{#each filtered.filter((e) => e.group === grp) as e (e.rel)}
				<button class="cc-item" class:active={selectedRel === e.rel} onclick={() => open(e)}>
					<div><b>{e.title}</b></div>
					<div class="muted">{e.desc}</div>
				</button>
			{/each}
		{/each}
		{#if !entries.length}
			<p class="muted">未发现配置文件，请先绑定项目文件夹。</p>
		{/if}
	</div>

	<DragBar side="right" width={ccW} onresize={setCcW} onfinish={persistCcW} min={220} max={460} />

	<div class="cc-editor">
		{#if !selected}
			<div class="card"><p class="muted">从左侧选择一个配置文件开始编辑。所有改动保存到本地文件，「发布上线」推送后生效。</p></div>
		{:else}
			<div class="row" style="justify-content:space-between; margin-bottom:10px">
				<div class="row">
					<h3 style="margin:0">{selected.title}</h3>
					<span class="muted">{selected.rel}</span>
				</div>
				<div class="row">
					{#if dirty}<span class="tag" style="background:#fff3cd; color:#8a6d3b">有未保存修改</span>{/if}
					<button class="btn" onclick={resetValues} disabled={!dirty || busy}>放弃修改</button>
					<button class="btn primary" onclick={save} disabled={!dirty || busy}>保存</button>
				</div>
			</div>

			{#if !isHtml && exportsData.length > 1}
				<div class="row" style="margin-bottom:8px">
					{#each exportsData as ex, i}
						<button class="btn small" class:primary={activeExport === i} onclick={() => (activeExport = i)}>{ex.name}</button>
					{/each}
				</div>
			{/if}

			<div class="card">
				{#if isHtml}
					<textarea class="code" rows="16" bind:value={htmlContent}></textarea>
					<p class="hint">自定义 HTML 会注入到页脚（需在「页脚开关」里启用）。</p>
				{:else if exportsData[activeExport]}
					<FormKit
						def={rootDef}
						value={exportsData[activeExport].values}
						path=""
						labels={exportsData[activeExport].labels}
						oninput={() => {}}
						bare
					/>
				{/if}
			</div>
		{/if}
	</div>
	</div>
</div>

<style>
	.cc-page {
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: 12px;
		box-sizing: border-box;
	}
	.cc-layout {
		flex: 1;
		min-height: 0;
		display: flex;
		gap: 16px;
		align-items: stretch;
	}
	.cc-list {
		flex-shrink: 0;
		height: 100%;
		overflow: auto;
		box-sizing: border-box;
	}
	.cc-item {
		display: block;
		width: 100%;
		text-align: left;
		border: 1px solid var(--line);
		background: rgba(255, 255, 255, var(--panel-alpha));
		border-radius: 10px;
		padding: 8px 12px;
		margin-bottom: 6px;
	}
	.cc-item:hover {
		border-color: var(--accent);
	}
	.cc-item.active {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.cc-item .muted {
		font-size: 12px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cc-editor {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.cc-editor > .card {
		flex: 1;
		min-height: 0;
		overflow: auto;
	}
</style>
