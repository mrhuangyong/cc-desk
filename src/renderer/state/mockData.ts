import type { Project, FileNode, ModelProvider, ModelItem, SkillItem, McpServer, SettingsEntry, Plugin } from '../types'

export const mockProjects: Project[] = [
  {
    id: 'p1',
    name: 'cc-desk',
    sessions: [
      { id: 's1', title: '重构登录流程', messages: [
        { id: 'm1', role: 'user', content: '帮我把登录改成 token 刷新机制' },
        { id: 'm2', role: 'assistant', content: '好的，我先看一下当前的 auth 逻辑……' }
      ]},
      { id: 's2', title: '修样式 bug', messages: [] }
    ]
  },
  {
    id: 'p2',
    name: '个人博客',
    sessions: [
      { id: 's3', title: '部署到 Vercel', messages: [
        { id: 'm3', role: 'user', content: '怎么部署？' }
      ]}
    ]
  }
]

export const mockFileTrees: Record<string, FileNode[]> = {
  p1: [
    { name: 'src', path: 'src', isDir: true, children: [
      { name: 'main.tsx', path: 'src/main.tsx', isDir: false },
      { name: 'App.tsx', path: 'src/App.tsx', isDir: false },
      { name: 'components', path: 'src/components', isDir: true, children: [
        { name: 'Button.tsx', path: 'src/components/Button.tsx', isDir: false }
      ]}
    ]},
    { name: 'package.json', path: 'package.json', isDir: false }
  ],
  p2: [
    { name: 'index.md', path: 'index.md', isDir: false },
    { name: 'about.md', path: 'about.md', isDir: false }
  ]
}

// mock 文件内容（按路径）
export const mockFileContents: Record<string, string> = {
  'src/main.tsx': 'import React from "react"\nimport App from "./App"\n\nrender(<App />, document.getElementById("root"))',
  'src/App.tsx': 'export default function App() {\n  return <div>Hello</div>\n}',
  'package.json': '{\n  "name": "cc-desk"\n}'
}

export const mockProviders: ModelProvider[] = [
  { id: 'aiproxy', name: 'aiproxy', apiKey: 'sk-••••••••', baseUrl: 'http://localhost:17860', apiFormat: 'Anthropic Messages (/v1/messages)', enabled: true },
  { id: 'mimo', name: 'mimo', apiKey: '', baseUrl: 'https://api.mimo.ai/v1', apiFormat: 'OpenAI Chat (/v1/chat/completions)', enabled: false }
]

export const mockModels: ModelItem[] = [
  { id: 'glm-5.2', name: 'glm-5.2', providerId: 'aiproxy', contextLength: '20万', enabled: true },
  { id: 'glm-5-turbo', name: 'glm-5-turbo', providerId: 'aiproxy', contextLength: '20万', enabled: true },
  { id: 'kimi-for-coding', name: 'kimi-for-coding', providerId: 'aiproxy', contextLength: '100万', enabled: true },
  { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro', providerId: 'aiproxy', contextLength: '100万', enabled: true },
  { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash', providerId: 'aiproxy', contextLength: '100万', enabled: false }
]

export const mockSkills: SkillItem[] = [
  { id: 'ding', name: 'ding', desc: 'Use for Ding-style (钉内/钉外) workplace reminders rooted in the 置身钉内 corpus.', enabled: true, scope: '个人' },
  { id: 'electron', name: 'electron', desc: 'Automate Electron desktop apps (VS Code, Slack, Discord, Figma...).', enabled: true, scope: '个人' },
  { id: 'frontend-design', name: 'frontend-design', desc: 'Create distinctive, production-grade frontend interfaces.', enabled: true, scope: '个人' },
  { id: 'mama', name: 'mama', desc: '妈妈唠叨模式 — 中国式妈妈提醒风格的生产力 coaching。', enabled: true, scope: '个人' },
  { id: 'p10', name: 'p10', desc: 'P10 CTO mode — define strategic direction, design org topology.', enabled: true, scope: '个人' },
  { id: 'p7', name: 'p7', desc: 'P7 Senior Engineer mode — solution-driven execution under P8.', enabled: true, scope: '个人' },
  { id: 'p9', name: 'p9', desc: 'P9 Tech Lead mode — write Task Prompts, manage P8 agent teams.', enabled: true, scope: '个人' },
  { id: 'pro', name: 'pro', desc: 'PUA Pro extensions: self-evolution notes, compaction continuity.', enabled: true, scope: '个人' },
  { id: 'pua', name: 'pua', desc: 'Use for PUA/try-harder productivity coaching when user expresses frustration.', enabled: true, scope: '个人' },
  { id: 'pua-en', name: 'pua-en', desc: 'Performance-coaching mode for repeated failures (English).', enabled: true, scope: '个人' },
  { id: 'pua-ja', name: 'pua-ja', desc: '日本語の生産性コーチングモード。', enabled: true, scope: '个人' },
  { id: 'pua-loop', name: 'pua-loop', desc: 'PUA Loop — guided iterative development with recurring checks.', enabled: true, scope: '个人' },
  { id: 'shot', name: 'shot', desc: 'PUA Shot — compact all-in-one PUA reference.', enabled: true, scope: '个人' },
  { id: 'yes', name: 'yes', desc: 'SB Leader 夸夸模式 — ENFP 型领导，懂情绪有节奏。', enabled: true, scope: '个人' }
]

export const mockMcpServers: McpServer[] = [
  { id: 'playwright', name: 'Playwright', transport: 'stdio', command: 'npx', args: '-y @playwright/mcp@latest', env: '', enabled: true, scope: '用户' },
  { id: 'web-reader', name: 'web-reader', transport: 'http', command: 'https://open.bigmodel.cn/api/mcp/web_reader/mcp', args: '', env: '', enabled: true, scope: '用户' },
  { id: 'web-search-prime', name: 'web-search-prime', transport: 'http', command: 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp', args: '', env: '', enabled: true, scope: '用户' },
  { id: 'zai-mcp-server', name: 'zai-mcp-server', transport: 'stdio', command: 'npx', args: '-y @z_ai/mcp-server', env: '', enabled: true, scope: '用户' },
  { id: 'zread', name: 'zread', transport: 'http', command: 'https://open.bigmodel.cn/api/mcp/zread/mcp', args: '', env: '', enabled: true, scope: '用户' },
  { id: 'codegraph', name: 'codegraph', transport: 'stdio', command: 'codegraph', args: 'serve --mcp', env: '', enabled: true, scope: '用户' }
]

export const mockPlugins: Plugin[] = [
  { id: 'android-emulator', name: 'android-emulator', version: 'v0.1.0', desc: '为 ZCode 提供 Android 开发工作流和模拟器自动化能力。', enabled: false, source: '官方', skills: 0, commands: 0, mcps: 1 },
  { id: 'document-skills', name: 'document-skills', version: 'v0.1.0', desc: 'ZCode 内置的 DOCX 与 PDF 文档生成技能。', enabled: true, source: '官方', skills: 2, commands: 0, mcps: 0 },
  { id: 'ios-simulator', name: 'ios-simulator', version: 'v0.1.0', desc: '为 ZCode 提供 iOS 开发工作流和模拟器自动化能力。', enabled: false, source: '官方', skills: 0, commands: 0, mcps: 1 },
  { id: 'restore-legacy-sessions', name: 'restore-legacy-sessions', version: 'v0.1.0', desc: '选择并恢复旧版 ACP-era ZCode session 到新 ZCode 任务与会话库。', enabled: false, source: '官方', skills: 0, commands: 0, mcps: 0 },
  { id: 'skill-creator', name: 'skill-creator', version: 'v0.1.0', desc: '创建、编辑并迭代本地 ZCode 技能。', enabled: true, source: '官方', skills: 1, commands: 0, mcps: 0 },
  { id: 'superpowers', name: 'superpowers', version: 'v5.1.0', desc: 'Planning, TDD, debugging, and delivery workflows for coding agents.', enabled: true, source: '官方', skills: 14, commands: 0, mcps: 0 }
]

export const mockCommands: SettingsEntry[] = [
  { id: 'c1', name: '/review', desc: '审查代码', enabled: true },
  { id: 'c2', name: '/test', desc: '生成测试', enabled: true },
  { id: 'c3', name: '/commit', desc: '生成提交', enabled: false }
]

export const mockHooks: SettingsEntry[] = [
  { id: 'h1', name: 'PreToolUse', desc: '工具调用前钩子', enabled: true },
  { id: 'h2', name: 'PostToolUse', desc: '工具调用后钩子', enabled: false }
]
