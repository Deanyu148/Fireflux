import { deflateRawSync } from 'node:zlib'

/** PlantUML 服务端专用编码：raw deflate + 自定义 base64 字母表 */
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'

function encode6bit(b: number): string {
	return CHARS[b & 0x3f]
}

function append3bytes(b1: number, b2: number, b3: number): string {
	const c1 = b1 >> 2
	const c2 = ((b1 & 0x3) << 4) | (b2 >> 4)
	const c3 = ((b2 & 0xf) << 2) | (b3 >> 6)
	const c4 = b3 & 0x3f
	return encode6bit(c1 & 0x3f) + encode6bit(c2 & 0x3f) + encode6bit(c3 & 0x3f) + encode6bit(c4 & 0x3f)
}

function encode64(data: Uint8Array): string {
	let r = ''
	for (let i = 0; i < data.length; i += 3) {
		if (i + 2 === data.length) {
			r += append3bytes(data[i]!, data[i + 1]!, 0)
		} else if (i + 1 === data.length) {
			r += append3bytes(data[i]!, 0, 0)
		} else {
			r += append3bytes(data[i]!, data[i + 1]!, data[i + 2]!)
		}
	}
	return r
}

/** 生成 PlantUML 服务器图片地址 */
export function plantumlImageUrl(text: string, server: string): string {
	const deflated = deflateRawSync(Buffer.from(text, 'utf8'))
	return `${server.replace(/\/+$/, '')}/svg/${encode64(deflated)}`
}
