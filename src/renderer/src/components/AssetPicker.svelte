<script lang="ts">
	import { getContext } from 'svelte'
	import { errMsg } from '../lib/err'

	let {
		target,
		onimported,
		label = '导入本地文件'
	}: {
		target: string
		onimported: (refs: string[]) => void
		label?: string
	} = $props()

	let busy = $state(false)
	const notify = getContext<(m: string, ok?: boolean) => void>('notify')

	async function pick(): Promise<void> {
		busy = true
		try {
			const refs = await window.api.assetImport(target)
			// 用户取消选择时 refs 为空，不回调（调用方因此不必再判空）
			if (refs.length) onimported(refs)
		} catch (e) {
			notify(errMsg(e), false)
		} finally {
			busy = false
		}
	}
</script>

<button class="btn small" onclick={pick} disabled={busy}>{busy ? '导入中…' : `📂 ${label}`}</button>
