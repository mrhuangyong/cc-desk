// src/renderer/i18n/index.ts
// 轻量国际化：按 settings.lang 切换界面文案。
// 支持 zh-CN（简体中文）与 en（English）。
// 翻译表按组件/区域分组，key 用「区域.文案」约定。

export type Lang = 'zh-CN' | 'en'

const dict: Record<Lang, Record<string, string>> = {
  'zh-CN': {
    // 标题栏
    'title.newSession': '新建会话',
    'title.settings': '设置',
    // 左面板
    'left.projects': '项目',
    'left.sessions': '会话',
    'left.newSession': '新会话',
    'left.addProject': '添加项目',
    'left.skills': '技能',
    'left.empty': '暂无项目',
    // 输入栏
    'input.placeholder': '输入消息，Enter 发送…',
    'input.send': '发送',
    'input.stop': '停止',
    'input.permission': '权限',
    'input.thinking': '思考',
    'input.model': '模型',
    'input.attach': '附件',
    // 聊天区
    'chat.empty': '开始新的对话',
    'chat.noSession': '无选中会话',
    'chat.taskDone': '任务完成',
    'chat.taskDoneBody': 'Claude 已完成本轮任务',
    'chat.thinking': '思考过程',
    'chat.error': '请先在「设置 → 模型设置」中配置 API Key 或 Auth Token',
    // 设置菜单
    'settings.back': '← 返回工作区',
    'settings.general': '常规',
    'settings.codePreview': '代码预览',
    'settings.model': '模型设置',
    'settings.skills': '技能',
    'settings.mcp': 'MCP 服务器',
    'settings.plugins': '插件',
    'settings.commands': '命令',
    'settings.hooks': 'hooks',
    'settings.archived': '已归档会话',
    // 模型设置（多供应商）
    'model.title': '模型设置',
    'model.desc': '管理自定义模型供应商，配置后可在聊天时选择使用。',
    'model.providers': '自定义供应商',
    'model.addProvider': '添加供应商',
    'model.baseUrl': 'Base URL',
    'model.apiKey': 'API Key',
    'model.models': '模型列表',
    'model.addModel': '添加模型',
    'model.sdkModelId': '模型 ID',
    'model.contextLength': '上下文',
    'model.enabled': '已启用',
    'model.enable': '启用',
    'model.disable': '禁用',
    'model.emptyProvider': '选择左侧供应商，或点"添加供应商"',
    'model.emptyModels': '暂无模型，点下方添加',
    'model.newProvider': '新供应商',
    'model.newModel': '新模型',
    'model.confirmDelete': '确认删除？',
  },
  'en': {
    'title.newSession': 'New session',
    'title.settings': 'Settings',
    'left.projects': 'Projects',
    'left.sessions': 'Sessions',
    'left.newSession': 'New session',
    'left.addProject': 'Add project',
    'left.skills': 'Skills',
    'left.empty': 'No projects',
    'input.placeholder': 'Type a message, Enter to send…',
    'input.send': 'Send',
    'input.stop': 'Stop',
    'input.permission': 'Permission',
    'input.thinking': 'Thinking',
    'input.model': 'Model',
    'input.attach': 'Attach',
    'chat.empty': 'Start a new conversation',
    'chat.noSession': 'No session selected',
    'chat.taskDone': 'Task complete',
    'chat.taskDoneBody': 'Claude has finished this turn',
    'chat.thinking': 'Thinking',
    'chat.error': 'Configure API Key or Auth Token in Settings → Model first',
    'settings.back': '← Back to workspace',
    'settings.general': 'General',
    'settings.codePreview': 'Code preview',
    'settings.model': 'Model',
    'settings.skills': 'Skills',
    'settings.mcp': 'MCP servers',
    'settings.plugins': 'Plugins',
    'settings.commands': 'Commands',
    'settings.hooks': 'Hooks',
    'settings.archived': 'Archived Sessions',
    // 模型设置（多供应商）
    'model.title': 'Model settings',
    'model.desc': 'Manage custom model providers; pick one when chatting.',
    'model.providers': 'Custom providers',
    'model.addProvider': 'Add provider',
    'model.baseUrl': 'Base URL',
    'model.apiKey': 'API Key',
    'model.models': 'Models',
    'model.addModel': 'Add model',
    'model.sdkModelId': 'Model ID',
    'model.contextLength': 'Context',
    'model.enabled': 'Enabled',
    'model.enable': 'Enable',
    'model.disable': 'Disable',
    'model.emptyProvider': 'Select a provider on the left, or "Add provider"',
    'model.emptyModels': 'No models yet, add below',
    'model.newProvider': 'New provider',
    'model.newModel': 'New model',
    'model.confirmDelete': 'Confirm delete?',
  },
}

export function translate(lang: Lang, key: string): string {
  return dict[lang]?.[key] ?? dict['zh-CN'][key] ?? key
}

// 返回某语言的全部 key（用于测试漏译检测，非运行时路径）
export function dictKeys(lang: Lang): string[] {
  return Object.keys(dict[lang] ?? {})
}

export const SUPPORTED_LANGS: { id: Lang; label: string }[] = [
  { id: 'zh-CN', label: '简体中文' },
  { id: 'en', label: 'English' },
]
