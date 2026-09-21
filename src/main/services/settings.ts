import { app, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AppearanceSettings, DataDirInfo } from '../../shared/types'

/** 客户端全局设置（data/settings.json 的全部内容；appearance 见 shared/types.ts） */
interface AppSettings {
	/** 已绑定的 Firefly 项目根目录（blog 里含 src 的那一层） */
	projectPath?: string
	appearance?: AppearanceSettings
	/** 实验开关：允许 GPU 独立进程参与渲染（软件渲染时反而是 in-process-gpu + SwiftShader） */
	hardwareGpu?: boolean
	/** 上次启动实际使用的渲染模式，用于检测模式切换并清理 GPU 缓存 */
	lastGpuMode?: 'sw' | 'hw'
}

/**
 * 指针文件 pointer.json（记录 lastProject 与自定义 dataDir）固定放在默认数据根目录，
 * 因为它是「数据目录在哪」的唯一线索，不能跟着数据目录跑。
 */
interface Pointer {
	lastProject?: string
	dataDir?: string
}

/** 依次尝试创建并写入探测文件，返回第一个可写目录（都失败返回最后一个候选） */
function firstWritableDir(candidates: string[]): string {
	for (const dir of candidates) {
		try {
			fs.mkdirSync(dir, { recursive: true })
			const probe = path.join(dir, '.write-test')
			fs.writeFileSync(probe, 'ok')
			fs.rmSync(probe)
			return dir
		} catch {
			/* 尝试下一个候选 */
		}
	}
	return candidates[candidates.length - 1]
}

/** 数据根目录：开发模式放管理器项目 data/；安装版放安装目录 data\，不可写时回退系统目录 */
function dataRoot(): string {
	if (!app.isPackaged) return path.join(app.getAppPath(), 'data')
	return firstWritableDir([path.join(path.dirname(app.getPath('exe')), 'data'), path.join(app.getPath('userData'), 'data')])
}

/** 供主进程启动时把 Electron userData 一并指到便携目录 */
export function portableDataRoot(): string {
	return dataRoot()
}

const pointerFile = (): string => path.join(dataRoot(), 'pointer.json')

export function readPointer(): Pointer {
	try {
		return JSON.parse(fs.readFileSync(pointerFile(), 'utf8')) as Pointer
	} catch {
		return {}
	}
}

function writePointer(p: Pointer): void {
	fs.mkdirSync(path.dirname(pointerFile()), { recursive: true })
	fs.writeFileSync(pointerFile(), JSON.stringify(p, null, 2), 'utf8')
}


/** 当前生效的数据目录：用户在设置里换过就用那个，否则用默认的（客户端自己旁边） */
function currentDataDir(): string {
	return readPointer().dataDir || dataRoot()
}

function settingsFile(): string {
	return path.join(currentDataDir(), 'settings.json')
}

export function getSettings(): AppSettings {
	try {
		return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as AppSettings
	} catch {
		return {}
	}
}

function saveSettings(s: AppSettings): void {
	const dir = currentDataDir()
	fs.mkdirSync(dir, { recursive: true })
	fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2), 'utf8')
}

// ===== 硬件加速渲染（实验）=====
// 默认走 SwiftShader 软件渲染（in-process-gpu + swiftshader 两个参数，见 main/index.ts）；
// 开启后不追加这两个参数，让 GPU 以独立子进程运行。no-sandbox 等防崩溃参数两种模式都保留。
// 开启标记在启动时写入、正常退出时清除；若上次以硬件加速启动但未正常退出（驱动崩溃），
// 本次启动自动回退软件渲染并关闭开关。

/** 启动标记固定放默认数据根目录：用户换过数据目录后仍能定位到上次留下的标记 */
const hwMarkerFile = (): string => path.join(dataRoot(), 'hwgpu.boot')

/**
 * 清理 Chromium 的 GPU / 着色器缓存。
 * 渲染模式切换（软件渲染 ↔ 硬件加速）后旧缓存可能不兼容，导致 WebGL 初始化崩溃、
 * 整个窗口变白；切换模式或检测到硬件加速启动失败时清理，让 Chromium 重新生成。
 */
export function clearGpuCaches(): void {
	try {
		const root = path.join(portableDataRoot(), 'userData')
		for (const name of ['GPUCache', 'ShaderCache', 'GrShaderCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache']) {
			fs.rmSync(path.join(root, name), { recursive: true, force: true })
		}
	} catch {
		/* 忽略 */
	}
}

/** 启动时解析硬件加速是否生效（含崩溃自愈与渲染模式切换时的缓存清理） */
export function resolveHardwareGpu(): boolean {
	const s = getSettings()
	const want = s.hardwareGpu === true

	if (!want) {
		clearHardwareGpuMarker() // 清掉可能残留的标记，避免下次开启时被误判为崩溃
		if (s.lastGpuMode === 'hw') clearGpuCaches() // 从硬件加速切回软件渲染：清掉可能中毒的缓存
		if (s.lastGpuMode !== 'sw') {
			s.lastGpuMode = 'sw'
			saveSettings(s)
		}
		return false
	}

	try {
		if (fs.existsSync(hwMarkerFile())) {
			// 上次以硬件加速启动但未正常退出（驱动不兼容导致崩溃）：回退软件渲染并清缓存
			clearGpuCaches()
			s.hardwareGpu = false
			s.lastGpuMode = 'sw'
			saveSettings(s)
			fs.rmSync(hwMarkerFile(), { force: true })
			console.log('[Fireflux] 检测到上次硬件加速启动异常退出，已自动回退软件渲染')
			return false
		}
		if (s.lastGpuMode !== 'hw') {
			// 首次切到硬件加速：清掉软件渲染时期生成的缓存
			clearGpuCaches()
			s.lastGpuMode = 'hw'
			saveSettings(s)
		}
		fs.writeFileSync(hwMarkerFile(), String(Date.now()), 'utf8')
		return true
	} catch {
		return false
	}
}

/** 正常退出时清除启动标记 */
export function clearHardwareGpuMarker(): void {
	try {
		fs.rmSync(hwMarkerFile(), { force: true })
	} catch {
		/* 忽略 */
	}
}

export function setHardwareGpu(on: boolean): AppSettings {
	const s = getSettings()
	s.hardwareGpu = on
	saveSettings(s)
	return s
}

/** 校验是否是 Firefly 项目根目录 */
export function isValidProject(p: string): boolean {
	try {
		return fs.existsSync(path.join(p, 'src', 'content')) && fs.existsSync(path.join(p, 'src', 'config'))
	} catch {
		return false
	}
}

/** 取当前项目根目录；未绑定或失效时抛错（错误信息直接给用户看） */
export function getProject(): string {
	const p = readPointer().lastProject
	if (!p || !isValidProject(p)) {
		throw new Error('项目文件夹未绑定或已失效，请到「设置」页重新选择 Firefly 项目根目录。')
	}
	return p
}

/** 绑定项目：只记录指针，不动项目里的任何文件 */
export function bindProject(p: string): void {
	writePointer({ ...readPointer(), lastProject: p })
}

export function getAppearance(): AppearanceSettings {
	return getSettings().appearance ?? {}
}

export function setAppearance(patch: AppearanceSettings): AppearanceSettings {
	const s = getSettings()
	const merged: AppearanceSettings = { ...(s.appearance ?? {}), ...patch }
	for (const key of Object.keys(merged) as (keyof AppearanceSettings)[]) {
		if (merged[key] === undefined) delete merged[key]
	}
	s.appearance = merged
	saveSettings(s)
	return merged
}

function wallpaperDir(): string {
	return path.join(currentDataDir(), 'wallpapers')
}

/** 弹窗选择图片并复制到数据目录的 wallpapers/，作为软件壁纸 */
export async function pickWallpaper(): Promise<AppearanceSettings> {
	const picked = await dialog.showOpenDialog({
		title: '选择壁纸图片',
		properties: ['openFile'],
		filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp'] }]
	})
	if (picked.canceled || !picked.filePaths[0]) return getAppearance()
	const src = picked.filePaths[0]
	const dir = wallpaperDir()
	fs.mkdirSync(dir, { recursive: true })
	const dest = path.join(dir, `current${path.extname(src).toLowerCase() || '.png'}`)
	fs.copyFileSync(src, dest)
	return setAppearance({ wallpaper: dest })
}

export function clearWallpaper(): AppearanceSettings {
	const s = getSettings()
	const file = s.appearance?.wallpaper
	if (file && fs.existsSync(file)) {
		try {
			fs.rmSync(file)
		} catch {
			/* 忽略删除失败 */
		}
	}
	return setAppearance({ wallpaper: undefined })
}

/** 壁纸转 data URL 供渲染层直接显示 */
export function wallpaperDataUrl(): string | null {
	const file = getSettings().appearance?.wallpaper
	if (!file || !fs.existsSync(file)) return null
	const buf = fs.readFileSync(file)
	const ext = path.extname(file).toLowerCase()
	const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.avif' ? 'image/avif' : ext === '.bmp' ? 'image/bmp' : 'image/jpeg'
	return `data:${mime};base64,${buf.toString('base64')}`
}

/** 修正 settings.json 里的壁纸路径，使其指向数据目录内的 wallpapers/ */
function fixWallpaperPath(target: string): void {
	try {
		const sf = path.join(target, 'settings.json')
		const settings = JSON.parse(fs.readFileSync(sf, 'utf8')) as AppSettings
		const w = settings.appearance?.wallpaper
		if (!w) return
		const fixed = path.join(target, 'wallpapers', path.basename(w))
		if (fs.existsSync(fixed)) {
			settings.appearance = { ...(settings.appearance ?? {}), wallpaper: fixed }
			fs.writeFileSync(sf, JSON.stringify(settings, null, 2), 'utf8')
		}
	} catch {
		/* 忽略 */
	}
}

/** 复制数据（settings.json / 壁纸）到新目录 */
function copyData(from: string, to: string): void {
	fs.mkdirSync(to, { recursive: true })
	const settingsSrc = path.join(from, 'settings.json')
	if (fs.existsSync(settingsSrc)) fs.copyFileSync(settingsSrc, path.join(to, 'settings.json'))
	const wallSrc = path.join(from, 'wallpapers')
	if (!fs.existsSync(wallSrc)) return
	const wallDest = path.join(to, 'wallpapers')
	fs.mkdirSync(wallDest, { recursive: true })
	for (const f of fs.readdirSync(wallSrc)) fs.copyFileSync(path.join(wallSrc, f), path.join(wallDest, f))
}

export function dataDirInfo(): DataDirInfo {
	return { dataDir: currentDataDir(), isCustom: !!readPointer().dataDir }
}

/** 更换数据目录：现有数据自动复制过去（原目录文件保留），并修正壁纸路径 */
export function changeDataDir(newDir: string | null): DataDirInfo & { appearance: AppearanceSettings } {
	const old = currentDataDir()
	const ptr = readPointer()
	if (newDir) ptr.dataDir = newDir
	else delete ptr.dataDir
	writePointer(ptr)
	const target = currentDataDir()
	if (path.resolve(old) !== path.resolve(target)) copyData(old, target)
	fixWallpaperPath(target)
	return { dataDir: target, isCustom: !!newDir, appearance: getAppearance() }
}
