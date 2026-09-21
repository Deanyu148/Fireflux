/**
 * 背景烘焙：把「body 渐变 + 壁纸图片（含暗度）」合成成一张「设备像素 1:1」的位图。
 *
 * 为什么必须这么做（实测，见 scripts/bench-drag.mjs）：
 * 软件渲染下每呈现一帧，Chromium 都要重画受损区域。原先背景是「整窗线性渐变 +
 * 一张 4K 壁纸按 cover 缩放 + opacity 混合」三层叠加，每次重画约 0.05~0.10 CPU 秒；
 * 任何动效（拖拽、悬停、看板娘）都会把这些开销放大成「一核起步」。
 * 烘焙成一张不透明、与设备像素 1:1 的位图后：
 *   渐变只画一次、图片只缩放一次、也不再有 opacity 混合；
 *   每帧只剩一次 1:1 blit（实测每帧成本降到约 1/3）。
 *
 * 视觉保持一致：先画渐变，再以 (1 - 暗度) 的透明度画壁纸（cover 居中）——
 * 与 CSS 里「渐变打底 + 半透明壁纸」的合成结果在数值上等价。
 */

interface BakeOptions {
	image: string
	/** 壁纸暗度（CSS 里用 opacity: 1 - dim） */
	dim: number
	width: number
	height: number
	dpr: number
}

/** CSS linear-gradient 角度 → 画布上的起止点（与浏览器算法一致） */
function gradientLine(angle: number, w: number, h: number): [number, number, number, number] {
	const rad = ((angle - 90) * Math.PI) / 180
	const dx = Math.cos(rad)
	const dy = Math.sin(rad)
	const len = Math.abs(w * dx) + Math.abs(h * dy)
	const cx = w / 2
	const cy = h / 2
	return [cx - (dx * len) / 2, cy - (dy * len) / 2, cx + (dx * len) / 2, cy + (dy * len) / 2]
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image()
		img.onload = () => resolve(img)
		img.onerror = () => reject(new Error('壁纸图片加载失败'))
		img.src = src
	})
}

/** 与 app.css 的 body 背景渐变保持一致（改了那边记得同步这里） */
const GRADIENT = { angle: 155, stops: ['#eafaf6', '#f4fbf8', '#fdf8ef'] as const }

/**
 * 烘焙背景位图：把「背景渐变 + 壁纸（含暗度）」合成为一张不透明位图。
 * 成功返回 blob: URL，失败返回 null（调用方退回原来的 CSS 背景，功能不受影响）
 */
export async function bakeBackground(opts: BakeOptions): Promise<string | null> {
	try {
		const { image, dim, width, height, dpr } = opts
		const g = GRADIENT
		const W = Math.max(2, Math.round(width * dpr))
		const H = Math.max(2, Math.round(height * dpr))
		const canvas = document.createElement('canvas')
		canvas.width = W
		canvas.height = H
		const ctx = canvas.getContext('2d')
		if (!ctx) return null

		const [x0, y0, x1, y1] = gradientLine(g.angle, W, H)
		const grad = ctx.createLinearGradient(x0, y0, x1, y1)
		grad.addColorStop(0, g.stops[0])
		grad.addColorStop(0.45, g.stops[1])
		grad.addColorStop(1, g.stops[2])
		ctx.fillStyle = grad
		ctx.fillRect(0, 0, W, H)

		const img = await loadImage(image)
		const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight)
		const dw = img.naturalWidth * scale
		const dh = img.naturalHeight * scale
		ctx.globalAlpha = Math.min(1, Math.max(0, 1 - dim))
		ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh)

		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92))
		if (!blob) return null
		return URL.createObjectURL(blob)
	} catch {
		return null
	}
}
