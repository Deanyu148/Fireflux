import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { getProject } from './settings'
import type { BranchInfo, GitStatus, LogEntry, MergeResult, RemoteInfo } from '../../shared/types'

const execFileP = promisify(execFile)

async function git(args: string[], timeout = 300_000): Promise<string> {
	const cwd = getProject()
	try {
		const { stdout, stderr } = await execFileP('git', args, {
			cwd,
			windowsHide: true,
			maxBuffer: 10 * 1024 * 1024,
			timeout
		})
		return (stdout + (stderr ? `\n${stderr}` : '')).trim()
	} catch (err) {
		const e = err as { stderr?: string; message?: string }
		throw new Error(e.stderr?.trim() || e.message || 'git 命令执行失败')
	}
}

type ProgressFn = (line: string) => void

/** 流式执行 git 命令：实时回报进度行（fetch/push 的百分比、速度等） */
function gitStream(
	args: string[],
	onLine: ProgressFn | undefined,
	timeout = 600_000
): Promise<{ code: number; log: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn('git', args, { cwd: getProject(), windowsHide: true })
		let full = ''
		let timer: NodeJS.Timeout | undefined
		const feed = (chunk: Buffer): void => {
			const text = chunk.toString('utf8')
			full += text
			if (!onLine) return
			const segs = text.split(/[\r\n]+/).filter(Boolean)
			const last = segs[segs.length - 1]
			if (last) onLine(last)
		}
		child.stdout?.on('data', feed)
		child.stderr?.on('data', feed)
		child.on('error', (err) => {
			clearTimeout(timer)
			reject(err)
		})
		timer = setTimeout(() => {
			child.kill()
			reject(new Error('git 操作超时'))
		}, timeout)
		child.on('close', (code) => {
			clearTimeout(timer)
			resolve({ code: code ?? -1, log: full.trim() })
		})
	})
}

export async function gitStatus(): Promise<GitStatus> {
	try {
		const out = await git(['status', '--porcelain=v1', '-b'], 30_000)
		const lines = out.split('\n').filter(Boolean)
		const branch = (lines[0] ?? '').replace(/^##\s*/, '').trim().split('...')[0].split(' ')[0]
		const files = lines.slice(1).map((l) => ({
			flag: l.slice(0, 2).trim() || '??',
			file: l.slice(3).replace(/^"|"$/g, '')
		}))
		return { ok: true, branch, files }
	} catch (err) {
		return { ok: false, files: [], error: (err as Error).message }
	}
}

/** git add -A + git commit：暂存全部改动并提交（不推送，推送是独立的 pushTo） */
export async function gitCommitPush(message: string): Promise<string> {
	const logs: string[] = []
	const step = async (args: string[]): Promise<void> => {
		try {
			const out = await git(args)
			logs.push(`$ git ${args.join(' ')}\n${out || '（完成）'}`)
		} catch (err) {
			logs.push(`$ git ${args.join(' ')}\n[失败] ${(err as Error).message}`)
			throw new Error(logs.join('\n\n'))
		}
	}
	await step(['add', '-A'])
	const rest = await git(['status', '--porcelain=v1'], 30_000)
	if (!rest.trim()) {
		return logs.join('\n\n') + '\n\n没有需要提交的改动。'
	}
	await step(['commit', '-m', message])
	return logs.join('\n\n')
}

export async function remoteList(): Promise<RemoteInfo[]> {
	const out = await git(['remote', '-v'], 30_000)
	const map = new Map<string, RemoteInfo>()
	for (const line of out.split('\n').filter(Boolean)) {
		const [name, rest] = line.split('\t')
		if (!name) continue
		const url = rest.replace(/\s+\((fetch|push)\)$/, '')
		const cur = map.get(name) ?? { name, fetch: '', push: '' }
		if (rest.endsWith('(push)')) cur.push = url
		else cur.fetch = url
		map.set(name, cur)
	}
	return [...map.values()]
}

export async function remoteAdd(name: string, url: string): Promise<void> {
	await git(['remote', 'add', name.trim(), url.trim()], 30_000)
}

export async function remoteRemove(name: string): Promise<void> {
	await git(['remote', 'remove', name], 30_000)
}

/* ==================== 分支 ==================== */

export async function branchList(): Promise<BranchInfo[]> {
	const out = await git(['branch', '--format=%(HEAD)%(refname:short)'], 30_000)
	return out
		.split('\n')
		.filter(Boolean)
		.map((l) => ({ name: l.replace(/^\*/, '').trim(), current: l.startsWith('*') }))
}

export async function branchCreate(name: string): Promise<void> {
	if (!/^[\w./-]+$/.test(name)) throw new Error('分支名只能包含字母、数字、点、横线、下划线')
	await git(['switch', '-c', name], 30_000)
}

export async function branchSwitch(name: string): Promise<void> {
	await git(['switch', name], 30_000)
}

async function hasConflicts(): Promise<boolean> {
	const st = await gitStatus()
	return st.ok && st.files.some((f) => /^(UU|AA|DD|AU|UA|DU|UD)/.test(f.flag))
}

export async function mergeBranch(name: string): Promise<MergeResult> {
	let log = ''
	let code = 0
	try {
		const res = await gitStream(['merge', name, '--no-edit'], undefined, 120_000)
		log = res.log
		code = res.code
	} catch (err) {
		log = (err as Error).message
		code = -1
	}
	return { ok: code === 0, log, conflicted: await hasConflicts() }
}

/** fetch 远程仓库（带进度，不合并） */
export async function fetchRemote(remote: string, onLine?: ProgressFn): Promise<void> {
	await gitStream(['fetch', '--progress', remote], onLine, 600_000)
}

/** 列出某个远程的所有分支（fetch 后调用） */
export async function remoteBranchList(remote: string): Promise<string[]> {
	const out = await git(['branch', '-r', '--list', remote + '/*'], 30_000)
	return out
		.split('\n')
		.map((l) => l.trim().replace(/^\* /, ''))
		.filter(Boolean)
}

/** 合并任意引用（远程分支 / FETCH_HEAD）到当前分支 */
export async function mergeRef(ref: string): Promise<MergeResult> {
	return mergeBranch(ref)
}

/* ==================== 差异与推送 ==================== */

export async function diffFile(rel: string): Promise<string> {
	return git(['diff', 'HEAD', '--', rel], 30_000)
}

export async function diffAll(): Promise<string> {
	return git(['diff', 'HEAD'], 60_000)
}

export async function diffNames(): Promise<string> {
	return git(['diff', '--name-only', 'HEAD'], 30_000)
}

export async function pushTo(
	remote: string,
	branch: string,
	force: boolean,
	onLine?: ProgressFn
): Promise<string> {
	// 非强制推送带 -u 记录上游分支；--force 时不改上游设置
	const args = ['push', '--progress', ...(force ? ['--force'] : ['-u']), remote, branch]
	const res = await gitStream(args, onLine)
	if (res.code !== 0) throw new Error(res.log || '推送失败')
	return res.log || '（推送完成）'
}

/* ==================== 暂存 / 提交 / 日志 ==================== */

/** git add -A：暂存全部改动，返回暂存区统计 */
export async function addAll(): Promise<string> {
	await git(['add', '-A'])
	return (await git(['diff', '--cached', '--stat'], 30_000)) || '（暂存区没有变化）'
}

/** git commit -m：提交暂存区内容（未暂存任何内容时会报错提示） */
export async function commitStaged(message: string): Promise<string> {
	return git(['commit', '-m', message])
}

/** git log -n X：最近 N 条提交记录（取值 1~200，非法或缺省时按 20） */
export async function gitLog(count: number): Promise<LogEntry[]> {
	const n = Math.min(200, Math.max(1, Math.floor(count) || 20))
	const out = await git(
		['log', `-n`, String(n), '--pretty=format:%h|%an|%ad|%s', '--date=format:%Y-%m-%d %H:%M'],
		30_000
	)
	return out
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const [hash = '', author = '', date = '', ...rest] = line.split('|')
			return { hash, author, date, subject: rest.join('|') }
		})
}
