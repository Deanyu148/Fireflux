/** 表单字段定义类型（schema）。未显式指定控件类型时按值类型自动推断。 */
export type Widget =
	| 'text'
	| 'textarea'
	| 'number'
	| 'bool'
	| 'select'
	| 'stringList'
	| 'list'
	| 'group'
	| 'dual'
	| 'kvList'
	| 'code'

export interface FieldDef {
	/** 字段键名 */
	k: string
	/** 显示名，缺省时用配置文件里的注释 */
	label?: string
	/** 控件类型，缺省自动推断 */
	w?: Widget
	/** select 的选项 */
	options?: string[]
	/** group 的子字段 */
	fields?: FieldDef[]
	/** list（对象数组）的每项字段 */
	item?: FieldDef[]
	/** list 项标题取哪个字段 */
	titleKey?: string
	/** 双形态：字符串或数组 */
	dual?: 'strList' | 'boolObj'
	/** boolObj 形态下的对象字段 */
	dualFields?: FieldDef[]
	/** 资源导入通道 */
	asset?: string
	/** 提示文字 */
	hint?: string
	/** 额外追加到 list 项添加时的默认值模板 */
	defaults?: unknown
}
