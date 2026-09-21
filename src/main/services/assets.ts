import { dialog } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getProject } from './settings'
import { stamp } from './files'

/**
 * 资源导入通道：选本地文件 → 复制到博客约定目录 → 生成引用路径。
 * 引用规则（博客约定）：带 / 开头 = public 直通；不带 = 相对 src 走构建优化。
 */
interface AssetTarget {
	dir: string
	ref: (name: string) => string
	filters: { name: string; extensions: string[] }[]
}

const ASSET_TARGETS: Record<string, AssetTarget> = {
	'wallpaper-desktop': {
		dir: 'src/assets/images/DesktopWallpaper',
		ref: (n) => `assets/images/DesktopWallpaper/${n}`,
		filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif'] }]
	},
	'wallpaper-mobile': {
		dir: 'src/assets/images/MobileWallpaper',
		ref: (n) => `assets/images/MobileWallpaper/${n}`,
		filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif'] }]
	},
	avatar: {
		dir: 'src/assets/images',
		ref: (n) => `assets/images/${n}`,
		filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif'] }]
	},
	logo: {
		dir: 'src/assets/images/logo',
		ref: (n) => `assets/images/logo/${n}`,
		filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }]
	},
	video: {
		dir: 'public/assets/video',
		ref: (n) => `/assets/video/${n}`,
		filters: [{ name: '视频', extensions: ['mp4', 'webm'] }]
	},
	music: {
		dir: 'public/assets/music',
		ref: (n) => `/assets/music/${n}`,
		filters: [{ name: '音频', extensions: ['mp3', 'flac', 'ogg', 'wav', 'm4a'] }]
	},
	'music-cover': {
		dir: 'public/assets/music/cover',
		ref: (n) => `/assets/music/cover/${n}`,
		filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
	},
	'music-lrc': {
		dir: 'public/assets/music/lrc',
		ref: (n) => `/assets/music/lrc/${n}`,
		filters: [{ name: '歌词', extensions: ['lrc', 'txt'] }]
	},
	'dynamic-image': {
		dir: 'public/images/dynamic',
		ref: (n) => `/images/dynamic/${n}`,
		filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif'] }]
	},
	sponsor: {
		dir: 'public/assets/images/sponsor',
		ref: (n) => `/assets/images/sponsor/${n}`,
		filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
	},
	favicon: {
		dir: 'public/favicon',
		ref: (n) => `/favicon/${n}`,
		filters: [{ name: '图片', extensions: ['png', 'ico', 'svg'] }]
	},
	'post-image': {
		dir: 'src/content/posts/images',
		ref: (n) => `../images/${n}`,
		filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif'] }]
	},
}

/** 导入资源：弹出文件选择框，复制到目标目录，返回引用路径列表 */
export async function importAsset(targetId: string): Promise<string[]> {
	const target = ASSET_TARGETS[targetId]
	if (!target) throw new Error('未知的资源类型：' + targetId)
	const root = getProject()
	const destDir = path.join(root, target.dir)
	await fs.mkdir(destDir, { recursive: true })
	const picked = await dialog.showOpenDialog({
		title: '选择要导入的文件（将复制到项目资源目录）',
		properties: ['openFile', 'multiSelections'],
		filters: target.filters
	})
	if (picked.canceled || !picked.filePaths.length) return []
	const out: string[] = []
	for (const src of picked.filePaths) {
		const ext = path.extname(src)
		const base = path.basename(src, ext)
		const destName = `${base}-${stamp()}${ext || '.bin'}`
		await fs.copyFile(src, path.join(destDir, destName))
		out.push(target.ref(destName))
	}
	return out
}
