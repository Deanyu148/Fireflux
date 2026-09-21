import { dialog } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getProject } from './settings'
import type { ContentItem } from '../../shared/types'

/**
 * 相对路径原则：渲染层只传相对项目根目录的路径；
 * 主进程在这里拼接到项目根目录并做白名单校验。
 */
const ALLOWED_ROOTS = ['src/content', 'src/config', 'public']

function resolveAllowed(rel: string): string {
	const root = getProject()
	const abs = path.resolve(root, rel)
	const relFromRoot = path.relative(root, abs).replace(/\\/g, '/')
	if (relFromRoot.startsWith('..') || path.isAbsolute(relFromRoot)) {
		throw new Error('路径越界：' + rel)
	}
	const ok = ALLOWED_ROOTS.some((r) => relFromRoot === r || relFromRoot.startsWith(r + '/'))
	if (!ok) {
		throw new Error('该位置不允许读写（只允许 src/content、src/config、public 下的文件）：' + rel)
	}
	return abs
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** 文件名用时间戳：2026-09-19-183012 */
export function stamp(): string {
	const d = new Date()
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
}

/** frontmatter 用日期：2026-09-19 */
function today(): string {
	const d = new Date()
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 动态的发布时间：2026-09-19 18:30:12 */
function now(): string {
	const d = new Date()
	return `${today()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

async function walkMd(dir: string, root: string, out: ContentItem[]): Promise<void> {
	let entries
	try {
		entries = await fs.readdir(dir, { withFileTypes: true })
	} catch {
		return
	}
	for (const entry of entries) {
		if (entry.name.startsWith('.')) continue
		const abs = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			await walkMd(abs, root, out)
		} else if (/\.mdx?$/i.test(entry.name)) {
			const st = await fs.stat(abs)
			out.push({ rel: path.relative(root, abs).replace(/\\/g, '/'), mtimeMs: st.mtimeMs })
		}
	}
}

const CONTENT_FOLDERS = ['posts', 'projects', 'dynamic', 'spec'] as const
type ContentFolder = (typeof CONTENT_FOLDERS)[number]

export function isContentFolder(v: string): v is ContentFolder {
	return (CONTENT_FOLDERS as readonly string[]).includes(v)
}

export async function listContent(folder: ContentFolder): Promise<ContentItem[]> {
	const root = getProject()
	const out: ContentItem[] = []
	await walkMd(path.join(root, 'src/content', folder), root, out)
	out.sort((a, b) => b.mtimeMs - a.mtimeMs)
	return out
}

export async function readFile(rel: string): Promise<string> {
	return fs.readFile(resolveAllowed(rel), 'utf8')
}

const MIME: Record<string, string> = {
	'.avif': 'image/avif',
	'.webp': 'image/webp',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.bmp': 'image/bmp',
	'.ico': 'image/x-icon',
	'.mp3': 'audio/mpeg',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm'
}

/** 读二进制资源（图片等）转 data URL，供预览使用 */
export async function readDataUrl(rel: string): Promise<string> {
	const abs = resolveAllowed(rel)
	const buf = await fs.readFile(abs)
	const mime = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream'
	return `data:${mime};base64,${buf.toString('base64')}`
}

export async function writeFile(rel: string, content: string): Promise<void> {
	const abs = resolveAllowed(rel)
	await fs.mkdir(path.dirname(abs), { recursive: true })
	await fs.writeFile(abs, content, 'utf8')
}

export async function deleteFile(rel: string): Promise<void> {
	await fs.rm(resolveAllowed(rel))
}

export function postTemplate(title: string, slug: string): string {
	return `---
title: "${title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"
published: ${today()}
description: ''
image: ''
tags: []
category: ''
draft: false
lang: ''
slug: ${slug}
---
`
}

export function projectTemplate(title: string, slug: string): string {
	return `---
title: "${title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"
slug: ${slug}
published: ${today()}
draft: true
order: 99
description: ''
status: "planning"
tags: []
---
`
}

export function dynamicTemplate(content: string, pinned: boolean, location: string): string {
	return `---
published: ${now()}
pinned: ${pinned}
location: "${location.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"
---

${content.trim()}\n`
}

/** 从磁盘导入 md/mdx 文件（原样复制到对应内容文件夹，重名自动加时间戳） */
export async function importContent(folder: ContentFolder): Promise<string[]> {
	const root = getProject()
	const destDir = path.join(root, 'src/content', folder)
	await fs.mkdir(destDir, { recursive: true })
	const picked = await dialog.showOpenDialog({
		title: `选择要导入的 Markdown 文件（将复制到 src/content/${folder}）`,
		properties: ['openFile', 'multiSelections'],
		filters: [{ name: 'Markdown', extensions: ['md', 'mdx'] }]
	})
	if (picked.canceled || !picked.filePaths.length) return []
	const out: string[] = []
	for (const src of picked.filePaths) {
		const ext = path.extname(src) || '.md'
		const base = path.basename(src, ext)
		let name = `${base}${ext}`
		try {
			await fs.access(path.join(destDir, name))
			name = `${base}-${stamp()}${ext}`
		} catch {
			/* 不存在，直接用 */
		}
		await fs.copyFile(src, path.join(destDir, name))
		out.push(`src/content/${folder}/${name}`)
	}
	return out
}
