<script lang="ts">
	import { getContext } from 'svelte'
	import type { BranchInfo, GitStatus, LogEntry, MergeResult, RemoteInfo } from '../lib/api'
	import { errMsg } from '../lib/err'
	import { diffToHtml, logToHtml } from '../lib/diff'

	let st = $state<GitStatus | null>(null)
	let message = $state('')
	let log = $state('')
	let busy = $state(false)

	// 远程仓库
	let remotes = $state<RemoteInfo[]>([])
	let pullRemote = $state(localStorage.getItem('ff.pull-remote') || 'origin')
	let pushRemote = $state(localStorage.getItem('ff.push-remote') || 'origin')

	function setPullRemote(name: string): void {
		pullRemote = name
		localStorage.setItem('ff.pull-remote', name)
	}
	function setPushRemote(name: string): void {
		pushRemote = name
		localStorage.setItem('ff.push-remote', name)
	}
	let newRemoteName = $state('')
	let newRemoteUrl = $state('')

	// 分支
	let branches = $state<BranchInfo[]>([])
	let currentBranch = $state('')
	let newBranchName = $state('')
	let mergeSource = $state('')

	// 差异
	let diffMode = $state<'detail' | 'names'>('detail')
	let diffText = $state('')

	// git push/pull 实时进度
	let progressLine = $state('')
	let progressPct = $state(-1)
	$effect(() => {
		return window.api.onGitProgress((line) => {
			progressLine = line
			const m = /(\d+)%/.exec(line)
			progressPct = m ? Number(m[1]) : -1
		})
	})

	async function loadDiff(mode: 'detail' | 'names'): Promise<void> {
		diffMode = mode
		busy = true
		try {
			const out = mode === 'detail' ? await window.api.diffAll() : await window.api.diffNames()
			diffText = out.trim() || '（暂无差异）'
		} catch (e) {
			diffText = errMsg(e)
		} finally {
			busy = false
		}
	}

	let force = $state(false)

	const notify = getContext<(m: string, ok?: boolean) => void>('notify')

	async function refresh(): Promise<void> {
		try {
			st = await window.api.gitStatus()
			currentBranch = st.branch ?? ''
			remotes = (await window.api.remoteList()) as RemoteInfo[]
			branches = (await window.api.branchList()) as BranchInfo[]
			if (pullRemote === 'origin' && !remotes.some((r) => r.name === 'origin') && remotes.length) setPullRemote(remotes[0].name)
			if (pushRemote === 'origin' && !remotes.some((r) => r.name === 'origin') && remotes.length) setPushRemote(remotes[0].name)
			await loadLog()
		} catch (e) {
			notify(errMsg(e), false)
		}
	}
	$effect(() => {
		void refresh()
	})

	const conflicts = $derived(st?.files.filter((f) => /^(UU|AA|DD|AU|UA|DU|UD)/.test(f.flag)) ?? [])

	function flagText(f: string): string {
		const conflictFlags = /^(UU|AA|DD|AU|UA|DU|UD)/
		if (conflictFlags.test(f)) return '冲突'
		const map: Record<string, string> = { M: '修改', A: '新增', D: '删除', R: '重命名', C: '复制', '??': '未跟踪' }
		return map[f] ?? f
	}

	/** 提交并推送（发布）：add -A + commit，然后把当前分支推到选中的远程 */
	async function run(): Promise<void> {
		if (!confirm('确认提交全部改动并推送到远端仓库？\n\n推送后云端会自动重新构建，几分钟后网站更新。')) return
		busy = true
		log = ''
		progressLine = ''
		try {
			const out = await window.api.gitCommitPush(message.trim() || '内容更新（Fireflux）')
			const pushLog = await window.api.pushTo(pushRemote, currentBranch, force)
			log = `${out}\n\n$ git push\n${pushLog}`
			notify('已推送！云端正在自动构建网站')
			message = ''
			await refresh()
		} catch (e) {
			log = errMsg(e)
			notify('操作失败，详见下方日志', false)
		} finally {
			busy = false
		}
	}

	async function pullTo(name: string): Promise<void> {
		setPullRemote(name)
		busy = true
		log = ''
		progressLine = ''
		try {
			// 1. fetch 该远程（带进度）
			await window.api.fetchRemote(name)
			// 2. 选择要合并的远程分支：优先同名分支，否则该远程的默认分支（FETCH_HEAD）
			const rb = (await window.api.remoteBranchList(name)) as string[]
			const same = rb.find((b) => b.endsWith(`/${currentBranch}`))
			let r: MergeResult
			if (same) {
				r = (await window.api.mergeRef(same)) as MergeResult
			} else {
				r = (await window.api.mergeRef('FETCH_HEAD')) as MergeResult
			}
			log = r.log
			if (!r.ok) {
				notify(r.conflicted ? '合并存在冲突，请解决后提交' : '合并失败，详见下方日志', false)
			} else {
				notify(same ? `已合并 ${same} 的最新代码` : `已合并 ${name} 默认分支的最新代码`)
			}
			await refresh()
		} catch (e) {
			log = errMsg(e)
			notify('拉取失败，详见下方日志', false)
		} finally {
			busy = false
		}
	}

	async function pushRow(name: string): Promise<void> {
		setPushRemote(name)
		await pushSelected(force)
	}

	async function stageAll(): Promise<void> {
		busy = true
		try {
			log = await window.api.addAll()
			notify('已暂存全部改动（git add .）')
			await refresh()
		} catch (e) {
			log = errMsg(e)
			notify('暂存失败，详见下方日志', false)
		} finally {
			busy = false
		}
	}

	async function commitOnly(): Promise<void> {
		if (!message.trim()) {
			notify('请先填写提交信息（git commit 必须要有提交说明）', false)
			return
		}
		busy = true
		try {
			log = await window.api.commitStaged(message.trim())
			notify('已提交（git commit）')
			message = ''
			await refresh()
		} catch (e) {
			log = errMsg(e)
			if (log.includes('nothing to commit')) notify('暂存区是空的——先点「⬆ 暂存全部」再提交', false)
			else notify('提交失败，详见下方日志', false)
		} finally {
			busy = false
		}
	}

	// git log
	let logCount = $state(20)
	let logEntries = $state<LogEntry[]>([])
	async function loadLog(): Promise<void> {
		try {
			logEntries = (await window.api.gitLog(logCount)) as LogEntry[]
		} catch (e) {
			notify(errMsg(e), false)
		}
	}
	$effect(() => {
		void loadLog()
	})

	async function addRemote(): Promise<void> {
		if (!newRemoteName.trim() || !newRemoteUrl.trim()) {
			notify('请填写远程仓库名称和地址', false)
			return
		}
		busy = true
		try {
			await window.api.remoteAdd(newRemoteName.trim(), newRemoteUrl.trim())
			notify(`远程仓库「${newRemoteName.trim()}」已添加`)
			newRemoteName = ''
			newRemoteUrl = ''
			await refresh()
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			busy = false
		}
	}

	async function removeRemote(name: string): Promise<void> {
		if (!confirm(`确定删除远程仓库「${name}」吗？（只删除记录，不影响远端）`)) return
		try {
			await window.api.remoteRemove(name)
			notify('已删除')
			await refresh()
		} catch (e) {
			notify(errMsg(e), false)
		}
	}

	async function switchBranch(name: string): Promise<void> {
		if (name === currentBranch) return
		if ((st?.files.length ?? 0) > 0 && !confirm('当前有未提交的改动，切换分支可能失败或带过去。\n建议先提交。仍要切换吗？')) return
		busy = true
		try {
			await window.api.branchSwitch(name)
			notify(`已切换到分支「${name}」`)
			await refresh()
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			busy = false
		}
	}

	async function createBranch(): Promise<void> {
		if (!newBranchName.trim()) {
			notify('请填写分支名', false)
			return
		}
		busy = true
		try {
			await window.api.branchCreate(newBranchName.trim())
			notify(`分支「${newBranchName.trim()}」已创建并切换`)
			newBranchName = ''
			await refresh()
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			busy = false
		}
	}

	async function merge(): Promise<void> {
		if (!mergeSource) {
			notify('请选择要合并的分支', false)
			return
		}
		if (!confirm(`确认把「${mergeSource}」合并到当前分支「${currentBranch}」吗？\n如有冲突，解决后提交即可。`)) return
		busy = true
		try {
			const r = (await window.api.mergeBranch(mergeSource)) as { log: string; conflicted: boolean }
			log = r.log
			notify(r.conflicted ? '合并存在冲突，请解决后提交' : '合并完成')
			await refresh()
		} catch (e) {
			log = errMsg(e)
			notify('合并失败，详见下方日志', false)
		} finally {
			busy = false
		}
	}

	async function pushSelected(force: boolean): Promise<void> {
		if (!currentBranch) {
			notify('无法确定当前分支', false)
			return
		}
		if (force && !confirm(`确认强制推送到「${pushRemote}」？\n远端上的改动会被覆盖！`)) return
		busy = true
		log = ''
		try {
			log = await window.api.pushTo(pushRemote, currentBranch, force)
			notify(`已推送到「${pushRemote}」`)
			await refresh()
		} catch (e) {
			log = errMsg(e)
			notify('推送失败，详见下方日志', false)
		} finally {
			busy = false
		}
	}

	async function showDiff(rel: string): Promise<void> {
		try {
			diffText = (await window.api.diffFile(rel)) || '（此文件暂无与上次提交的差异）'
		} catch (e) {
			diffText = errMsg(e)
		}
	}
</script>

<h2>🚀 发布上线</h2>
<p class="muted">所有修改先存在本地，在这里提交存档并推送到远端仓库后，云端才会自动更新网站。</p>

{#if st && !st.ok}
	<div class="card" style="margin-top:12px; border-color: #f0c4c6">
		<b>git 状态获取失败</b>
		<p class="muted">{st.error}</p>
	</div>
{:else}
	{#if conflicts.length}
		<div class="card" style="margin-top:12px; border-color:#f0c4c6; background:#fff5f5">
			<b>⚠️ 检测到 {conflicts.length} 个合并冲突</b>
			<p class="muted">在下方差异查看里打开冲突文件，编辑掉 &lt;&lt;&lt;&lt;&lt;&lt;&lt; / ======= / &gt;&gt;&gt;&gt;&gt;&gt;&gt; 标记后，点「✓ 提交（git commit）」→「提交并推送（发布）」完成合并。</p>
		</div>
	{/if}

	<div class="card" style="margin-top:12px">
		<div class="row" style="justify-content:space-between">
			<h3 style="margin:0">当前改动 {st?.files.length ?? 0} 项（点击文件可看差异）</h3>
			<span class="tag">分支：{currentBranch || '未知'}</span>
		</div>
		{#if st && st.files.length === 0}
			<p class="muted" style="margin-top:10px">没有待发布的改动。</p>
		{:else}
			<div style="margin-top:10px; max-height:220px; overflow:auto">
				{#each st?.files ?? [] as f}
					<div class="row" style="justify-content:space-between; padding:3px 0; border-bottom:1px dashed var(--line)">
						<!-- 点击查看该文件的 diff：用真正的 button（原来是非交互的 code + onclick，
						     键盘用户按不到，Svelte 也会报 a11y 警告），外观由 .diff-link 复位成文本样式 -->
						<button type="button" class="diff-link" title="查看这个文件的差异" onclick={() => showDiff(f.file)}>{f.file}</button>
						<span class="tag" class:err-tag={/^(UU|AA|DD|AU|UA|DU|UD)/.test(f.flag)}>{flagText(f.flag)}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<div class="card" style="margin-top:14px">
		<h3>提交信息</h3>
		<input placeholder="例如：发布新动态 / 更新壁纸配置" bind:value={message} style="margin-bottom:10px" />
		<div class="row" style="margin-top:10px">
		<button class="btn" onclick={stageAll} disabled={busy || (st?.files.length ?? 0) === 0}>⬆ 暂存全部（git add .）</button>
		<button class="btn" title="需要先填写提交信息" onclick={commitOnly} disabled={busy}>✓ 提交（git commit）</button>
		<button class="btn primary" onclick={run} disabled={busy}>提交并推送（发布）</button>
		<button class="btn" onclick={() => pullTo(pullRemote)} disabled={busy}>从 {pullRemote} 拉取最新</button>
		<button class="btn" onclick={refresh} disabled={busy}>刷新状态</button>
	</div>
	<p class="hint">推荐流程：暂存 → 填提交信息 → 提交 → 推送。也可以直接用「提交并推送」一步完成（自动 add + commit + push）。</p>
		{#if busy && progressLine}
			<div class="progress-wrap">
				<div class="progress-line">{progressLine}</div>
				<div class="progress-bar" class:indet={progressPct < 0}>
					<div class="progress-fill" style="width:{progressPct < 0 ? 100 : progressPct}%"></div>
				</div>
			</div>
		{/if}
	</div>

	<div class="card" style="margin-top:14px">
		<div class="row" style="justify-content:space-between">
			<h3 style="margin:0">🔀 分支</h3>
			<div class="row">
				<input placeholder="新分支名，如 example2" bind:value={newBranchName} style="max-width:180px" />
				<button class="btn small" onclick={createBranch} disabled={busy || !newBranchName.trim()}>＋ 新建分支</button>
			</div>
		</div>
		<div class="row" style="margin-top:10px; gap:8px">
			{#each branches as b}
				<button
					class="btn small"
					class:primary={b.current}
					title={b.current ? '当前分支' : '点击切换到此分支'}
					onclick={() => switchBranch(b.name)}>{b.name}{b.current ? '（当前）' : ''}</button
				>
			{/each}
		</div>
		<div class="row" style="margin-top:10px">
			<span class="muted">合并：</span>
			<select bind:value={mergeSource} style="max-width:200px">
				<option value="" disabled>选择源分支</option>
				{#each branches.filter((b) => !b.current) as b}
					<option value={b.name}>{b.name}</option>
				{/each}
			</select>
			<button class="btn" onclick={merge} disabled={busy || !mergeSource}>合并到当前分支（{currentBranch}）</button>
		</div>
		<p class="hint">例如当前在 master，选择源分支 example 后点合并，即等于 git merge example。</p>
	</div>

	<div class="card" style="margin-top:14px">
		<div class="row" style="justify-content:space-between">
			<h3 style="margin:0">🌐 远程仓库（{remotes.length}）</h3>
		</div>
		{#each remotes as r}
			<div class="row" style="justify-content:space-between; padding:6px 0; border-bottom:1px dashed var(--line)">
				<div>
					<b>{r.name}</b>
					<code class="muted" style="font-size:12px; margin-left:8px">{r.fetch}</code>
				</div>
				<div class="row">
					<button class="btn small" onclick={() => pullTo(r.name)} disabled={busy}>拉取</button>
					<button class="btn small" onclick={() => pushRow(r.name)} disabled={busy}>推送</button>
					<button class="btn small danger" onclick={() => removeRemote(r.name)}>删除</button>
				</div>
			</div>
		{/each}
		{#if !remotes.length}
			<p class="muted" style="margin:8px 0">还没有远程仓库，在下方添加。</p>
		{/if}
		<div class="row" style="margin-top:10px">
			<input placeholder="名称，如 origin / upstream" bind:value={newRemoteName} style="max-width:150px" />
			<input
				placeholder="地址：https://github.com/... 或 git@github.com:..."
				bind:value={newRemoteUrl}
				style="flex:1; min-width:220px"
			/>
			<button class="btn small" onclick={addRemote} disabled={busy}>＋ 添加</button>
		</div>
		<div class="row" style="margin-top:10px">
			<button class="btn" onclick={() => pushSelected(false)} disabled={busy || !pushRemote}>
				推送到 {pushRemote}（{currentBranch}）
			</button>
			<label class="row" style="gap:4px; color:var(--danger)">
				<input type="checkbox" bind:checked={force} style="width:auto" /> 强制推送（覆盖远端）
			</label>
		</div>
		<p class="hint">地址支持 https:// 或 git@ 开头的 ssh 形式（ssh 需本机已配置密钥）。点「拉取 / 推送」立即对该仓库执行操作，并记住为默认远程。</p>
	</div>

	<div class="card" style="margin-top:14px">
		<div class="row" style="justify-content:space-between">
			<h3 style="margin:0">👁 差异查看</h3>
			<div class="row seg">
				<button class="btn small" class:primary={diffMode === 'detail'} onclick={() => loadDiff('detail')}>git diff</button>
				<button class="btn small" class:primary={diffMode === 'names'} onclick={() => loadDiff('names')}>git diff --name-only</button>
			</div>
		</div>
		{#if diffText}
			<!-- 内容为 git diff 输出，lib/diff.ts 着色时已逐行转义 -->
			<pre class="diff-view" style="white-space:pre-wrap; max-height:360px; overflow:auto">{@html diffToHtml(diffText)}</pre>
		{:else}
			<p class="muted" style="margin-top:10px">点右上角按钮执行 git diff（完整差异）或 git diff --name-only（仅文件名）；也可以点击上方改动文件名查看单个文件差异。</p>
		{/if}
	</div>

	<div class="card" style="margin-top:14px">
		<div class="row" style="justify-content:space-between">
			<h3 style="margin:0">📜 提交历史（git log）</h3>
			<div class="row">
				<span class="muted">最近</span>
				<input type="number" min="1" max="200" bind:value={logCount} style="max-width:70px" />
				<span class="muted">条</span>
				<button class="btn small" onclick={loadLog} disabled={busy}>查看</button>
			</div>
		</div>
		<div style="margin-top:8px; max-height:260px; overflow:auto">
			{#each logEntries as c (c.hash)}
				<div class="row" style="justify-content:space-between; padding:4px 0; border-bottom:1px dashed var(--line)">
					<div class="row" style="gap:8px">
						<code style="font-size:12px; color:var(--accent)">{c.hash}</code>
						<span>{c.subject}</span>
					</div>
					<span class="muted">{c.author} · {c.date}</span>
				</div>
			{/each}
			{#if !logEntries.length}<p class="muted">（暂无提交记录）</p>{/if}
		</div>
	</div>

	{#if log}
		<div class="card" style="margin-top:14px">
			<h3>操作日志</h3>
			<!-- 内容为 git 命令输出，lib/diff.ts 着色时已逐行转义 -->
			<pre class="log-view">{@html logToHtml(log)}</pre>
		</div>
	{/if}
{/if}

<style>
	/* git 命令输出：等宽 + 逐行着色（l-cmd / l-err / l-ok 由 lib/diff.ts 生成） */
	.log-view {
		background: #f9fafb;
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 12px 14px;
		overflow: auto;
		max-height: 300px;
		font-family: var(--mono);
		font-size: 12.5px;
		line-height: 1.7;
		white-space: pre-wrap;
		color: #44514e;
	}
	.log-view :global(.l-cmd) {
		color: var(--accent-deep);
		font-weight: 700;
		background: #e8f7f4;
		display: inline-block;
		width: 100%;
		border-radius: 4px;
	}
	.log-view :global(.l-err) {
		color: var(--danger);
		font-weight: 600;
	}
	.log-view :global(.l-ok) {
		color: #1a7f37;
	}
	/* 改动文件名：长得像代码链接，其实是 button，所以先把按钮默认样式复位掉 */
	.diff-link {
		border: none;
		background: none;
		padding: 0;
		margin: 0;
		font: inherit;
		font-family: var(--mono);
		font-size: 12.5px;
		text-align: left;
		cursor: pointer;
		color: var(--text);
	}
	.diff-link:hover {
		color: var(--accent);
		text-decoration: underline;
	}
	.err-tag {
		background: #ffe3e3 !important;
		color: var(--danger) !important;
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
	/* git 推送/拉取进度条（流萤渐变） */
	.progress-wrap {
		margin-top: 12px;
	}
	.progress-line {
		font-family: var(--mono);
		font-size: 12px;
		color: var(--accent-deep);
		margin-bottom: 5px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.progress-bar {
		height: 9px;
		border-radius: 6px;
		background: #e6f2ef;
		overflow: hidden;
	}
	.progress-fill {
		height: 100%;
		border-radius: 6px;
		background: linear-gradient(90deg, #2dd4bf, #14b8a6 55%, #f59e0b);
		transition: width 0.25s ease;
	}
	.progress-bar.indet .progress-fill {
		animation: ff-slide 1.1s linear infinite;
		background: linear-gradient(90deg, #2dd4bf 0%, #14b8a6 40%, #f59e0b 100%);
		background-size: 200% 100%;
	}
	@keyframes ff-slide {
		0% {
			background-position: 0 0;
		}
		100% {
			background-position: -200% 0;
		}
	}
	/* git diff 配色（流萤浅色主题） */
	.diff-view {
		background: #f9fafb;
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 12px 14px;
		overflow: auto;
		max-height: 360px;
		font-family: var(--mono);
		font-size: 12.5px;
		line-height: 1.65;
	}
	.diff-view :global(.d-add) {
		color: #116329;
		background: #e6ffec;
		display: inline-block;
		width: 100%;
	}
	.diff-view :global(.d-del) {
		color: #82071e;
		background: #ffebe9;
		display: inline-block;
		width: 100%;
	}
	.diff-view :global(.d-file) {
		color: #0b7285;
		font-weight: 700;
	}
	.diff-view :global(.d-hunk) {
		color: #b45309;
		background: #fff7e6;
		display: inline-block;
		width: 100%;
	}
</style>
