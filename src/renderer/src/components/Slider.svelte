<script lang="ts">
	import { untrack } from 'svelte'

	/**
	 * 设置项里的「滑条 + 数字框」控件：滑条拖到哪，右边数字框就跟着显示到哪；
	 * 也可以直接在数字框里填数字（回车或点到别处生效），超出范围会被夹到 min~max。
	 *
	 * value 是内部值（0.45 这种小数），显示时按 unit 换算：
	 * unit='%' → 显示 45，回调也是 0.45；unit='px' 或不传 → 原样显示。
	 *
	 * 滑条轨道是自己画的（不用浏览器原生的填充）：原生那套在取到最大值时
	 * 填充条会差一小截不到头，看起来像没拉满。这里用 --p 直接按比例铺满。
	 */
	interface Props {
		label: string
		min: number
		max: number
		step?: number
		value: number
		/** 显示与回填的单位：'%' 会换成百分数（0.45 ↔ 45） */
		unit?: '%' | 'px' | ''
		hint?: string
		oninput: (v: number) => void
	}
	let { label, min, max, step = 0.01, value, unit = '', hint, oninput }: Props = $props()

	const scale = $derived(unit === '%' ? 100 : 1)
	const toDisplay = (v: number): number => Math.round(v * scale * 1000) / 1000
	const percent = $derived(max > min ? Math.round(((value - min) / (max - min)) * 1000) / 10 : 0)

	/**
	 * 数字框里的文本：跟着 value 走，但允许用户中途输入非法内容。
	 * 初值只取一次，之后由下面的 $effect 同步（设置是异步加载的，value 稍后才会变成真实值）；
	 * untrack 明确告诉编译器「这里读 value 是有意的」，否则会报 state_referenced_locally
	 */
	let text = $state(untrack(() => String(toDisplay(value))))
	$effect(() => {
		text = String(toDisplay(value))
	})

	function commit(): void {
		const raw = Number(text)
		if (!Number.isFinite(raw)) {
			text = String(toDisplay(value)) // 填了非法内容就还原
			return
		}
		const clamped = Math.min(max, Math.max(min, raw / scale))
		text = String(toDisplay(clamped))
		oninput(clamped)
	}
</script>

<div class="field">
	<span class="flabel">{label}</span>
	<div class="slider-row">
		<input
			class="rng"
			type="range"
			{min}
			{max}
			{step}
			{value}
			style="--p: {percent}%"
			oninput={(e) => oninput(Number((e.target as HTMLInputElement).value))}
		/>
		<input
			class="num"
			type="number"
			min={min * scale}
			max={max * scale}
			step={step * scale}
			bind:value={text}
			onchange={commit}
			onkeydown={(e) => {
				if (e.key === 'Enter') commit()
			}}
		/>
		{#if unit}<span class="unit">{unit === '%' ? '%' : 'px'}</span>{/if}
	</div>
	{#if hint}<p class="hint">{hint}</p>{/if}
</div>

<style>
	.slider-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	/* 自己画轨道：填充按 --p 精确铺满（含最大值时），拇指压在比例位置上 */
	.rng {
		flex: 1;
		min-width: 0;
		width: auto;
		appearance: none;
		-webkit-appearance: none;
		border: none;
		background: transparent;
		padding: 0;
		height: 18px;
		cursor: pointer;
	}
	.rng::-webkit-slider-runnable-track {
		height: 6px;
		border-radius: 3px;
		background: linear-gradient(
			to right,
			var(--accent) 0,
			var(--accent) var(--p, 0%),
			#dfe9e6 var(--p, 0%),
			#dfe9e6 100%
		);
	}
	.rng::-webkit-slider-thumb {
		appearance: none;
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		margin-top: -4px;
		border-radius: 50%;
		background: var(--accent);
		border: 2px solid #fff;
		box-shadow: 0 1px 3px rgba(20, 84, 74, 0.35);
	}
	.rng:focus {
		box-shadow: none;
	}
	.num {
		flex: none;
		width: 78px;
		text-align: center;
		padding: 6px 8px;
	}
	.unit {
		flex: none;
		font-size: 12.5px;
		color: var(--muted);
	}
</style>
