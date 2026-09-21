/** 清洗 IPC 错误信息（Electron 会在错误前加一串前缀） */
export function errMsg(e: unknown): string {
	const raw = e instanceof Error ? e.message : String(e)
	return raw
		.replace(/^Error invoking remote method '[^']+':\s*/i, '')
		.replace(/^(Error|TypeError|RangeError|DataCloneError):\s*/i, '')
		.trim()
}

/**
 * 关键工具：把对象转成纯 JSON。
 * contextBridge 在预加载脚本之前就会克隆 IPC 参数，Svelte 的响应式代理（$state/$derived）
 * 会在桥上被拦下报 "An object could not be cloned"，所以必须在调用方先转纯。
 */
export function plain<T>(v: T): T {
	if (v === null || typeof v !== 'object') return v
	return JSON.parse(JSON.stringify(v)) as T
}

/** 判断值是否是「特殊节点」（代码生成/引用，不支持图形化编辑） */
export function isAdv(v: unknown): v is { __adv: string } {
	return typeof v === 'object' && v !== null && '__adv' in (v as Record<string, unknown>)
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v) && !isAdv(v)
}
