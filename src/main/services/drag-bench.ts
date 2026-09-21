import { type BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'

/**
 * 性能 / 交互归因台（开发辅助，仅 FF_DRAG_BENCH=1 时启用；由 scripts/bench-drag.mjs 启动并收集结果）。
 *
 * 三种用法（见 README「开发辅助」）：
 * - 默认：逐阶段量 CPU（静置 / 内容区移动鼠标=看板娘跟随 / 真实拖拽两条分隔条），
 *   并抽查拖拽几何（手柄是否贴在分界线上、另一条分隔条是否纹丝不动）
 * - FF_INTERACT_TEST=1：看板娘互动链路（唤醒 / 冻结 / 点击恢复 / 视线收敛曲线 / 跟随期间 CPU / 命中）
 * - FF_SMOKE=1：逐页冒烟，收集页面运行时报错
 * 三种模式都认 FF_SHOT=<路径>：会把整窗 / 看板娘区域的截图写到该路径旁边。
 * 注意：归因台跑的是构建产物（electron .），所以要先 pnpm build。
 *
 * 度量口径的坑：Electron 自带 getAppMetrics().percentCPUUsage 在本机偏低约一个数量级，
 * 所以统一用系统级 PowerShell 采样全部 electron 进程的累计 CPU 秒数；
 * 合成鼠标事件必须带 button 字段，否则会被 Chromium 丢掉（页面收不到 mousemove）。
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const exec = (win: BrowserWindow, code: string): Promise<unknown> => win.webContents.executeJavaScript(code, true)

/** 全部 electron 进程的累计 CPU 秒数（含主进程/渲染进程/GPU 进程） */
function psCpu(): Promise<number> {
	return new Promise((resolve) => {
		execFile(
			'powershell.exe',
			['-NoProfile', '-NonInteractive', '-Command', '(Get-Process electron -ErrorAction SilentlyContinue | Measure-Object -Property CPU -Sum).Sum'],
			{ timeout: 20000, windowsHide: true },
			(_e, stdout) => resolve(Number(String(stdout).trim()) || 0)
		)
	})
}

const BENCH_INSTALL = `(() => {
	if (!window.__ffBenchIdle) {
		/** 静置对照阶段：页面什么都不做，只等到时间 */
		window.__ffBenchIdle = (durMs) => new Promise((resolve) => {
			const t0 = performance.now()
			setTimeout(() => resolve(JSON.stringify({ ms: Math.round(performance.now() - t0) })), durMs)
		})
		window.__ffBenchReset = () => {
			for (const sel of ['.cm-editor', '.cm-list', '.wallpaper', '.sidebar', '.content', '.live2d-slot iframe', '.md-preview']) {
				const el = document.querySelector(sel)
				if (el) { el.style.display = ''; el.style.visibility = ''; el.style.willChange = ''; el.style.transform = '' }
			}
			return 'ok'
		}
	}
	return 'ok'
})()`

interface Phase {
	name: string
	/** 阶段开始前对页面做的改动（会先 reset） */
	setup?: string
	/** 用合成鼠标真实拖拽分隔条（走 DragBar 的完整链路），值为拖拽距离 */
	mouseDrag?: number
	/** 拖拽哪一条分隔条（CSS 选择器，默认中间那条 = 列表/编辑器之间的） */
	dragBar?: string
	/** 让指针在内容区持续移动：验证全窗口光标跟随期间的 CPU */
	pointerPatrol?: boolean
	/** 阶段结束后额外执行的页面表达式（诊断读数） */
	post?: string
}

/** 探针公共部分：mousemove 计数与看板娘 ff-ticker 监听（重复安装是幂等的） */
const PATROL_HOOKS = `if (!window.__ffTickWatch) {
		window.__ffTickWatch = true
		window.addEventListener('mousemove', () => { window.__ffMoveCount += 1 }, { capture: true, passive: true })
	}
	if (!window.__ffTickHooked) {
		window.__ffTickHooked = true
		window.addEventListener('message', (e) => { if (e.data && e.data.type === 'ff-ticker') window.__ffTick = e.data })
	}`

/** 探针装：内容区指针移动阶段开始前挂上监听，并把移动计数清零 */
const PATROL_SETUP = `(() => {
	window.__ffMoveCount = 0
	${PATROL_HOOKS}
	return 'ok'
})()`

/** 探针读数：事件是否到达 / 焦点 / 看板娘节奏状态 */
const PATROL_POST = `(() => {
	window.__ffMoveCount = window.__ffMoveCount || 0
	${PATROL_HOOKS}
	const f = document.querySelector('.live2d-slot iframe')
	if (!f) return Promise.resolve('{"error":"no-iframe"}')
	f.contentWindow.postMessage({ type: 'ff-tick?' }, '*')
	return new Promise((r) => setTimeout(() => r(JSON.stringify({ moves: window.__ffMoveCount, hf: document.hasFocus(), cls: document.body.className, tick: window.__ffTick })), 300))
})()`

export async function runDragBench(win: BrowserWindow): Promise<void> {
	try {
		await sleep(9000)
		// 先把窗口激活：失焦时看板娘会整体暂停（设计行为），
		// 那样「光标跟随」这类阶段会量成 0 核，看起来像没生效
		win.show()
		win.focus()
		await sleep(1200)
		await exec(win, BENCH_INSTALL)
		await exec(win, `document.querySelectorAll('.nav-item')[1]?.click(); 'ok'`)
		await sleep(2500)
		await exec(win, `(() => { const it = document.querySelectorAll('.cm-item')[3]; if (it) it.click(); return 'ok' })()`)
		await sleep(2000)

		const geo = await exec(
			win,
			`(() => {
				const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) } }
				const bars = [...document.querySelectorAll('.dragbar')].map((b) => {
				  const r = b.getBoundingClientRect()
				  return { x: Math.round(r.x), w: Math.round(r.width), y: Math.round(r.y), h: Math.round(r.height), center: Math.round(r.x + r.width / 2), handleY: Math.round(r.y + r.height / 2), dragging: b.classList.contains('dragging') }
				})
				const sidebarEl = document.querySelector('.sidebar'), listEl = document.querySelector('.cm-list'), editorEl = document.querySelector('.cm-editor')
				const sr = sidebarEl && sidebarEl.getBoundingClientRect(), lr = listEl && listEl.getBoundingClientRect(), er = editorEl && editorEl.getBoundingClientRect()
				const gaps = { left: sr && lr ? Math.round((sr.right + lr.left) / 2) : null, right: lr && er ? Math.round((lr.right + er.left) / 2) : null }
				return JSON.stringify({ list: q('.cm-list'), bar: q('.cm-layout .dragbar'), editor: q('.cm-editor'), sidebar: q('.sidebar'), content: q('.content'), bars, gaps, view: [window.innerWidth, window.innerHeight] })})()`
		)
		// 冒烟检查（FF_SMOKE=1）：逐页点开，收集页面错误与渲染出的卡片数，
		// 用于确认「改了背景烘焙/拖拽条/设置页」之后没有页面级运行时报错
		if (process.env['FF_SMOKE']) {
			await exec(
				win,
				`(() => {
					window.__ffErrs = window.__ffErrs || []
					if (!window.__ffErrHooked) {
						window.__ffErrHooked = true
						window.addEventListener('error', (e) => window.__ffErrs.push('error: ' + e.message))
						window.addEventListener('unhandledrejection', (e) => window.__ffErrs.push('reject: ' + String(e.reason)))
					}
					return 'ok'
				})()`
			)
			// 页面按钮里排除「调整看板娘」：它是开关不是页面，点开之后同样跑 bench 的
			// 合成拖拽会被当成调整操作，把用户的大小/位置设置写脏（踩过一次）
			const pages = `[...document.querySelectorAll('.nav-item')].filter((b) => !b.textContent.includes('调整看板娘'))`
			const n = Number(await exec(win, `${pages}.length`))
			for (let i = 0; i < n; i++) {
				await exec(win, `${pages}[${i}].click(); 'ok'`)
				await sleep(1400)
				const info = (await exec(
					win,
					`JSON.stringify({ page: (document.querySelector('.nav-item.active') || {}).innerText, cards: document.querySelectorAll('.card').length, btns: document.querySelectorAll('.btn').length, errs: window.__ffErrs.length, last: window.__ffErrs.slice(-2) })`
				)) as string
				console.log(`[smoke] ${i} ${info}`)
			}
			// 顺带整窗截图：设置页（核对按钮间距/卡片）+ 文章管理打开文件后（核对三栏布局）
			if (process.env['FF_SHOT']) {
				const shot = process.env['FF_SHOT'] as string
				await exec(win, `document.querySelectorAll('.nav-item')[6].click(); 'ok'`)
				await sleep(1200)
				fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG())
				await exec(win, `(() => { document.querySelectorAll('.nav-item')[1].click(); return 'ok' })()`)
				await sleep(1200)
				await exec(win, `(() => { const it = document.querySelectorAll('.cm-item')[3]; if (it) it.click(); return 'ok' })()`)
				await sleep(1500)
				fs.writeFileSync(shot.replace(/\.png$/, '-editor.png'), (await win.webContents.capturePage()).toPNG())
				console.log('[smoke] 已保存整窗截图：' + shot + ' 与 ' + shot.replace(/\.png$/, '-editor.png'))
			}
			console.log('[bench-done]')
			return
		}

		console.log('[bench-geo]' + geo)

		// 看板娘互动链路验证（FF_INTERACT_TEST=1）：
		// 指针移到看板娘上 → 应该开始渲染；移开等 12s → 应该冻结（静止肖像）；
		// 再「点一下看板娘」→ 必须立刻恢复渲染（老版本这里要切页面才动）
		if (process.env['FF_INTERACT_TEST']) {
			const frames = `(async () => {
				window.__ffEventLog = window.__ffEventLog || []
				if (!window.__ffTickHooked2) {
					window.__ffTickHooked2 = true
					window.addEventListener('message', (e) => { if (e.data && e.data.type === 'ff-ticker') window.__ffTick2 = e.data })
				}
				const f = document.querySelector('.live2d-slot iframe')
				if (!f) return 'no-iframe'
				f.contentWindow.postMessage({ type: 'ff-tick?' }, '*')
				await new Promise((r) => setTimeout(r, 300))
				const t = window.__ffTick2 || {}
				const log = (window.__ffEventLog || []).slice(-6).join(' | ')
				return JSON.stringify({ f: t.frames, live: t.live, run: t.running, got: t.got, idle: document.body.classList.contains('ff-idle'), hf: document.hasFocus(), ae: document.activeElement ? document.activeElement.tagName : '-', log })
			})()`
			const rect = JSON.parse(
				(await exec(
					win,
					`(() => { const f = document.querySelector('.live2d-slot iframe'); const r = f.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x + r.width / 2), yMid: Math.round(r.y + r.height / 2), yLow: Math.round(r.y + r.height - 60) }) })()`
				)) as string
			) as { x: number; yMid: number; yLow: number }
			const send = (type: string, x: number, y: number): void =>
				win.webContents.sendInputEvent({ type, x, y, button: 'left' } as Parameters<typeof win.webContents.sendInputEvent>[0])
			const probe = async (tag: string): Promise<Record<string, unknown>> => {
				const r = JSON.parse((await exec(win, frames)) as string) as Record<string, unknown>
				console.log(`[itx] ${tag.padEnd(22)} 帧=${r.f} live=${r.live} running=${r.run} ff-idle=${r.idle} hasFocus=${r.hf} active=${r.ae} 日志=${r.log}`)
				return r
			}

			console.log('[itx] 窗口内看板娘位置 x=' + rect.x + ' yMid=' + rect.yMid)

			/** 取一次 ff-diag 回包（看板娘通过 postMessage 回传，含 diag 探针字段与 frames） */
			const diagPayload = async (): Promise<{ diag?: Record<string, unknown>; frames?: number; error?: string }> => {
				const raw = (await exec(
					win,
					`new Promise((resolve) => {
						const f = document.querySelector('.live2d-slot iframe')
						if (!f) { resolve('{"error":"no-iframe"}'); return }
						const h = (e) => {
							if (e.data && e.data.type === 'ff-diag') {
								window.removeEventListener('message', h)
								resolve(JSON.stringify(e.data))
							}
						}
						window.addEventListener('message', h)
						f.contentWindow.postMessage({ type: 'ff-diag?' }, '*')
						setTimeout(() => resolve('{"error":"timeout"}'), 3000)
					})`
				)) as string
				try {
					return JSON.parse(raw) as { diag?: Record<string, unknown>; frames?: number; error?: string }
				} catch {
					return { error: 'bad-json' }
				}
			}

			/** 只要探针字段、不打印：收敛曲线采样用 */
			const diagRaw = async (): Promise<Record<string, unknown>> => (await diagPayload()).diag ?? {}

			// 自检读数：鼠标追踪朝向 / 命中次数 / 当前表情 / 关键参数（返回对象供调用方继续用）
			const diag = async (tag: string): Promise<Record<string, unknown> | undefined> => {
				const r = await diagPayload()
				const d = r.diag ?? { error: r.error ?? 'null' }
				console.log(
					`[itx] ${tag.padEnd(18)} 追踪=${JSON.stringify(d.focus)} 目标=${JSON.stringify(d.focusTarget)} 响应=${d.gazeRespMs}ms 命中=${d.hits}（按下=${d.downs} 点击=${d.clicks}）表情=${d.expr} 参数=${JSON.stringify(d.params)} 帧=${r.frames}`
				)
				return d
			}
			const hover = async (x: number, y: number): Promise<void> => {
				win.focus()
				send('mouseMove', x - 4, y)
				send('mouseMove', x, y)
				await sleep(1600)
			}
			// 测试期间把应用窗口激活：失焦状态下看板娘会完全暂停（这是设计行为），
			// 会让追踪/表情这类需要渲染的验证全部落空
			win.show()
			win.focus()
			await sleep(2500)
			await probe('0) 静置基线')
			console.log('[itx] --- 鼠标追踪（应朝指针方向看）---')
			await hover(rect.x - 60, rect.yMid + 60)
			await diag('指针在左下')
			await hover(rect.x + 60, rect.yMid - 60)
			await diag('指针在右上')
			// 截图核对看板娘渲染效果（大小/位置/是否被裁切）
			{
				const shotW = Number(await exec(win, 'Math.round(document.querySelector(".sidebar").getBoundingClientRect().right) + 20')) || 470
				const img = await win.webContents.capturePage({ x: 0, y: 0, width: shotW, height: 1014 })
				fs.writeFileSync(process.env['FF_SHOT'] || 'l2d-check.png', img.toPNG())
				console.log('[itx] 已保存看板娘截图：' + (process.env['FF_SHOT'] || 'l2d-check.png'))
			}
			console.log('[itx] --- 光标在内容区移动（全窗口跟随）---')
			await hover(1100, 300)
			await diag('内容区右上')
			await hover(700, 800)
			await diag('内容区左下')
			// 跟随延迟：跨半屏的长距离移动，读「目标变化 → 视线到位」的耗时（gazeRespMs）
			console.log('[itx] --- 跟随延迟（跨半屏跳两次）---')
			await hover(1300, 170)
			await diag('跨屏 → 最右')
			await hover(560, 840)
			await diag('跨屏 → 最左')
			// 视线收敛曲线：跨半屏跳一次后密集采样（focus = 当前视线，focusTarget = 目标），
			// 用来量「肉眼看到的跟随速度」—— 不受管理器 1.5s 静止判定影响
			console.log('[itx] --- 视线收敛曲线（跨半屏 → 每 150ms 采样）---')
			await hover(1250, 220)
			send('mouseMove', 560 + 6, 820)
			send('mouseMove', 560, 820)
			{
				const t0 = Date.now()
				const traj: string[] = []
				for (let i = 0; i < 10; i++) {
					await sleep(150)
					const d = await diagRaw()
					traj.push(`${Date.now() - t0}ms ${JSON.stringify(d.focus)}→${JSON.stringify(d.focusTarget)}`)
				}
				console.log('[itx] 收敛 ' + traj.join(' | '))
			}
			// 可选：量渲染分辨率对每帧成本的影响（FF_L2D_RES=0.7 等）。
			// 读 iframe 里的加载器对象需要同源，归因台跑的是构建产物（iframe 独立源）时
			// 浏览器会直接拒绝，这里吞掉异常只打印提示，别让整轮测量中断
			if (process.env['FF_L2D_RES']) {
				const res = Number(process.env['FF_L2D_RES'])
				const applied = await exec(
					win,
					`(() => {
						try {
							const f = document.querySelector('.live2d-slot iframe')
							const l = f && f.contentWindow.FireflyLive2D
							if (!l || !l.app || !l.config) return 'no-l2d'
							l.app.renderer.resolution = ${res}
							l.app.renderer.resize(Math.round(l.config.width), Math.round(l.config.height))
							return 'res=' + l.app.renderer.resolution
						} catch (e) {
							return '跨源不可用（需 dev 同源）：' + (e && e.name)
						}
					})()`
				)
				console.log(`[itx] 渲染分辨率 ${res} → ${applied}`)
			}
			// 跟随期间的 CPU：指针在内容区连续移动（每 300ms 一步，实测合成输入在这个模式下可靠）
			console.log('[itx] --- 跟随期间 CPU ---')
			{
				const before = await probe('跟随前')
				const c0 = await psCpu()
				const t0 = Date.now()
				for (let i = 0; i < 12; i++) {
					const px = 600 + ((i * 137) % 650)
					const py = 200 + ((i * 91) % 600)
					send('mouseMove', px - 6, py)
					send('mouseMove', px, py)
					await sleep(300)
				}
				const secs = (Date.now() - t0) / 1000
				const c1 = await psCpu()
				const after = await probe('跟随后')
				const info = await diagRaw()
				console.log(
					`[itx] 跟随 ${secs.toFixed(1)}s：${((c1 - c0) / secs).toFixed(2)} 核/秒  帧 ${before.f} → ${after.f}（${(((Number(after.f) - Number(before.f)) / secs) | 0)} 帧/秒） 生效帧率=${info.fps} 分辨率=${info.res}`
				)
			}
			console.log('[itx] --- 表情链路 ---')
			await exec(
				win,
				`(() => { const f = document.querySelector('.live2d-slot iframe'); f.contentWindow.postMessage({ type: 'ff-expr', name: 'expression3.exp3' }, '*'); return 'ok' })()`
			)
			await sleep(1600)
			await diag('播放表情3')
			console.log('[itx] --- 点击命中 ---')
			// 用加载器暴露的 tapHitArea 走一遍「pointertap → tap() → hitTest → hit 事件」：
			// 合成鼠标事件（sendInputEvent）跨 iframe 时经常只到 pointerdown、到不了 click，
			// 拿合成点击去试命中会误报成「点了没反应」（实测：按下 2 次、click 0 次）
			const before = await diag('点前读数')
			const areas = Object.keys((before?.hitAreas ?? {}) as Record<string, unknown>)
			console.log(`[itx] 命中区=${JSON.stringify(before?.hitAreas)} 画布尺寸=${JSON.stringify(before?.box)}`)
			// 模型在画布里的实际渲染尺寸 = 模型原始尺寸 × fit；art = 画布里真正有内容的范围
			const natural = (before?.natural ?? []) as number[]
			const fit = Number(before?.fit ?? 0)
			console.log(
				`[itx] 模型原始尺寸=${JSON.stringify(natural)} fit=${fit} → 渲染尺寸≈${Math.round((natural[0] ?? 0) * fit)}×${Math.round((natural[1] ?? 0) * fit)} 画布内实际内容 art=${JSON.stringify(before?.art)} 底部对齐 y=${JSON.stringify(before?.pos)}`
			)
			// 只截看板娘那块区域（放大看细节：是否被裁切、按钮带子位置对不对）
			if (process.env['FF_SHOT']) {
				const r = JSON.parse(
					(await exec(
						win,
						`(() => { const b = document.querySelector('.live2d-slot').getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) }) })()`
					)) as string
				) as { x: number; y: number; width: number; height: number }
				fs.writeFileSync((process.env['FF_SHOT'] as string).replace(/\.png$/, '-slot.png'), (await win.webContents.capturePage(r)).toPNG())
				console.log('[itx] 已保存看板娘区域截图：' + (process.env['FF_SHOT'] as string).replace(/\.png$/, '-slot.png'))
			}
			for (const name of ['刘海', ...areas.filter((n) => n !== '刘海')]) {
				await exec(
					win,
					`(() => { const f = document.querySelector('.live2d-slot iframe'); f.contentWindow.postMessage({ type: 'ff-tap', name: ${JSON.stringify(name)} }, '*'); return 'ok' })()`
				)
				await sleep(1100)
				const r = await diag(`命中 ${name}`)
				if (Number(r?.hits ?? 0) > 0) break
			}

			send('mouseMove', 1100, 500)
			await sleep(14_000)
			await probe('2) 移开 14s（应冻结）')
			await sleep(2500)
			await probe('3) 再等 2.5s（帧应不变）')
			// 点击看板娘：合成输入会去重同坐标 mouseMove，先挪一点再按下
			send('mouseDown', rect.x, rect.yMid)
			await sleep(90)
			send('mouseUp', rect.x, rect.yMid)
			send('mouseMove', rect.x + 3, rect.yMid - 3)
			await sleep(800)
			await probe('4) 点击后 0.8s')
			await sleep(1500)
			await probe('5) 点击后 2.3s')
			console.log('[bench-done]')
			return
		}

		const ms = process.env['FF_BENCH_MS'] ? Number(process.env['FF_BENCH_MS']) : 2500
		// 开跑前确认背景确实是「预烘焙 1:1 位图」状态（背景是拖拽/悬停每帧成本的大头，
		// 若退回了旧的三层叠加，这一轮的 CPU 数字就没法跟历史值比）
		console.log(
			'[bench-bg]' +
				JSON.stringify(
					await exec(
						win,
						`(() => { const wp = document.querySelector('.wallpaper'); if (!wp) return 'no-wallpaper'; const cs = getComputedStyle(wp); return { size: cs.backgroundSize, opacity: cs.opacity, bakedClass: document.body.classList.contains('ff-baked-bg'), urlKind: (cs.backgroundImage.match(/^(url\\("[^"]{0,30})/) || [])[1] } })()`
					)
				)
		)
		const phases: Phase[] = [
			{ name: 'idle 对照' },
			{ name: '内容区移动鼠标（光标跟随）', pointerPatrol: true, setup: PATROL_SETUP, post: PATROL_POST },
			{ name: '内容区不动（应回静止）', post: PATROL_POST },
			{ name: '拖中间分隔条（向左，宽度真的变）', mouseDrag: -240 },
			{ name: '拖侧栏分隔条（中间分界线应不动）', mouseDrag: -160, dragBar: '.sidebar + .dragbar' },
			{ name: 'idle 收尾' }
		]

		const out: Record<string, unknown>[] = []
		let patrolStop = false
		const patrol = async (): Promise<void> => {
			let i = 0
			while (!patrolStop) {
				i++
				// button 必须带上：不带 button 的合成 mouseMove 会被 Chromium 丢掉，
				// 页面收不到 mousemove（探测读数 moves:0），「光标跟随」阶段会量成 0 核
				win.webContents.sendInputEvent({
					type: 'mouseMove',
					x: 500 + ((i * 137) % 800),
					y: 150 + ((i * 91) % 700),
					button: 'left'
				} as Parameters<typeof win.webContents.sendInputEvent>[0])
				await sleep(180)
			}
		}
		for (const p of phases) {
			await exec(win, 'window.__ffBenchReset()')
			if (p.setup) await exec(win, p.setup)
			if (p.pointerPatrol) void patrol()
			await sleep(1200)
			const c0 = await psCpu()
			const t0 = Date.now()
			let running: Promise<unknown>
			if (p.mouseDrag) {
				running = (async () => {
					const rafOk = (await exec(
						win,
						`new Promise((r) => { const t = setTimeout(() => r('rAF 超时未触发'), 900); requestAnimationFrame(() => { clearTimeout(t); r('rAF 正常') }) })`
					)) as string
					const barSel = p.dragBar ?? '.cm-layout .dragbar'
					const g = JSON.parse(
						(await exec(
							win,
							`(() => { const b = document.querySelector(${JSON.stringify(barSel)}); if (!b) return 'null'; const r = b.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(300, r.height / 2)) }) })()`
						)) as string
					) as { x: number; y: number } | null
					if (!g) return '未找到拖拽条 ' + barSel
					const send = (type: string, x: number, y: number): void =>
						win.webContents.sendInputEvent({ type, x, y, button: 'left' } as Parameters<typeof win.webContents.sendInputEvent>[0])
					// 列表/编辑器宽度一起报：中间那条分隔条现在调的是编辑器宽度，列表吃掉剩余
					const widthOf = async (): Promise<string> =>
						(await exec(
							win,
							`(() => { const l = document.querySelector('.cm-list').getBoundingClientRect().width, e = document.querySelector('.cm-editor').getBoundingClientRect().width; return Math.round(l) + '/' + Math.round(e) })()`
						)) as string
					// 按下前先记一份几何：用来证明「拖这条时另一条不动」
					const spotJs = `(() => {
						const spot = (sel) => {
							const el = document.querySelector(sel)
							if (!el) return null
							const b = el.getBoundingClientRect()
							return [Math.round(b.x), Math.round(b.width)]
						}
						return JSON.stringify({ sidebarBar: spot('.sidebar + .dragbar'), midBar: spot('.cm-layout .dragbar'), list: spot('.cm-list'), editor: spot('.cm-editor') })
					})()`
					const geoBefore = (await exec(win, spotJs)) as string
					send('mouseDown', g.x, g.y)
					const series: string[] = []
					let geo = ''
					const d0 = Date.now()
					while (Date.now() - d0 < ms) {
						const k = (Date.now() - d0) / ms
						send('mouseMove', g.x + Math.round((p.mouseDrag! * (1 - Math.cos(k * Math.PI * 2))) / 2), g.y)
						if (series.length < 12) series.push(await widthOf())
						if (!geo && k > 0.5) {
							// 拖拽中途抽查几何：手柄中心是否正好落在「松手后会落到的分界线上」
							geo = (await exec(
								win,
								`(() => {
									const bar = document.querySelector(${JSON.stringify(barSel)})
									const r = bar.getBoundingClientRect()
									const pane = bar.previousElementSibling
									const pr = pane.getBoundingClientRect()
									// 拖动中抽查几何：手柄中心是否落在分界线上 + 两条分隔条/两个面板各在哪
									const spot = (sel) => {
										const el = document.querySelector(sel)
										if (!el) return null
										const b = el.getBoundingClientRect()
										return [Math.round(b.x), Math.round(b.width)]
									}
									return JSON.stringify({
										handleX: Math.round(r.x + r.width / 2),
										paneEdgeX: Math.round(pr.right),
										barX: Math.round(r.x),
										dragging: bar.classList.contains('dragging'),
										sidebarBar: spot('.sidebar + .dragbar'),
										midBar: spot('.cm-layout .dragbar'),
										list: spot('.cm-list'),
										editor: spot('.cm-editor')
									})
								})()`
							)) as string
						}
						await sleep(40)
					}
					const geoAfter = (await exec(win, spotJs)) as string
					send('mouseUp', g.x, g.y)
					return `${rafOk} 按下前=${geoBefore} 拖动中=${geo} 松手前=${geoAfter} 宽度序列=${series.join(',')}`
				})()
			} else {
				// 非拖拽阶段：页面侧什么都不做，只按同样时长静置对照
				running = exec(win, `window.__ffBenchIdle(${ms})`)
			}
			await sleep(ms + 200)
			const c1 = await psCpu()
			const t1 = Date.now()
			patrolStop = true
			const pageRes = await running
			const secs = (t1 - t0) / 1000
			const cores = c1 - c0 > 0 ? (c1 - c0) / secs : 0
			const postRes = p.post ? await exec(win, p.post) : undefined
			const row = { name: p.name, cores: Math.round(cores * 100) / 100, cpuSecs: Math.round((c1 - c0) * 10) / 10, secs: Math.round(secs * 10) / 10, page: pageRes }
			out.push(row)
			console.log(`[bench] ${p.name.padEnd(30)} ${cores.toFixed(2)} 核/秒   (${row.cpuSecs}CPU秒 / ${row.secs}s)`)
			if (postRes) console.log(`[bench-probe] ${p.name} ${postRes}`)
		}
		console.log('[bench-raw]' + JSON.stringify({ cores: await exec(win, 'navigator.hardwareConcurrency'), phases: out }))
	} catch (e) {
		console.log('[bench-err]' + String(e instanceof Error ? e.message : e))
	}
}
