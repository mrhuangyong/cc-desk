import type { Project, FileNode, ModelProvider, ModelItem, SkillItem, McpServer, SettingsEntry } from '../types'

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
  { id: 'anthropic', name: 'Anthropic', apiKey: '', baseUrl: 'https://api.anthropic.com' },
  { id: 'openai', name: 'OpenAI', apiKey: '', baseUrl: 'https://api.openai.com/v1' },
  { id: 'local', name: '本地模型 (Ollama)', apiKey: '', baseUrl: 'http://localhost:11434' }
]

export const mockModels: ModelItem[] = [
  { id: 'claude-sonnet', name: 'Claude Sonnet 4.6', providerId: 'anthropic' },
  { id: 'claude-haiku', name: 'Claude Haiku 4.5', providerId: 'anthropic' },
  { id: 'gpt-4o', name: 'GPT-4o', providerId: 'openai' },
  { id: 'llama3', name: 'Llama 3', providerId: 'local' }
]

export const mockSkills: SkillItem[] = [
  { id: 'review', name: '代码审查', desc: '审查当前改动，找出 bug 与可优化点', enabled: true },
  { id: 'test', name: '生成测试', desc: '为选中代码生成单元测试', enabled: true },
  { id: 'refactor', name: '重构建议', desc: '给出重构方案与影响分析', enabled: false },
  { id: 'explain', name: '解释代码', desc: '逐行解释选中代码的作用', enabled: true },
  { id: 'commit', name: '生成提交信息', desc: '根据改动生成 commit message', enabled: false }
]

export const mockMcpServers: McpServer[] = [
  { id: 'fs', name: '文件系统', url: 'mcp://filesystem', enabled: true },
  { id: 'gh', name: 'GitHub', url: 'mcp://github', enabled: true },
  { id: 'db', name: '数据库', url: 'mcp://postgres', enabled: false }
]

export const mockPlugins: SettingsEntry[] = [
  { id: 'p1', name: 'frontend-design', desc: '前端设计辅助', enabled: true },
  { id: 'p2', name: 'deep-research', desc: '深度研究', enabled: false }
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
