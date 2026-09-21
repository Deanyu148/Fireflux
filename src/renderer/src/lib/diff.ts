import { escapeHtml } from './preview'

/**
 * git diff 文本着色：新增绿色、删除红色、文件头/hunk 标头用主题色。
 * 输出为 HTML（已转义），配合等宽字体展示。
 */
export function diffToHtml(diff: string): string {
	return diff
		.split('\n')
		.map((line) => {
			const esc = escapeHtml(line)
			if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
				return `<span class="d-file">${esc}</span>`
			}
			if (line.startsWith('@@')) return `<span class="d-hunk">${esc}</span>`
			if (line.startsWith('+')) return `<span class="d-add">${esc}</span>`
			if (line.startsWith('-')) return `<span class="d-del">${esc}</span>`
			return `<span>${esc}</span>`
		})
		.join('\n')
}

/** 操作日志着色：命令行高亮、错误红色、成功信息绿色 */
export function logToHtml(log: string): string {
	return log
		.split('\n')
		.map((line) => {
			const esc = escapeHtml(line)
			if (line.startsWith('$ ')) return `<span class="l-cmd">${esc}</span>`
			if (/^\[失败\]|^error\b|^fatal\b|\bERROR\b/i.test(line)) return `<span class="l-err">${esc}</span>`
			if (/done\.?$|up-to-date|已是最新|（完成）|^On branch/i.test(line)) return `<span class="l-ok">${esc}</span>`
			return `<span>${esc}</span>`
		})
		.join('\n')
}
