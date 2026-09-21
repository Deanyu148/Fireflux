import type { FieldDef } from '../schema-types'

/**
 * 表单 schema（与 shared/registry.ts 的注册表一一对应）：
 * 键 = 注册表里的 id（配置文件名去后缀），二级键 = 该文件里的导出名，
 * 由 ConfigCenter 按 `SCHEMAS[registry.id][导出名]` 查找，写错键名会静默退回「按值类型推断」。
 *
 * 这里只声明「需要特别呈现」的字段：中文标签、控件类型（下拉/列表/分组…）与提示语。
 * 未列出的字段由 FormKit 按值类型自动追加，保证配置里每个参数都有界面；
 * 布尔值自动变开关；解析不出来的值（函数、跨文件引用）显示为只读代码块。
 */

const t = (k: string, label?: string, hint?: string): FieldDef => ({ k, label, hint })
const ta = (k: string, label?: string, hint?: string): FieldDef => ({ k, label, w: 'textarea', hint })
const n = (k: string, label?: string, hint?: string): FieldDef => ({ k, label, w: 'number', hint })
const b = (k: string, label?: string, hint?: string): FieldDef => ({ k, label, w: 'bool', hint })
const sel = (k: string, options: string[], label?: string, hint?: string): FieldDef => ({ k, label, w: 'select', options, hint })
const g = (k: string, fields: FieldDef[], label?: string, hint?: string): FieldDef => ({ k, fields, label, w: 'group', hint })
const lst = (k: string, item: FieldDef[], label?: string, titleKey?: string): FieldDef => ({ k, item, label, w: 'list', titleKey })
const sl = (k: string, label?: string, hint?: string): FieldDef => ({ k, label, w: 'stringList', hint })
const dual = (k: string, kind: 'strList' | 'boolObj', extra?: { dualFields?: FieldDef[]; asset?: string }, label?: string, hint?: string): FieldDef => ({
	k,
	label,
	w: 'dual',
	dual: kind,
	dualFields: extra?.dualFields,
	asset: extra?.asset,
	hint
})
const asset = (k: string, target: string, label?: string, hint?: string): FieldDef => ({ k, label, w: 'text', asset: target, hint })

/** 边栏组件的可选类型（桌面 / 手机端共用同一份枚举；必须在 SCHEMAS 之前定义） */
const SIDEBAR_TYPES = ['profile', 'announcement', 'categories', 'tags', 'sidebarToc', 'advertisement', 'stats', 'calendar', 'music', 'siteInfo', 'dynamic']

interface ExportSchema {
	/** 根是数组时的每项字段 */
	rootItem?: FieldDef[]
	/** 根的 titleKey */
	rootTitleKey?: string
	/** 根是对象时的字段清单 */
	fields?: FieldDef[]
}

export const SCHEMAS: Record<string, Record<string, ExportSchema>> = {
	// ============ 基础 ============
	site: {
		siteConfig: {
			fields: [
				t('lang', '站点语言', '如 zh_CN，通过 resolveSiteLang 写入'),
				g('pages', [
					b('friends'), b('guestbook'), b('dynamic'), b('projects'), b('gallery'), b('booknav'),
					b('bilibili'), b('bangumi'), b('vndb'), b('mal'), b('sponsor')
				], '页面开关'),
				t('title'), ta('description'), t('subtitle'), sl('keywords'), n('pageWidth'),
				t('siteStartDate', undefined, '建站日期 YYYY-MM-DD'), t('timezone', undefined, 'IANA 时区，如 Asia/Shanghai'),
				b('categoryBar'), b('foldArticle'),
				g('themeColor', [n('hue', undefined, '0-360'), sel('defaultMode', ['light', 'dark', 'system'])]),
				g('card', [b('border'), b('followTheme')]),
				lst('favicon', [asset('src', 'favicon'), sel('theme', ['light', 'dark']), t('sizes')], '站点图标', 'src'),
				g('navbar', [
					g('logo', [
						sel('type', ['icon', 'image', 'url']),
						asset('value', 'logo'),
						asset('valueDark', 'logo', '暗色模式图片'),
						t('alt')
					]),
					t('title'), b('widthFull'), sel('menuAlign', ['left', 'center']), b('followTheme'),
					sel('navbarMode', ['static', 'fixed', 'dynamic'])
				]),
				sel('categoryStyle', ['pill', 'rectangle']),
				sel('tagStyle', ['pill', 'pill-gray', 'rectangle']),
				g('postListLayout', [
					sel('defaultMode', ['list', 'grid']), sel('mobileDefaultMode', ['list', 'grid']),
					sel('coverPosition', ['left', 'right']), n('descriptionLines'), b('showStatsIcons'),
					sel('tagsPosition', ['meta', 'bottom']), sel('tagsBottomStyle', ['chip', 'text']),
					g('meta', [b('showPublished'), b('showCategory'), b('showTags'), n('tagCount'), b('showWords'), b('showReadingTime')]),
					g('stats', [b('showPublished'), b('showWords'), b('showReadingTime')]),
					g('grid', [b('masonry'), n('columnWidth'), b('coverFullWidth')])
				]),
				g('pagination', [n('postsPerPage')]),
				g('post', [
					g('rehypeCallouts', [sel('theme', ['github', 'obsidian', 'vitepress', 'docusaurus']), b('enablePythonMarkdownAdmonitions')]),
					b('showLastModified'), n('outdatedThreshold', undefined, '天数，超过则提示文章可能过时'),
					b('share'), b('postNavigation'), b('relatedPosts'), b('randomPosts'), b('generateOgImages'),
					g('immersiveReading', [b('enable'), b('defaultOn'), b('tocEnabled'), sel('tocPosition', ['left', 'right'])])
				]),
				g('bilibili', [t('uid')]),
				g('bangumi', [t('userId'), sel('mode', ['static', 'dynamic']), t('apiUrl'), t('subjectBaseUrl'), sl('categoryOrder'), sel('nsfw', ['off', 'blur', 'hide'])]),
				g('vndb', [t('userId'), sel('mode', ['static', 'dynamic']), b('downloadCovers'), t('apiUrl'), t('vnBaseUrl'), t('apiToken', 'API Token', '敏感信息，注意保管'), sel('nsfw', ['off', 'blur', 'hide'])]),
				g('mal', [t('username'), t('clientId'), t('apiUrl'), t('animeBaseUrl'), t('mangaBaseUrl'), sel('nsfw', ['off', 'blur', 'hide'])]),
				g('imageOptimization', [sel('formats', ['avif', 'webp', 'both']), n('quality', undefined, '1-100'), sl('noReferrerDomains')]),
				g('feed', [sel('contentMode', ['full', 'summary'])])
			]
		}
	},
	profile: {
		profileConfig: {
			fields: [
				asset('avatar', 'avatar', '头像', '支持本地图片或外链'),
				t('name'), ta('bio'),
				lst('links', [t('name'), t('icon', '图标', 'Iconify 图标名'), t('url'), b('showName')], '社交链接', 'name')
			]
		}
	},
	nav: {
		navBarConfig: {
			fields: [
				lst(
					'links',
					[
						t('name'), t('url'), b('external'), t('icon', '图标', 'Iconify 图标名'), t('pageKey'),
						{ k: 'children', w: 'list', label: '子链接', titleKey: 'name', hint: '预设引用（LinkPresets.X）显示为只读，可编辑下方预设库' }
					],
					'导航链接',
					'name'
				)
			]
		},
		navBarSearchConfig: { fields: [t('method', '搜索方式', '数值枚举，暂不支持图形化修改')] },
		LinkPresets: { rootItem: [t('name'), t('url'), t('icon'), t('pageKey')], rootTitleKey: 'name' }
	},
	footer: {
		footerConfig: { fields: [b('enable', '启用页脚 HTML 注入', '内容在「页脚 HTML」里编辑')] }
	},
	// 页脚 HTML：整份文件就是一段 HTML，走源码编辑器，没有表单字段
	'footer-html': {},
	// ============ 外观 ============
	wallpaper: {
		backgroundWallpaper: {
			fields: [
				sel('mode', ['banner', 'fullscreen', 'overlay', 'none'], '壁纸模式'),
				b('playerEnable', '启用背景视频', '启用后导航栏显示视频播放按钮'),
				g('src', [
					dual('desktop', 'strList', { asset: 'wallpaper-desktop' }, '桌面壁纸', '可单个值或多个随机轮播；支持图床外链或导入本地图片'),
					dual('mobile', 'strList', { asset: 'wallpaper-mobile' }, '手机壁纸'),
					dual('playerUrl', 'strList', { asset: 'video' }, '背景视频地址', '可多个视频循环/随机播放')
				]),
				g('common', [
					n('dimOpacity', '遮罩暗度', '0-1'),
					sel('playerMode', ['order', 'random'], '多视频播放模式'),
					g('homeText', [
						b('enable'), t('title'), t('titleSize', undefined, 'CSS 尺寸，如 4.5rem'),
						dual('subtitle', 'strList', undefined, '副标题', '可多个值打字机轮播'), t('subtitleSize'),
						g('typewriter', [b('enable'), n('speed'), n('deleteSpeed'), n('pauseTime')]),
						b('linksEnable'),
						lst('links', [t('name'), t('url'), t('icon'), b('showName')], '首页快捷链接', 'name')
					]),
					g('carousel', [b('enable'), n('interval', undefined, '毫秒'), sel('transitionEffect', ['fade', 'zoom', 'slide', 'kenburns'])]),
					dual('waves', 'boolObj', { dualFields: [b('desktop'), b('mobile')] }, '波浪特效'),
					g('gradient', [dual('enable', 'boolObj', { dualFields: [b('desktop'), b('mobile')] }, '渐变特效'), t('height')])
				]),
				g('banner', [
					t('position', '壁纸定位', 'CSS object-position，如 center'),
					g('postInfo', [sel('mode', ['description', 'meta'])]),
					g('navbar', [sel('transparentMode', ['semi', 'semifull', 'none']), n('blur')])
				]),
				g('overlay', [n('zIndex'), n('opacity'), n('blur', undefined, 'px'), n('cardOpacity', undefined, '0-1')]),
				g('fullscreen', [
					sel('layout', ['classic', 'hero']),
					t('position', '壁纸定位'),
					g('navbar', [sel('transparentMode', ['semi', 'semifull']), n('blur')]),
					g('blurRamp', [dual('enable', 'boolObj', { dualFields: [b('desktop'), b('mobile')] }, '渐变过渡')], '模糊过渡')
				])
			]
		}
	},
	sidebar: {
		sidebarLayoutConfig: {
			fields: [
				b('enable'),
				sel('position', ['left', 'right', 'both'], '边栏位置'),
				sel('tabletSidebar', ['left', 'right'], '平板端显示哪侧'),
				b('hideSidebarOnPostPage'),
				b('showBothSidebarsOnPostPage'),
				sidebarList('leftComponents', '左边栏组件'),
				sidebarList('rightComponents', '右边栏组件'),
				sidebarListMobile('mobileBottomComponents', '移动端底部组件')
			]
		}
	},
	display: {
		displaySettingsConfig: {
			fields: [
				b('enable', '总开关'),
				b('themeColorSwitchable'), b('layoutSwitchable'), b('cardBorderSwitchable'), b('cardFollowThemeSwitchable'),
				b('wallpaperModeSwitchable'), b('fullscreenLayoutSwitchable'), b('wavesSwitchable'), b('gradientSwitchable'),
				b('bannerTitleSwitchable'), b('bannerCarouselSwitchable'), b('sakuraSwitchable'),
				dual('overlaySwitchable', 'boolObj', { dualFields: [b('opacity'), b('blur'), b('cardOpacity')] }, '遮罩可调开关')
			]
		}
	},
	cover: {
		coverImageConfig: {
			fields: [b('enableInPost'), b('enableInPostOverlay'), b('showLoading'), g('randomCoverImage', [b('enable'), sl('apis', '随机图 API')])]
		}
	},
	effects: {
		sakuraConfig: {
			fields: [
				b('enable'), n('sakuraNum', '樱花数量'), n('limitTimes', undefined, '-1 为无限循环'), n('zIndex'),
				g('size', [n('min'), n('max')]),
				g('opacity', [n('min', undefined, '0-1'), n('max', undefined, '0-1')]),
				g('speed', [g('horizontal', [n('min'), n('max')]), g('vertical', [n('min'), n('max')]), n('rotation'), n('fadeSpeed')])
			]
		}
	},
	font: {
		fontsList: {
			rootItem: [
				t('name'), t('cssVariable', 'CSS 变量名'), sel('provider', ['google', 'fontsource', 'local', 'bunny', 'fontshare', 'npm']),
				sl('weights'), sl('styles'), sl('subsets'), sl('fallbacks'),
				sel('display', ['auto', 'optional', 'fallback', 'block', 'swap'])
			],
			rootTitleKey: 'name'
		},
		fontConfig: {
			fields: [
				b('enable'),
				dual('selected', 'strList', undefined, '已选字体', '填 fontsList 里的 cssVariable 或 system；可多选'),
				t('bannerTitleFont', '横幅标题字体', 'cssVariable，留空用默认'),
				t('bannerSubtitleFont'), t('navbarTitleFont'), t('codeFont'),
				{ k: 'subsetFonts', w: 'kvList', label: '字体子集化补充字符', item: [ta('extraChars')], hint: '键为 cssVariable，值为额外要包含的字符' }
			]
		}
	},
	gallery: {
		galleryConfig: {
			fields: [
				lst('albums', [
					t('id', '相册 ID', '对应 public/gallery/<id> 文件夹'), t('name'), ta('description'), t('location'),
					t('date', undefined, 'YYYY-MM-DD'), sl('tags'), t('cover', '封面', '可留空，自动取文件夹封面'),
					t('password', '访问密码'), t('passwordHint', '密码提示')
				], '相册列表', 'name'),
				n('columnWidth', '瀑布流最小列宽')
			]
		}
	},
	pio: {
		spineModelConfig: {
			fields: [
				b('enable'),
				g('model', [t('path'), n('scale'), n('x'), n('y')]),
				g('position', [sel('corner', ['bottom-left', 'bottom-right', 'top-left', 'top-right']), n('offsetX'), n('offsetY')]),
				g('size', [n('width'), n('height')]),
				g('interactive', [
					b('enabled'), sl('clickAnimations'), sl('clickMessages'), n('messageDisplayTime', undefined, '毫秒'),
					sl('idleAnimations'), n('idleInterval', undefined, '毫秒')
				]),
				g('responsive', [b('hideOnMobile'), n('mobileBreakpoint')]),
				n('zIndex'), n('opacity', undefined, '0-1')
			]
		},
		live2dWidgetConfig: {
			fields: [
				b('enable'),
				lst('model', [t('path'), n('volume', undefined, '0-1'), n('scale'), n('x'), n('y')], '模型列表', 'path'),
				sel('position', ['bottom-left', 'bottom-right']),
				g('size', [n('width'), n('height')]),
				t('primaryColor', '主色', '支持 CSS 变量，如 var(--l2d-msg-bg)'),
				n('transitionDuration', undefined, '毫秒'),
				sel('transitionType', ['slide', 'fade']),
				g('menus', [sel('align', ['left', 'right']), lst('items', [t('icon'), t('label'), t('action')], '菜单项', 'label')]),
				g('tips', [
					b('enable'), sl('welcomeMessage'), sl('messages'), n('duration'), n('interval'),
					g('offset', [n('x'), n('y')])
				]),
				g('responsive', [b('hideOnMobile'), n('mobileBreakpoint')])
			]
		}
	},
	// ============ 功能 ============
	expressive: {
		expressiveCodeConfig: {
			fields: [
				t('darkTheme', '暗色代码主题'), t('lightTheme', '亮色代码主题'),
				g('pluginCollapsible', [b('enable'), n('lineThreshold'), n('previewLines'), b('defaultCollapsed')]),
				g('pluginLanguageBadge', [b('enable')]),
				g('pluginLanguageLogo', [b('enable'), sel('color', ['mono', 'original', 'theme'], '徽标配色'), sl('excludedLangs')])
			]
		}
	},
	mermaid: {
		mermaidConfig: {
			fields: [
				sel('lightTheme', ['editor-light', 'gruvbox-light', 'ayu-light']),
				sel('darkTheme', ['editor-dark', 'one-dark', 'gruvbox-dark', 'ayu-dark'])
			]
		}
	},
	plantuml: {
		plantumlConfig: {
			fields: [b('enable'), t('server', 'PlantUML 服务地址'), t('lightTheme', '亮色主题', '留空则不注入主题'), t('darkTheme')]
		}
	},
	license: {
		licenseConfig: {
			fields: [b('enable'), t('name', '协议名称'), t('url'), t('icon', '图标', 'Iconify 名，留空按名称自动匹配')]
		}
	},
	comment: {
		commentConfig: {
			fields: [
				sel('type', ['none', 'twikoo', 'waline', 'giscus', 'disqus', 'artalk'], '评论系统类型'),
				g('twikoo', [t('envId'), t('region'), t('lang'), b('visitorCount'), t('jsUrl'), t('cssUrl')]),
				g('waline', [t('serverURL'), t('lang'), sl('emoji', '表情包地址'), sel('login', ['enable', 'force', 'disable']), b('visitorCount')]),
				g('artalk', [t('server'), t('locale'), b('visitorCount')]),
				g('giscus', [
					t('repo'), t('repoId'), t('category'), t('categoryId'), t('mapping'), t('strict'),
					t('reactionsEnabled'), t('inputPosition'), t('lang'), t('loading')
				]),
				g('disqus', [t('shortname')])
			]
		}
	},
	analytics: {
		analyticsConfig: {
			fields: [
				t('googleAnalyticsId', 'Google Analytics ID'),
				t('microsoftClarityId', 'Microsoft Clarity ID'),
				g('umamiAnalytics', [
					t('websiteId', 'Umami Website ID'),
					t('scriptUrl', 'Umami JS 地址'),
					t('replaysScriptUrl', '回放 JS 地址'),
					b('trackOutboundLinks'), b('collectWebVitals'),
					g('replays', [
						b('enabled'), n('sampleRate', '采样率', '0-1'),
						sel('maskLevel', ['moderate', 'strict']), n('maxDuration', undefined, '毫秒'),
						t('blockSelector', '屏蔽选择器', 'CSS 选择器')
					])
				]),
				g('la51Analytics', [t('Id'), t('sdkUrl'), t('ck'), b('autoTrack'), b('hashMode'), b('screenRecord')])
			]
		}
	},
	music: {
		musicPlayerConfig: {
			fields: [
				b('showInNavbar'), b('showInSidebar'),
				sel('mode', ['meting', 'local'], '音乐模式', 'meting=云端歌单 API，local=本地歌单'),
				n('volume', '默认音量', '0-1'),
				sel('playMode', ['list', 'one', 'random']),
				b('showLyrics'),
				g('meting', [
					t('api', 'Meting API 地址'), sel('server', ['netease', 'tencent', 'kugou', 'xiami', 'baidu'], '音乐平台'),
					sel('type', ['song', 'playlist', 'album', 'search', 'artist']), t('id', '歌单/单曲 ID'), t('auth', '认证 Token'),
					sl('fallbackApis', '备用 API')
				]),
				g('local', [
					lst('playlist', [
						t('name'), t('artist'),
						asset('url', 'music', '音频文件'), asset('cover', 'music-cover', '封面图片'),
						asset('lrc', 'music-lrc', '歌词文件', '也可直接粘贴歌词文本')
					], '本地歌单', 'name')
				])
			]
		}
	},
	dynamic: {
		dynamicConfig: {
			fields: [
				t('title'), t('description'), t('profileUrl'), b('showComment'), n('itemsPerPage'),
				t('apiUrl', '本地数据源地址', 'memos 启用时此配置被忽略'),
				g('memos', [
					b('enable', '启用 Memos 远端数据源', '关闭后网站改为读取本地动态文件'),
					t('apiUrl', 'Memos 实例地址'), t('parent', '用户标识', '需与 Memos creator 完全一致，如 users/Firefly')
				])
			]
		}
	},
	announcement: {
		announcementConfig: {
			fields: [
				t('title', '公告标题', '留空用默认翻译'),
				ta('content', '公告内容'),
				b('closable', '允许用户关闭公告'),
				t('icon', '图标', '留空用默认'),
				sel('type', ['info', 'warning', 'success', 'error'], '公告类型', '留空用默认'),
				g('link', [b('enable'), t('text'), t('url'), b('external', '新窗口打开')])
			]
		}
	},
	booknav: {
		booknavPageConfig: {
			fields: [
				t('title'), t('description'),
				g('favicon', [b('enabled'), t('api', 'Favicon API', '支持 {domain} 占位符')])
			]
		},
		booknavConfig: {
			rootItem: [
				t('id', '分组 ID', '锚点用'), t('name'), t('icon'), ta('desc'), n('weight'), b('enabled'),
				lst('items', [t('title'), t('url'), ta('desc'), t('icon', '图标', 'Iconify 名或图片路径，留空自动抓取 favicon'), n('weight'), b('enabled')], '书签', 'title')
			],
			rootTitleKey: 'name'
		}
	},
	sponsor: {
		sponsorConfig: {
			fields: [
				t('title', '打赏页标题', '留空用默认'), ta('description'), ta('usage', '赞助用途说明'),
				b('showSponsorsList'), b('showComment'), b('showButtonInPost'),
				lst('methods', [
					t('name'), t('icon'), asset('qrCode', 'sponsor', '收款二维码'), t('link'), t('description'), b('enabled')
				], '打赏方式', 'name'),
				lst('sponsors', [t('name'), t('avatar', '头像', '外链或留空'), t('amount', '金额'), t('date', '日期', 'YYYY-MM-DD')], '赞助名单', 'name')
			]
		}
	},
	// ============ 内容 ============
	friends: {
		friendsPageConfig: {
			fields: [t('title'), t('description'), b('showCustomContent'), b('showComment'), b('randomizeSort')]
		},
		friendsConfig: {
			rootItem: [t('title'), t('imgurl', '头像地址'), ta('desc'), t('siteurl'), sl('tags'), n('weight'), b('enabled')],
			rootTitleKey: 'title'
		}
	}
}

function sidebarList(k: string, label: string): FieldDef {
	return lst(
		k,
		[sel('type', SIDEBAR_TYPES), b('enable'), b('showTitle'), sel('position', ['top', 'sticky']), b('showOnPostPage'), b('hideOnNonPostPage')],
		label,
		'type'
	)
}

function sidebarListMobile(k: string, label: string): FieldDef {
	return lst(k, [sel('type', SIDEBAR_TYPES), b('enable'), b('showTitle'), b('hideOnNonPostPage')], label, 'type')
}
