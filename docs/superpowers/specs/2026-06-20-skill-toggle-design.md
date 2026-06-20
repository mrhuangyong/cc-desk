# 技能级启停设计

日期：2026-06-20
状态：已确认，待实现

## 背景

技能列表的启用/禁用开关无法切换。根因：技能 `enabled` 是只读的（跟随所属插件，恒为 true），Toggle 的 onChange 只调 reload 重新拉取，没有任何代码实际切换状态。后端也没有单独控制技能 enabled 的机制。

## 实测结论

SDK 的 `query()` 有 `skills?: string[] | 'all'` option：

- **接受纯技能名**（SKILL.md 的 `name` 或目录名），不接受 `user:`/`plugin:` 前缀格式。
- 白名单机制真实生效：传 `skills: ['a','b']` 时，未列出的技能从模型列表隐藏且 Skill 工具拒绝调用。
- 不传（默认）时 CLI 自己加载发现的全部技能。

## 机制：黑名单存配置 + query 传白名单

- 后端 settings.json 维护 `disabledSkills: string[]`（禁用技能名列表）。
- `getSkills()` 时读取黑名单，标记每条技能 `enabled = !disabledSkills.includes(name)`。
- cc-desk 调 query 时，把所有技能名减去黑名单得到启用列表，传 `skills: enabledNames`（精确白名单）。禁用的技能真实不加载。

## key 用纯技能名

SDK 只认纯名，所以黑名单和白名单都用 `ClaudeSkill.name`。同名技能（用户级与插件级同名）会一起被禁用——这是 SDK 白名单机制的固有限制，不在本功能范围内额外处理。

## 改动点

1. **后端 `claude-config.ts`**：新增 `getDisabledSkills()` 读写 settings.json 的 `disabledSkills`；新增 `setSkillEnabled(name, enabled)` 维护该列表（enabled=false 加入，true 移除）；`getSkills()` 标记每条 enabled。
2. **`claude-service.ts` buildQuery**：加 `skills: enabledNames`（从 getSkills 算出所有 enabled 的 name 数组）。
3. **IPC**：`cc:skill:set-enabled`(name, enabled)，preload + global.d.ts。
4. **`SkillsSettings.tsx`**：Toggle 的 onChange 改为调 `setSkillEnabled` 后 reload。

## 默认行为

新技能默认启用（不在黑名单）。已禁用的技能持久化，下次启动仍禁用。

## 测试

- 后端：扩展测试覆盖 setSkillEnabled 写 settings.json、getSkills 反映 enabled 状态、往返一致。隔离 CLAUDE_CONFIG_DIR。
- 渲染端：Toggle 点击触发 setSkillEnabled，状态变更后 reload。

## 不做的事

- 不处理同名技能冲突（SDK 固有限制）。
- 不改技能列表的弹窗功能（上轮已实现）。
