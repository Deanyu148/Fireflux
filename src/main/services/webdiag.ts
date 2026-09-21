import { app, dialog, session, shell } from 'electron'
import type { NetworkFailure } from '../../shared/types'

/**
 * 网页（动态页内嵌 Memos 等）的失败可见化。
 *
 * 背景：`<webview>` 里的资源加载失败，Chromium 只会把 `net::ERR_*` 写到 stderr
 * （例如 `ssl_client_socket_impl.cc ... net_error -100`），既没有 URL 也不进界面，
 * 用户看到的只是一片白或一张裂图。这里统一收集「请求失败 / 证书错误」两类事件：
 * 控制台打出带 URL 的行，最近若干条留给「动态发布」页的「连接诊断」面板。
 */

const MAX_KEEP = 20

/** 最近失败时间线（新的在前）；同一 URL + 同一错误会合并计数，免得轮询刷屏 */
const failures: NetworkFailure[] = []

function record(kind: NetworkFailure['kind'], url: string, error: string): void {
	const newest = failures[0]
	if (newest && newest.kind === kind && newest.url === url && newest.error === error) {
		newest.count += 1
		newest.at = nowText()
		return
	}
	failures.unshift({ at: nowText(), url, error, kind, count: 1 })
	if (failures.length > MAX_KEEP) failures.length = MAX_KEEP
	const label = kind === 'certificate' ? '证书错误' : '请求失败'
	console.log(`[Fireflux] ${label} ${url} ${error}`)
}

function nowText(): string {
	return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

/** 供界面读取的失败清单（副本，按时间倒序） */
export function networkFailures(): NetworkFailure[] {
	return failures.map((f) => ({ ...f }))
}

/** 已经问过「是否继续访问」的主机：同一个站点的多张图片只问一次 */
const askedHosts = new Set<string>()

function hostOf(url: string): string {
	try {
		return new URL(url).host
	} catch {
		return url
	}
}

export function installNetworkDiagnostics(): void {
	// 1) 请求层面的失败：TLS 握手被中断、连接被重置、域名解析失败等都在这里露头
	session.defaultSession.webRequest.onErrorOccurred((details) => {
		// ERR_ABORTED 是正常中断（页面跳转、用户取消、被替换的请求），不算故障
		if (!details.error || details.error === 'net::ERR_ABORTED') return
		record('request', details.url, details.error)
	})

	// 2) 证书错误：Electron 默认静默拒绝（图片直接裂、页面直接白），这里记一条并让用户决定
	app.on('certificate-error', (event, _contents, url, error, certificate, callback) => {
		// 签发者写进记录：自签证书一眼能认出来（比如 issuer 与域名同名）
		const issuer = certificate?.issuerName ? `（签发者 ${certificate.issuerName}）` : ''
		record('certificate', url, `${error}${issuer}`)
		const host = hostOf(url)
		if (askedHosts.has(host)) {
			callback(false) // 同一个站点只问一次，其余一律拒绝
			return
		}
		askedHosts.add(host)
		const choice = dialog.showMessageBoxSync({
			type: 'warning',
			title: '证书不受信任',
			message: `无法验证 ${host} 的证书`,
			detail: `${error}\n\n继续访问有被中间人攻击的风险。只有在你确认这是自己的服务器、且这个地址本该可用时才选「继续访问」。`,
			buttons: ['取消', '继续访问'],
			defaultId: 0,
			cancelId: 0
		})
		if (choice === 1) {
			event.preventDefault()
			callback(true)
		} else {
			callback(false)
		}
	})
}

/** webview（Memos）里的 `window.open` / 外链：交给系统浏览器，不要弹出裸 Electron 窗口 */
export function installWebviewGuards(): void {
	app.on('web-contents-created', (_event, contents) => {
		if (contents.getType() !== 'webview') return
		contents.setWindowOpenHandler(({ url }) => {
			if (/^https?:\/\//.test(url)) void shell.openExternal(url)
			return { action: 'deny' }
		})
	})
}
