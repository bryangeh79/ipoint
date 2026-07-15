# Codex Quota Interruption Recovery Protocol

> Status: APPROVED
> Date: 2026-07-16
> Source: ChatGPT Command Center

当 Codex CLI 因 usage limit、rate limit、authentication interruption 或服务暂时不可用而停止时：

## 1. 立即停止

立即停止继续调度新的 Codex 任务。

## 2. 不得切换认证方式

不得切换为 API Key、OpenClaw Token 或其他付费认证方式。

## 3. 记录现场

记录以下信息：

- Worker
- Small Phase
- Task ID
- Branch
- Last successful commit SHA
- Last pushed commit SHA
- 当前 git status --short
- 已完成内容
- 未完成内容
- 已运行测试
- 未运行测试
- 错误原文

## 4. 未提交修改处理

如存在未提交修改：

- 不得删除
- 不得 reset
- 不得 stash
- 不得由 OpenClaw 自行修改
- 保存 git diff 和 changed-file 清单

## 5. 标记任务状态

```
PAUSED_QUOTA_LIMIT
```

## 6. 等待额度恢复

等额度恢复后，用 CHATGPT_ACCOUNT_SESSION 重新启动 Codex CLI。

## 7. 新会话强制读取

新 Codex 会话必须先读取：

- AGENTS.md
- CODEX_WORKFLOW_RULES.md
- 当前 Phase Brief
- Task Recovery Report
- git log --oneline
- git status --short
- git diff

## 8. 输出 Recovery Assessment

Codex 必须先输出：

- 当前分支
- 最新 commit
- 已完成范围
- 剩余范围
- 是否存在未提交修改
- 下一步动作

## 9. OpenClaw 确认

OpenClaw 确认后，才继续原任务。

## 10. 底线

禁止因为额度限制而切换 API Key 或产生独立 API 计费。
