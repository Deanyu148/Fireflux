/**
 * 性能 / 交互归因台（开发辅助）
 *   node scripts/bench-drag.mjs                     CPU 归因 + 拖拽几何校验
 *   FF_INTERACT_TEST=1 node scripts/bench-drag.mjs  看板娘互动链路（唤醒/冻结/收敛曲线/跟随 CPU/命中）
 *   FF_SMOKE=1 node scripts/bench-drag.mjs          逐页冒烟
 *   可选环境变量：FF_BENCH_MS 每阶段时长、FF_L2D_RES 临时改看板娘渲染分辨率（需 dev 同源）、
 *   FF_SHOT=<路径> 存截图（冒烟＝整窗与编辑器，互动＝看板娘区域，默认为 l2d-check.png）
 * 结果以 [bench]/[itx]/[smoke] 行打印，CPU 归因模式的最后一行 [bench-raw] 是 JSON。
 * 跑之前先 pnpm build：它启动的是构建产物（electron .）。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const exe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
if (!existsSync(exe)) throw new Error('未找到 electron.exe，请先 pnpm install')

console.log('[bench] 启动应用…')
const child = spawn(exe, ['.'], { cwd: root, env: { ...process.env, FF_DRAG_BENCH: '1' } })
let buf = ''
let done = false
// 只转出关心的行；stderr 也走同一套过滤（主进程的崩溃信息从这里来）
const interesting = /\[bench|\[itx|\[smoke|Renderer process crashed|异常退出/
const echo = (s) => {
	for (const line of s.split('\n')) {
		if (interesting.test(line)) console.log(line.trimEnd())
	}
}
child.stdout.on('data', (d) => {
	const s = d.toString()
	buf += s
	echo(s)
	if (!done && buf.includes('[bench-raw]')) {
		done = true
		child.kill()
		setTimeout(() => process.exit(0), 300)
	}
	if (!done && buf.includes('[bench-done]')) {
		done = true
		child.kill()
		setTimeout(() => process.exit(0), 300)
	}
})
child.stderr.on('data', (d) => {
	const s = d.toString()
	buf += s
	echo(s)
})
const timer = setTimeout(() => {
	console.error('[bench] 超时。最近输出：')
	console.error(buf.split('\n').slice(-20).join('\n'))
	child.kill()
	process.exit(1)
}, 420_000)
child.on('exit', () => {
	clearTimeout(timer)
	if (!done) {
		console.error('[bench] 未捕获到结果')
		process.exit(1)
	}
})
