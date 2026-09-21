import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import markedKatex from 'marked-katex-extension'
import hljs from 'highlight.js/lib/common'
// 副作用导入：给 KaTeX 注册 \ce{} 化学式语法（katex 的 exports 里没带它的类型声明，
// 见 lib/katex-contrib.d.ts）
import 'katex/contrib/mhchem'

/**
 * Markdown 预览渲染，对齐博客能力：
 * GFM + 代码高亮 + KaTeX 公式（含 mhchem 化学式）+ ::: 提示块 + ::github 仓库卡片
 * + [!NOTE] 引用块 + 本地图片路径重写为 data URL
 */

const marked = new Marked(
	markedHighlight({
		emptyLangClass: 'hljs',
		langPrefix: 'hljs language-',
		highlight(code, lang) {
			const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
			return hljs.highlight(code, { language }).value
		}
	}),
	markedKatex({ throwOnError: false })
)

interface Frontmatter {
	fm: Record<string, string>
	body: string
}

/** 剥离并极简解析 frontmatter（只取 key: 单行值，够预览头部用） */
export function splitFrontmatter(md: string): Frontmatter {
	const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(md)
	if (!m) return { fm: {}, body: md }
	const fm: Record<string, string> = {}
	for (const line of m[1].split(/\r?\n/)) {
		const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
		if (!kv) continue
		let v = kv[2].trim()
		if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1)
		if (v) fm[kv[1].toLowerCase()] = v
	}
	return { fm, body: md.slice(m[0].length) }
}

export function parseTags(raw: string | undefined): string[] {
	if (!raw) return []
	const inner = /^\[.*\]$/.test(raw) ? raw.slice(1, -1) : raw
	return inner
		.split(/[,，]/)
		.map((s) => s.trim().replace(/^["']|["']$/g, ''))
		.filter(Boolean)
}

/** ::github{repo="owner/name"} → 仓库卡片 */
function transformGithubDirective(md: string): string {
	return md.replace(/::github\{repo=["']([^"']+)["']\}/g, (_m, repo: string) => {
		const safe = repo.replace(/[<>"'`]/g, '')
		const [owner, name] = safe.split('/')
		return `<a class="gh-card" href="https://github.com/${safe}" target="_blank" rel="noreferrer"><span class="gh-icon">⭐</span><span class="gh-name">${owner ?? ''}<b>/${name ?? ''}</b></span><span class="gh-sub">GitHub 仓库</span></a>`
	})
}

/** :::type 标题 ... ::: 提示块 → 带样式的卡片（内部再走一遍 markdown 渲染） */
function transformCallouts(md: string): string {
	return md.replace(/^:::([\w-]+)(?:[ \t]+([^\n]*))?\n([\s\S]*?)\n?:::[ \t]*(?:\n|$)/gm, (_m, type: string, title: string | undefined, inner: string) => {
		const bodyHtml = marked.parse(inner ?? '', { async: false })
		const t = (title ?? '').replace(/[<>]/g, '').trim() || type
		return `<div class="callout co-${type}"><div class="co-title">${t}</div><div class="co-body">${bodyHtml}</div></div>\n`
	})
}

/** 相对路径解析（相对于 md 文件所在目录，项目根为基准） */
function resolveRel(fromDir: string, rel: string): string {
	const parts = fromDir ? fromDir.split('/') : []
	for (const seg of rel.split('/')) {
		if (seg === '' || seg === '.') continue
		if (seg === '..') parts.pop()
		else parts.push(seg)
	}
	return parts.join('/')
}

export function escapeHtml(s: string): string {
	return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

/** 找出受保护的代码区间（围栏代码块 + 行内代码），这些区域不做任何表达式处理 */
function codeRanges(s: string): [number, number][] {
	const ranges: [number, number][] = []
	let i = 0
	while (i < s.length) {
		const lineStart = i === 0 || s[i - 1] === '\n'
		if (lineStart && (s.startsWith('```', i) || s.startsWith('~~~', i))) {
			const marker = s.startsWith('```', i) ? '```' : '~~~'
			const closeIdx = s.indexOf(`\n${marker}`, i + 3)
			if (closeIdx !== -1) {
				const closeEnd = s.indexOf('\n', closeIdx + 1)
				const stop = closeEnd === -1 ? s.length : closeEnd + 1
				ranges.push([i, stop])
				i = stop
				continue
			}
		}
		if (s[i] === '`') {
			let j = i + 1
			while (j < s.length && s[j] !== '`' && s[j] !== '\n') j++
			if (j < s.length && s[j] === '`') {
				ranges.push([i, j + 1])
				i = j + 1
				continue
			}
		}
		i++
	}
	return ranges
}

/** 按保护区间切段：code=true 的段原样保留 */
function splitProtected(s: string): { text: string; code: boolean }[] {
	const ranges = codeRanges(s)
	const parts: { text: string; code: boolean }[] = []
	let pos = 0
	for (const [a, b] of ranges) {
		if (a > pos) parts.push({ text: s.slice(pos, a), code: false })
		parts.push({ text: s.slice(a, b), code: true })
		pos = b
	}
	if (pos < s.length) parts.push({ text: s.slice(pos), code: false })
	return parts
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
	let cur: unknown = obj
	for (const key of path.split('.')) {
		if (cur === null || typeof cur !== 'object') return undefined
		cur = (cur as Record<string, unknown>)[key]
	}
	return cur
}

function arrayToTable(arr: Record<string, unknown>[]): string {
	const cols = [...new Set(arr.flatMap((o) => Object.keys(o)))]
	const head = `<tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`
	const rows = arr
		.map((o) => `<tr>${cols.map((c) => `<td>${escapeHtml(String(o[c] ?? ''))}</td>`).join('')}</tr>`)
		.join('')
	return `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`
}

/**
 * MDX 最佳努力渲染：去掉 JSX 注释；求值 export const 并移除语句；
 * 替换 {site.name} 简单取值；可求值的复杂表达式转表格，JSX 语法隐藏。
 * 围栏代码块 / 行内代码里的内容一律不动（表达式可跨越它们配对）。
 */
export function transformMdx(md: string): string {
	// 第一步：仅在非代码区去掉注释和 export 语句
	const cleaned = splitProtected(md)
		.map((p) =>
			p.code
				? p.text
				: p.text.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^export (?:const|let|var) (\w+)\s*(=[\s\S]*?;)[ \t]*(?:\r?\n|$)/gm, '')
		)
		.join('')
	// 第二步：从原文收集 export 数据（上面清理时已从正文移除）
	const names: string[] = []
	const stmts: string[] = []
	{
		const re = /^export (?:const|let|var) (\w+)\s*(=[\s\S]*?;)[ \t]*(?:\r?\n|$)/gm
		let m: RegExpExecArray | null
		while ((m = re.exec(md)) !== null) {
			names.push(m[1])
			stmts.push(`const ${m[1]} ${m[2]}`)
		}
	}
	let scope: Record<string, unknown> = {}
	if (names.length) {
		try {
			const fn = new Function(`${stmts.join('\n')}\nreturn { ${names.join(', ')} };`)
			scope = fn() ?? {}
		} catch {
			/* 求值失败保留原文 */
		}
	}
	// 没有 MDX 数据就不动表达式（保护普通文档里的花括号）
	if (!Object.keys(scope).length) return cleaned
	// 第三步：花括号配对扫描（跳过保护区间），逐个求值替换
	const ranges = codeRanges(cleaned)
	const rangeEnds = new Map<number, number>(ranges.map(([a, b]) => [a, b]))
	let out = ''
	let i = 0
	while (i < cleaned.length) {
		const rangeEnd = rangeEnds.get(i)
		if (rangeEnd !== undefined) {
			out += cleaned.slice(i, rangeEnd)
			i = rangeEnd
			continue
		}
		if (cleaned[i] !== '{') {
			out += cleaned[i]
			i++
			continue
		}
		const end = findBracedSkipping(cleaned, i, ranges)
		if (end === -1) {
			out += cleaned[i]
			i++
			continue
		}
		const expr = cleaned.slice(i + 1, end).trim()
		out += expr ? evalMdxExpr(expr, cleaned.slice(i, end + 1), scope) : cleaned.slice(i, end + 1)
		i = end + 1
	}
	return out
}

/** 找到与 start 处 { 配对的 }（跳过保护区间内的括号），找不到返回 -1 */
function findBracedSkipping(s: string, start: number, ranges: [number, number][]): number {
	let depth = 0
	let i = start
	while (i < s.length) {
		const range = ranges.find(([a, b]) => i >= a && i < b)
		if (range) {
			i = range[1]
			continue
		}
		if (s[i] === '{') depth++
		else if (s[i] === '}') {
			depth--
			if (depth === 0) return i
		}
		i++
	}
	return -1
}

/**
 * 求值单个 MDX 表达式：
 * 成功 → 基本值替换 / 对象数组转表格；
 * 失败（JSX）→ 降级展示数据源（{[...].map} 的数组、{notes.map} 的数据源），仍不行则隐藏。
 */
function evalMdxExpr(expr: string, original: string, scope: Record<string, unknown>): string {
	const keys = Object.keys(scope)
	const vals = keys.map((k) => scope[k])
	try {
		const fn = new Function(...keys, `"use strict"; return (${expr});`)
		const v = fn(...vals)
		if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return escapeHtml(String(v))
		if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null) {
			return arrayToTable(v as Record<string, unknown>[])
		}
		if (v === undefined || v === null) return ''
	} catch {
		/* JSX 等 → 走降级逻辑 */
	}
	// 降级 1：{[...].map(item => JSX)} → 把数组本身渲染成表格
	if (expr.startsWith('[')) {
		let depth = 0
		for (let i = 0; i < expr.length; i++) {
			if (expr[i] === '[') depth++
			else if (expr[i] === ']') {
				depth--
				if (depth === 0) {
					try {
						const fn = new Function(...keys, `"use strict"; return (${expr.slice(0, i + 1)});`)
						const v = fn(...vals)
						if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null) {
							return arrayToTable(v as Record<string, unknown>[])
						}
					} catch {
						/* 继续降级 */
					}
					break
				}
			}
		}
	}
	// 降级 2：{notes.map(...)} → 直接展示数据源
	const idm = /^([A-Za-z_$][\w$]*)\s*[.[(]/.exec(expr)
	if (idm) {
		const base = scope[idm[1]]
		if (Array.isArray(base) && base.length > 0 && typeof base[0] === 'object' && base[0] !== null) {
			return arrayToTable(base as Record<string, unknown>[])
		}
		if (base !== undefined && typeof base !== 'object') return escapeHtml(String(base))
	}
	// 降级 3：作用域里没有的路径（如 {item.label}）保留原文
	const simple = /^([A-Za-z_$][\w$]*(?:\.[\w$]+)+)$/.exec(expr)
	if (simple) {
		const v = getPath(scope, simple[1])
		if (v === undefined || typeof v === 'object') return original
		return escapeHtml(String(v))
	}
	return ''
}

/** 把 markdown 里的本地图片引用算出项目内相对路径（外链返回 null） */
function localImgPath(src: string, mdRel: string): string | null {
	if (/^(https?:|data:|blob:)/i.test(src)) return null
	if (src.startsWith('/')) return src.slice(1)
	const dir = mdRel.includes('/') ? mdRel.slice(0, mdRel.lastIndexOf('/')) : ''
	return resolveRel(dir, src)
}

/** 渲染 markdown；本地图片标记为 data-local，由组件异步填充 data URL */
export function renderMarkdown(md: string, mdRel: string): string {
	const prepared = transformCallouts(transformGithubDirective(md))
	const html = marked.parse(prepared, { async: false })
	const t = document.createElement('template')
	t.innerHTML = html
	t.content.querySelectorAll('img').forEach((img) => {
		const src = img.getAttribute('src') ?? ''
		const local = src ? localImgPath(src, mdRel) : null
		if (local) {
			img.setAttribute('data-local', local)
			img.removeAttribute('src')
		}
		img.setAttribute('loading', 'lazy')
	})
	// GitHub 风格 [!NOTE] 引用块
	t.content.querySelectorAll('blockquote').forEach((bq) => {
		const first = bq.querySelector('p')
		const m = first && /^\[!(\w+)\][ \t]*(.*)/.exec(first.textContent ?? '')
		if (!m) return
		bq.classList.add('callout', `co-${m[1].toLowerCase()}`)
		const title = document.createElement('div')
		title.className = 'co-title'
		title.textContent = m[2].trim() || m[1]
		if (first) {
			const rest = (first.textContent ?? '').replace(/^\[!\w+\][ \t]*/, '')
			first.textContent = rest || ''
		}
		bq.prepend(title)
	})
	return t.innerHTML
}
