/**
 * ANSI 终端转义序列 → 彩色 HTML（自研解析，覆盖 SGR 全部常用码）：
 * 16 基本色、90-97/100-107 亮色、38;5;N（256 色）、38;2;R;G;B（24 位 RGB）、
 * 粗体/暗淡/斜体/下划线/反转。
 */
import { escapeHtml } from './preview'

/** 浅色终端配色（匹配 Firefly 主题的亮色风格） */
const BASIC_FG = ['#3B3B3B', '#CD3131', '#00BC00', '#949800', '#0451A5', '#BC05BC', '#0598BC', '#555555']
const BRIGHT_FG = ['#666666', '#CD3131', '#05BC79', '#B5BA00', '#0451A5', '#BC05BC', '#0598BC', '#A5A5A5']
const BASIC_BG = ['#C9C9C9', '#F2B8BE', '#A9E5C5', '#EAE0A0', '#AFCEF2', '#E0B7E0', '#A8DDE8', '#E8E8E8']
const BRIGHT_BG = ['#9E9E9E', '#E58F98', '#8FD8AE', '#DFD07E', '#8FB8EA', '#D19BD1', '#8CCFE0', '#F0F0F0']

function xterm256(n: number): string {
	if (n < 16) return n < 8 ? BASIC_FG[n] : BRIGHT_FG[n - 8]
	if (n < 232) {
		const v = (x: number): number => (x === 0 ? 0 : 55 + x * 40)
		const r = v(Math.floor(n / 36))
		const g = v(Math.floor(n / 6) % 6)
		const b = v(n % 6)
		return `rgb(${r},${g},${b})`
	}
	const gray = 8 + (n - 232) * 10
	return `rgb(${gray},${gray},${gray})`
}

interface SgrState {
	fg: string | null
	bg: string | null
	bold: boolean
	dim: boolean
	italic: boolean
	underline: boolean
	reversed: boolean
}

function applySgr(codes: number[], st: SgrState): void {
	let i = 0
	while (i < codes.length) {
		const c = codes[i] ?? 0
		if (c === 0) {
			st.fg = null
			st.bg = null
			st.bold = st.dim = st.italic = st.underline = st.reversed = false
		} else if (c === 1) st.bold = true
		else if (c === 2) st.dim = true
		else if (c === 3) st.italic = true
		else if (c === 4) st.underline = true
		else if (c === 7) st.reversed = true
		else if (c === 22) st.bold = st.dim = false
		else if (c === 23) st.italic = false
		else if (c === 24) st.underline = false
		else if (c === 27) st.reversed = false
		else if (c === 39) st.fg = null
		else if (c === 49) st.bg = null
		else if (c === 38 || c === 48) {
			const isBg = c === 48
			if (codes[i + 1] === 5) {
				const col = xterm256(codes[i + 2] ?? 0)
				if (isBg) st.bg = col
				else st.fg = col
				i += 2
			} else if (codes[i + 1] === 2) {
				const col = `rgb(${codes[i + 2] ?? 0},${codes[i + 3] ?? 0},${codes[i + 4] ?? 0})`
				if (isBg) st.bg = col
				else st.fg = col
				i += 4
			}
		} else if (c >= 30 && c <= 37) st.fg = BASIC_FG[c - 30]
		else if (c >= 90 && c <= 97) st.fg = BRIGHT_FG[c - 90]
		else if (c >= 40 && c <= 47) st.bg = BASIC_BG[c - 40]
		else if (c >= 100 && c <= 107) st.bg = BRIGHT_BG[c - 100]
		i++
	}
}

/** ANSI 文本 → 带内联样式的 HTML */
export function ansiToHtml(text: string): string {
	let out = ''
	const st: SgrState = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, reversed: false }
	const parts = text.split(/(\x1b\[[0-9;]*[A-Za-z])/)
	for (const part of parts) {
		if (!part) continue
		const m = /^\x1b\[([0-9;]*)m$/.exec(part)
		if (m) {
			applySgr((m[1] || '0').split(';').map((x) => Number(x) || 0), st)
			continue
		}
		// 非 SGR 转义序列（光标移动等）直接丢弃
		if (part.startsWith('\x1b')) continue
		let f = st.fg
		let b = st.bg
		if (st.reversed) {
			const t = f
			f = b
			b = t
		}
		const css: string[] = []
		if (f) css.push(`color:${f}`)
		if (b) css.push(`background-color:${b}`)
		if (st.bold) css.push('font-weight:700')
		if (st.dim) css.push('opacity:0.6')
		if (st.italic) css.push('font-style:italic')
		if (st.underline) css.push('text-decoration:underline')
		const style = css.length ? ` style="${css.join(';')}"` : ''
		out += `<span${style}>${escapeHtml(part)}</span>`
	}
	return out
}
