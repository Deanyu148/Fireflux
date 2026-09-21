import type { GpuStatus, RenderBackend } from './types'

/** Chromium 的 enabled 状态仍可能对应 SwiftShader，必须同时检查 renderer。 */
export function classifyGpuStatus(
	requestedHardware: boolean,
	features: { webgl?: string; gpu_compositing?: string },
	renderer: string,
	forcedSoftware = false
): GpuStatus {
	const software = /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(renderer)
	function backend(feature?: string): RenderBackend {
		if (!feature) return 'unknown'
		if (feature.includes('software')) return 'software'
		if (feature.startsWith('enabled')) return software ? 'software' : renderer ? 'hardware' : 'unknown'
		if (feature.startsWith('disabled') || feature === 'unavailable_off') return 'unavailable'
		return 'unknown'
	}
	let webgl = backend(features.webgl)
	if (forcedSoftware && webgl !== 'unavailable') webgl = 'software'
	return { requestedHardware, webgl, compositing: backend(features.gpu_compositing), renderer }
}
