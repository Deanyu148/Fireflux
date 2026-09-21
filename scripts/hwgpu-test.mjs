/**
 * 硬件加速开关三态验证（开发辅助）：
 *   node scripts/hwgpu-test.mjs
 * 依次验证：默认=软件渲染 → 写入 hardwareGpu=true 启动=硬件加速+写标记 →
 * 预置 hwgpu.boot 标记启动=自动回退+开关复位。前 3 步各启动一次应用、12 秒后结束进程，
 * 第 4 步只复位配置（不启动应用）。
 * 注意：它会改写 data/settings.json（结尾把 hardwareGpu 复位为默认值）。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const exe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const settingsFile = path.join(root, 'data', 'settings.json')
const markerFile = path.join(root, 'data', 'hwgpu.boot')

/** 启动一轮应用并收集输出；到点结束进程（正常退出与超时都只取输出文本） */
function run(seconds = 12) {
	return new Promise((resolve) => {
		const child = spawn(exe, ['.'], { cwd: root, env: { ...process.env } })
		let out = ''
		child.stdout.on('data', (d) => (out += d.toString()))
		child.stderr.on('data', (d) => (out += d.toString()))
		child.on('exit', () => resolve({ out }))
		setTimeout(() => {
			child.kill()
			resolve({ out })
		}, seconds * 1000)
	})
}

const readSettings = () => JSON.parse(readFileSync(settingsFile, 'utf8'))
const mode = (out) => (out.includes('硬件加速（实验）') ? '硬件加速' : out.includes('软件渲染') ? '软件渲染' : '(未输出)')

console.log('== 1) 默认启动（应=软件渲染，无标记） ==')
rmSync(markerFile, { force: true })
const s0 = readSettings()
delete s0.hardwareGpu
writeFileSync(settingsFile, JSON.stringify(s0, null, 2))
const r1 = await run()
console.log('   模式:', mode(r1.out), ' 标记存在:', existsSync(markerFile))

console.log('== 2) 写入 hardwareGpu=true 启动（应=硬件加速，创建标记） ==')
const s1 = readSettings()
s1.hardwareGpu = true
writeFileSync(settingsFile, JSON.stringify(s1, null, 2))
const r2 = await run()
console.log('   模式:', mode(r2.out), ' 标记存在:', existsSync(markerFile))

console.log('== 3) 预置标记再启动（应=自动回退软件渲染且开关复位 false） ==')
writeFileSync(markerFile, String(Date.now()))
const r3 = await run()
const after = readSettings()
console.log('   模式:', mode(r3.out), ' 回退日志:', r3.out.includes('自动回退软件渲染'), ' settings.hardwareGpu =', after.hardwareGpu, ' 标记存在:', existsSync(markerFile))

console.log('== 4) 恢复默认（无 hardwareGpu 字段） ==')
const s2 = readSettings()
delete s2.hardwareGpu
writeFileSync(settingsFile, JSON.stringify(s2, null, 2))
rmSync(markerFile, { force: true })
console.log('done')
