import { Node, Project, type SourceFile } from 'ts-morph'
import fs from 'node:fs'
import path from 'node:path'
import type { ConfigExportData, DiscoveredConfig } from '../../shared/types'

/**
 * 配置引擎：解析博客的 TS 配置文件，提取字段值 + 中文注释（作为表单标签）；
 * 保存时只替换被修改字段的值（精准补丁），注释与其余代码原样保留。
 * 特殊结构处理：AsExpression(as const)、标识符引用、resolver 函数包装、函数返回值。
 */

/** 无法解析的字段用 { __adv: 原文 } 占位，界面显示为「高级模式」文本框 */
interface AdvNode {
	__adv: string
}

function isAdv(v: unknown): v is AdvNode {
	return typeof v === 'object' && v !== null && '__adv' in (v as Record<string, unknown>)
}

/** 一条补丁：pointer 是「对象键.数组下标」路径，value 是要写回去的新值 */
interface Patch {
	pointer: string
	value: unknown
}

const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true })

let projectRoot = ''

/** 注入项目根目录（由 ipc 层每次调用前传入） */
export function setConfigEnv(root: string): void {
	projectRoot = root
}

/** 解析上下文：记录函数体里的局部变量，供 resolveThrough 解开标识符引用 */
interface Ctx {
	localVars: Map<string, Node> | undefined
}

/** 解析 rel 为 src/config 下的绝对路径：渲染层只传相对路径，越界一律拒绝 */
function configPath(rel: string): string {
	const configDir = path.join(projectRoot, 'src', 'config')
	const abs = path.resolve(projectRoot, rel)
	const relFromConfig = path.relative(configDir, abs).replace(/\\/g, '/')
	if (relFromConfig.startsWith('..') || path.isAbsolute(relFromConfig)) {
		throw new Error('该位置不属于配置目录：' + rel)
	}
	return abs
}

function loadSource(rel: string): { sf: SourceFile; abs: string } {
	const abs = configPath(rel)
	const original = fs.readFileSync(abs, 'utf8')
	const sf = project.createSourceFile('__config__.ts', original, { overwrite: true })
	return { sf, abs }
}

function findExportedConst(sf: SourceFile, name: string) {
	const stmt = sf.getVariableStatements().find((s) => s.isExported() && s.getDeclarations().some((d) => d.getNameNode().getText() === name))
	if (!stmt) throw new Error(`在文件中找不到导出常量 ${name}`)
	const init = stmt.getDeclarations()[0].getInitializer()
	if (!init) throw new Error(`导出常量 ${name} 没有可读取的值`)
	return { stmt, init }
}

/** 收集函数体内的局部变量声明（用于解析函数返回值里引用的标识符） */
function collectLocalVars(block: Node): Map<string, Node> | undefined {
	if (!Node.isBlock(block)) return undefined
	const map = new Map<string, Node>()
	for (const st of block.getStatements()) {
		if (Node.isVariableStatement(st)) {
			for (const d of st.getDeclarations()) {
				const init = d.getInitializer()
				if (init) map.set(d.getNameNode().getText(), init)
			}
		}
	}
	return map.size ? map : undefined
}

function isLiteralLike(node: Node): boolean {
	return (
		Node.isObjectLiteralExpression(node) ||
		Node.isArrayLiteralExpression(node) ||
		Node.isStringLiteral(node) ||
		Node.isNumericLiteral(node) ||
		Node.isTrueLiteral(node) ||
		Node.isFalseLiteral(node)
	)
}

/** 解析函数调用：单参数字面量 → 返回参数；无参且文件内有同名函数 → 返回其 return 表达式 */
function resolveCall(sf: SourceFile, call: Node, ctx: Ctx): Node {
	if (!Node.isCallExpression(call)) throw new Error('不是调用表达式')
	const args = call.getArguments()
	const callee = call.getExpression().getText()
	if (args.length === 1 && isLiteralLike(args[0])) {
		return args[0]
	}
	if (args.length === 0) {
		const fn = sf.getFunction(callee)
		const body = fn?.getBody()
		if (fn && body) {
			// 记下函数体局部变量：返回值里的标识符要等 resolveThrough 再解析
			if (!ctx.localVars) ctx.localVars = collectLocalVars(body)
			if (Node.isBlock(body)) {
				const ret = body.getStatements().find((s) => Node.isReturnStatement(s))
				if (ret && Node.isReturnStatement(ret)) {
					const expr = ret.getExpression()
					if (expr) return expr
				}
			}
		}
	}
	throw new Error(`无法解析的表达式：${call.getText().slice(0, 120)}`)
}

/** 层层解包：as const 包装、标识符引用、函数调用包装，直到拿到真实节点 */
function resolveThrough(sf: SourceFile, node: Node, ctx: Ctx): { node: Node; asConst: boolean } {
	let cur = node
	let asConst = false
	for (;;) {
		if (Node.isAsExpression(cur)) {
			asConst = true
			cur = cur.getExpression()
			continue
		}
		if (Node.isIdentifier(cur)) {
			const name = cur.getText()
			const local = ctx.localVars?.get(name)
			if (local) {
				cur = local
				continue
			}
			const stmt = sf.getVariableStatements().find((s) => s.getDeclarations().some((d) => d.getNameNode().getText() === name))
			const init = stmt?.getDeclarations()[0].getInitializer()
			if (init) {
				cur = init
				continue
			}
			throw new Error(`无法解析的引用：${name}`)
		}
		if (Node.isCallExpression(cur)) {
			cur = resolveCall(sf, cur, ctx)
			continue
		}
		break
	}
	return { node: cur, asConst }
}

function cleanComment(text: string): string {
	const lines = text
		.split('\n')
		.map((l) => l.trim())
		.map((l) => l.replace(/^\/\/+\s*/, '').replace(/^\/\*+\s*/, '').replace(/\*+\/$/, '').replace(/^\*+\s*/, ''))
		.filter((l) => l.length > 0)
	const joined = lines.join(' ')
	return joined.slice(0, 80)
}

function propKey(prop: Node): string | undefined {
	if (Node.isPropertyAssignment(prop) || Node.isShorthandPropertyAssignment(prop)) {
		return prop
			.getNameNode()
			.getText()
			.replace(/^['"]|['"]$/g, '')
	}
	return undefined
}

/** 把 AST 节点转成 JSON 可表示的值；无法解析的部分标记为 { __adv: 原文 } */
function toValue(sf: SourceFile, node: Node, pointer: string, labels: Record<string, string>, ctx: Ctx): unknown {
	try {
		const { node: real } = resolveThrough(sf, node, ctx)
		if (Node.isStringLiteral(real)) return real.getLiteralText()
		if (Node.isNumericLiteral(real)) return Number(real.getLiteralText())
		if (Node.isTrueLiteral(real)) return true
		if (Node.isFalseLiteral(real)) return false
		if (Node.isNullLiteral(real)) return null
		if (Node.isTemplateExpression(real)) {
			if (real.getTemplateSpans().length === 0) return real.getHead().getLiteralText()
			return { __adv: real.getText().replace(/\s+/g, ' ').slice(0, 200) }
		}
		if (Node.isObjectLiteralExpression(real)) {
			const obj: Record<string, unknown> = {}
			for (const prop of real.getProperties()) {
				if (Node.isSpreadAssignment(prop)) continue
				const key = propKey(prop)
				if (key === undefined) continue
				const p = pointer ? `${pointer}.${key}` : key
				const comments = prop.getLeadingCommentRanges()
				if (comments.length) {
					const label = cleanComment(comments[comments.length - 1].getText())
					if (label) labels[p] = label
				}
				if (Node.isShorthandPropertyAssignment(prop)) {
					obj[key] = toValue(sf, prop.getNameNode(), p, labels, ctx)
				} else {
					const init = (prop as { getInitializer?: () => Node | undefined }).getInitializer?.()
					obj[key] = init ? toValue(sf, init, p, labels, ctx) : { __adv: key }
				}
			}
			return obj
		}
		if (Node.isArrayLiteralExpression(real)) {
			const elements = real.getElements()
			const items: unknown[] = []
			for (const el of elements) {
				if (Node.isSpreadElement(el)) return { __adv: real.getText().replace(/\s+/g, ' ').slice(0, 200) }
				const v = toValue(sf, el, pointer, labels, ctx)
				if (isAdv(v)) return { __adv: real.getText().replace(/\s+/g, ' ').slice(0, 200) }
				items.push(v)
			}
			return items
		}
		return { __adv: real.getText().replace(/\s+/g, ' ').slice(0, 200) }
	} catch (err) {
		return { __adv: (err as Error).message.slice(0, 200) }
	}
}

export function readConfig(rel: string, exportNames: string[]): ConfigExportData[] {
	const { sf } = loadSource(rel)
	const out: ConfigExportData[] = []
	for (const name of exportNames) {
		const { init } = findExportedConst(sf, name)
		const labels: Record<string, string> = {}
		const values = toValue(sf, init, '', labels, { localVars: undefined })
		out.push({ name, values, labels })
	}
	return out
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v) && !isAdv(v)
}

function eq(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b)
}

/** 深度对比旧值与新值，生成需要补丁的字段清单（数组整体替换，对象逐字段下钻） */
function diffValues(a: unknown, b: unknown, pointer: string, out: Patch[]): void {
	if (isAdv(a) || isAdv(b)) return
	if (Array.isArray(a) && Array.isArray(b)) {
		if (!eq(a, b)) out.push({ pointer, value: b })
		return
	}
	if (isPlainObject(a) && isPlainObject(b)) {
		for (const key of Object.keys(b)) {
			const childPtr = pointer ? `${pointer}.${key}` : key
			diffValues(a[key], b[key], childPtr, out)
		}
		return
	}
	if (!eq(a, b)) out.push({ pointer, value: b })
}

const KEY_RE = /^[A-Za-z_$][\w$]*$/

/** JSON 值 → TS 字面量文本（tab 缩进 + 尾逗号，贴近博客现有风格） */
function literalText(v: unknown, depth = 0): string {
	const tab = (d: number): string => '\t'.repeat(d)
	if (v === null) return 'null'
	if (typeof v === 'string') return JSON.stringify(v)
	if (typeof v === 'number' || typeof v === 'boolean') return String(v)
	if (Array.isArray(v)) {
		if (!v.length) return '[]'
		const items = v.map((x) => `${tab(depth + 1)}${literalText(x, depth + 1)}`)
		return `[\n${items.join(',\n')},\n${tab(depth)}]`
	}
	if (isPlainObject(v)) {
		// 跳过 __adv 占位键：无法解析的字段本就不该被写回配置
		const entries = Object.entries(v).filter(([k]) => !k.startsWith('__'))
		if (!entries.length) return '{}'
		const items = entries.map(([k, x]) => `${tab(depth + 1)}${KEY_RE.test(k) ? k : JSON.stringify(k)}: ${literalText(x, depth + 1)}`)
		return `{\n${items.join(',\n')},\n${tab(depth)}}`
	}
	throw new Error('无法序列化的值：' + String(v))
}

/** 按指针路径导航到目标节点；pointer 为空串表示整个初始化值（仅解包 as const，不穿透调用） */
function navigate(sf: SourceFile, init: Node, segments: string[]): { node: Node; asConst: boolean } {
	let cur = init
	for (const seg of segments) {
		const { node: container } = resolveThrough(sf, cur, { localVars: undefined })
		if (Node.isObjectLiteralExpression(container) && !/^\d+$/.test(seg)) {
			const prop = container
				.getProperties()
				.filter((p) => Node.isPropertyAssignment(p) || Node.isShorthandPropertyAssignment(p))
				.find((p) => propKey(p) === seg)
			if (!prop) throw new Error(`找不到字段：${seg}`)
			if (Node.isShorthandPropertyAssignment(prop)) {
				cur = prop.getNameNode()
			} else {
				const i = (prop as { getInitializer?: () => Node | undefined }).getInitializer?.()
				if (!i) throw new Error(`字段 ${seg} 没有可修改的值`)
				cur = i
			}
		} else if (Node.isArrayLiteralExpression(container)) {
			const idx = Number(seg)
			const el = container.getElements()[idx]
			if (!el) throw new Error(`数组下标越界：${seg}`)
			cur = el
		} else {
			throw new Error(`无法定位：${seg}（父级不是对象或数组）`)
		}
	}
	if (segments.length === 0) {
		if (Node.isAsExpression(cur)) return { node: cur.getExpression(), asConst: true }
		return { node: cur, asConst: false }
	}
	return resolveThrough(sf, cur, { localVars: undefined })
}

interface WriteResult {
	ok: true
	patches: number
}

/** 保存配置：diff → 补丁 → 内存中逐项校验 → 写盘；任一步失败都不会写盘（改动前的内容本来就在 git 里） */
export function writeConfig(rel: string, exportName: string, newValues: unknown): WriteResult {
	const { sf, abs } = loadSource(rel)
	const { init } = findExportedConst(sf, exportName)
	const labels: Record<string, string> = {}
	const old = toValue(sf, init, '', labels, { localVars: undefined })
	const patches: Patch[] = []
	diffValues(old, newValues, '', patches)
	if (!patches.length) return { ok: true, patches: 0 }

	for (const p of patches) {
		const segs = p.pointer ? p.pointer.split('.') : []
		const { node, asConst } = navigate(sf, init, segs)
		let text = literalText(p.value, segs.length + 1)
		if (asConst) text += ' as const'
		node.replaceWithText(text)
	}

	for (const p of patches) {
		const segs = p.pointer ? p.pointer.split('.') : []
		const { node } = navigate(sf, init, segs)
		const check = toValue(sf, node, p.pointer, {}, { localVars: undefined })
		if (!eq(check, p.value)) {
			throw new Error(`写入校验失败（${p.pointer}），本次修改未保存，配置文件未变动。`)
		}
	}

	fs.writeFileSync(abs, sf.getFullText(), 'utf8')
	return { ok: true, patches: patches.length }
}

export function readHtml(rel: string): string {
	return fs.readFileSync(configPath(rel), 'utf8')
}

/** 扫描 src/config/ 目录，动态发现全部配置文件及其导出（项目更新后自动跟随） */
export function discoverConfigs(): DiscoveredConfig[] {
	const dir = path.join(projectRoot, 'src/config')
	if (!fs.existsSync(dir)) return []
	const out: DiscoveredConfig[] = []
	for (const f of fs.readdirSync(dir).sort()) {
		if (f.startsWith('.') || f === 'index.ts') continue
		if (f.toLowerCase().endsWith('.html')) {
			out.push({ rel: `src/config/${f}`, kind: 'html', exports: [] })
			continue
		}
		if (!f.endsWith('.ts')) continue
		const rel = `src/config/${f}`
		try {
			const { sf } = loadSource(rel)
			const exports = sf
				.getVariableStatements()
				.filter((st) => st.isExported())
				.map((st) => st.getDeclarations()[0]?.getNameNode().getText() ?? '')
				.filter(Boolean)
			out.push({ rel, kind: 'ts', exports })
		} catch {
			out.push({ rel, kind: 'ts', exports: [] })
		}
	}
	return out
}

export function writeHtml(rel: string, content: string): void {
	fs.writeFileSync(configPath(rel), content, 'utf8')
}
