import { app, BrowserWindow } from 'electron'
import type { GpuStatus } from '../../shared/types'
import { classifyGpuStatus } from '../../shared/rendering'
import { getSettings } from './settings'

let pending: Promise<GpuStatus> | undefined
let lastStatus = ''

/** 读取运行时能力；GPU 初始化失败时保守使用节能策略，不把设置开关当作检测结果。 */
export function getGpuStatus(): Promise<GpuStatus> {
	if (pending) return pending
	pending = (async () => {
		let renderer = ''
		try {
			const info = await app.getGPUInfo('complete') as { auxAttributes?: { glRenderer?: string } }
			renderer = info.auxAttributes?.glRenderer ?? ''
		} catch {
			// 保留功能状态，未知渲染器不冒充硬件加速。
		}
		return classifyGpuStatus(
			getSettings().hardwareGpu === true,
			app.getGPUFeatureStatus(),
			renderer,
			app.commandLine.getSwitchValue('use-angle') === 'swiftshader'
		)
	})().finally(() => { pending = undefined })
	return pending
}

export function installGpuStatusUpdates(): void {
	app.on('gpu-info-update', () => {
		void getGpuStatus().then((status) => {
			const key = JSON.stringify(status)
			if (key === lastStatus) return
			lastStatus = key
			for (const win of BrowserWindow.getAllWindows()) {
				if (!win.webContents.isDestroyed()) win.webContents.send('gpu:changed', status)
			}
		}).catch(() => {})
	})
}
