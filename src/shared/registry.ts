/** 配置中心页要展示的配置文件清单（路径均为相对 Firefly 项目根目录）。
 *
 *  主进程不读这张表：它用 configEngine.discoverConfigs() 直接在项目里发现配置文件，
 *  所以这里少一条只是少一份标题/说明（会兜底显示文件名），顺序也不影响界面排序
 *  （界面按发现顺序 + group 排列）。kind / exports 同样只是给人看的备注。
 *
 *  id 必须与 lib/schemas/configs.ts 的 SCHEMAS 键一致，否则该配置会退回「按值类型推断」。
 *  group 必须是 ConfigCenter 的 GROUP_ORDER 之一，否则会落到「其他」。
 */
interface ConfigEntry {
	id: string
	rel: string
	/** 备注：文件类型 */
	kind: 'ts' | 'html'
	/** 备注：该文件里由界面接管的导出名 */
	exports: string[]
	title: string
	desc: string
	group: '基础' | '外观' | '功能' | '内容'
}

export const CONFIG_REGISTRY: ConfigEntry[] = [
	{ id: 'site', rel: 'src/config/siteConfig.ts', kind: 'ts', exports: ['siteConfig'], title: '站点信息', desc: '站点标题、副标题、主题色、页面开关、文章列表、外部服务等全局配置', group: '基础' },
	{ id: 'profile', rel: 'src/config/profileConfig.ts', kind: 'ts', exports: ['profileConfig'], title: '个人资料', desc: '头像、昵称、个性签名、社交链接', group: '基础' },
	{ id: 'nav', rel: 'src/config/navBarConfig.ts', kind: 'ts', exports: ['navBarConfig', 'navBarSearchConfig', 'LinkPresets'], title: '导航栏', desc: '顶部导航链接、搜索配置、预设链接库', group: '基础' },
	{ id: 'footer', rel: 'src/config/footerConfig.ts', kind: 'ts', exports: ['footerConfig'], title: '页脚开关', desc: '是否启用 FooterConfig.html 注入', group: '基础' },
	{ id: 'footer-html', rel: 'src/config/FooterConfig.html', kind: 'html', exports: [], title: '页脚 HTML', desc: '页脚自定义 HTML 内容（备案号等）', group: '基础' },
	{ id: 'wallpaper', rel: 'src/config/backgroundWallpaper.ts', kind: 'ts', exports: ['backgroundWallpaper'], title: '壁纸与背景视频', desc: '壁纸模式、桌面/手机壁纸图片、背景视频、横幅文字、波浪特效', group: '外观' },
	{ id: 'sidebar', rel: 'src/config/sidebarConfig.ts', kind: 'ts', exports: ['sidebarLayoutConfig'], title: '边栏布局', desc: '左右边栏位置与全部组件的顺序、开关、专属配置', group: '外观' },
	{ id: 'display', rel: 'src/config/displaySettingsConfig.ts', kind: 'ts', exports: ['displaySettingsConfig'], title: '显示设置', desc: '主题色切换、布局切换等访客可调项的开放开关', group: '外观' },
	{ id: 'cover', rel: 'src/config/coverImageConfig.ts', kind: 'ts', exports: ['coverImageConfig'], title: '文章封面图', desc: '封面显示、随机封面 API', group: '外观' },
	{ id: 'effects', rel: 'src/config/effectsConfig.ts', kind: 'ts', exports: ['sakuraConfig'], title: '樱花特效', desc: '樱花数量、尺寸、透明度、速度等全部参数', group: '外观' },
	{ id: 'font', rel: 'src/config/fontConfig.ts', kind: 'ts', exports: ['fontsList', 'fontConfig'], title: '字体', desc: '字体列表与各区域字体选择、子集化配置', group: '外观' },
	{ id: 'gallery', rel: 'src/config/galleryConfig.ts', kind: 'ts', exports: ['galleryConfig'], title: '相册', desc: '相册列表（对应 public/gallery 文件夹）与瀑布流列宽', group: '外观' },
	{ id: 'pio', rel: 'src/config/pioConfig.ts', kind: 'ts', exports: ['spineModelConfig', 'live2dWidgetConfig'], title: '看板娘', desc: 'Spine 模型与 Live2D 看板娘的全部配置', group: '外观' },
	{ id: 'expressive', rel: 'src/config/expressiveCodeConfig.ts', kind: 'ts', exports: ['expressiveCodeConfig'], title: '代码高亮', desc: '代码块主题、折叠、语言徽标等', group: '功能' },
	{ id: 'mermaid', rel: 'src/config/mermaidConfig.ts', kind: 'ts', exports: ['mermaidConfig'], title: 'Mermaid 图表', desc: '图表亮色/暗色主题', group: '功能' },
	{ id: 'plantuml', rel: 'src/config/plantumlConfig.ts', kind: 'ts', exports: ['plantumlConfig'], title: 'PlantUML', desc: 'PlantUML 服务地址与主题', group: '功能' },
	{ id: 'license', rel: 'src/config/licenseConfig.ts', kind: 'ts', exports: ['licenseConfig'], title: '文章版权', desc: '版权协议名称、链接、图标', group: '功能' },
	{ id: 'comment', rel: 'src/config/commentConfig.ts', kind: 'ts', exports: ['commentConfig'], title: '评论系统', desc: '评论类型（Waline/Twikoo/Giscus 等）与对应服务配置', group: '功能' },
	{ id: 'analytics', rel: 'src/config/analyticsConfig.ts', kind: 'ts', exports: ['analyticsConfig'], title: '访问统计', desc: 'Umami / Google / Clarity / 51la 统计配置', group: '功能' },
	{ id: 'music', rel: 'src/config/musicConfig.ts', kind: 'ts', exports: ['musicPlayerConfig'], title: '背景音乐', desc: 'Meting API 云端歌单 / 本地歌单双模式', group: '功能' },
	{ id: 'dynamic', rel: 'src/config/dynamicConfig.ts', kind: 'ts', exports: ['dynamicConfig'], title: '动态页面', desc: '动态页标题、数据源（本地 JSON / Memos 远端）', group: '功能' },
	{ id: 'announcement', rel: 'src/config/announcementConfig.ts', kind: 'ts', exports: ['announcementConfig'], title: '公告栏', desc: '公告标题、内容、关闭按钮、跳转链接', group: '功能' },
	{ id: 'booknav', rel: 'src/config/booknavConfig.ts', kind: 'ts', exports: ['booknavPageConfig', 'booknavConfig'], title: '书签导航', desc: '书签页配置与分组、书签条目', group: '功能' },
	{ id: 'sponsor', rel: 'src/config/sponsorConfig.ts', kind: 'ts', exports: ['sponsorConfig'], title: '打赏', desc: '打赏方式（收款码）、赞助名单', group: '功能' },
	{ id: 'friends', rel: 'src/config/friendsConfig.ts', kind: 'ts', exports: ['friendsPageConfig', 'friendsConfig'], title: '友链', desc: '友链页配置与友链列表', group: '内容' }
]
