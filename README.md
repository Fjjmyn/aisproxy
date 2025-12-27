# ais2api-main - 浏览器自动化管理服务器

基于 Ellinav/ais2api 原始架构重构，专注于 **iframe 监控和浏览器保活**，用于自动维持 Google AI Studio Preview 的连接。

## 功能概述

✓ **多账号浏览器实例管理** - 支持多个独立浏览器进程  
✓ **Cookie 认证** - 支持环境变量和文件模式  
✓ **iframe 监控** - 实时监控 Preview iframe 中的 WS 连接状态  
✓ **智能保活** - 定时在 iframe 内点击，防止连接断开  
✓ **自动重连** - WS 断开时自动点击 Connect/Disconnect 重连  
✓ **健康检查端点** - `/health` 提供实时进程状态  
✓ **详细日志输出** - 完整的启动、运行和错误诊断日志  

## 与原项目的差异

| 功能 | ais2api-original | ais2api-main |
|------|-----------------|-------------|
| **浏览器管理** | 单实例 BrowserManager，支持多账号切换 | 多进程，每进程一个账号 |
| **Cookie 验证** | 完整（4 种检查 + 诊断） | 完整（已修复，现已对齐） |
| **iframe 监控** | ✗ 无 | ✓ 有 |
| **WS 连接管理** | ✗ 无 | ✓ 有 |
| **保活机制** | ✗ 无 | ✓ 有 |
| **目标 URL** | 固定的 AI Studio 构建器 | 环境变量配置（更灵活） |

## 快速开始

### 1. 环境配置

复制 `.env.example` 创建 `.env` 文件：

```bash
cp .env.example .env
```

### 2. 必需的环境变量

```env
# 所有浏览器实例访问的目标 URL（必需）
CAMOUFOX_INSTANCE_URL="https://aistudio.google.com/apps/drive/..."

# 认证信息（以下任选其一）

# 方式 1：环境变量（推荐）
AUTH_JSON_1='{"cookies": [...], "storageState": {...}, "accountName": "account1"}'

# 方式 2：文件（auth/ 目录下的 auth-1.json, auth-2.json 等）
```

### 3. 可选配置

```env
# HTTP 服务端口（默认 7860）
PORT=7860

# 监听地址（默认 0.0.0.0）
HOST=0.0.0.0

# 无头模式（默认 true）
CAMOUFOX_HEADLESS=true

# 代理服务器
CAMOUFOX_PROXY="http://proxy:8080"

# 实例启动间隔（秒，默认 30）
INSTANCE_START_DELAY=30
```

### 4. 启动服务

```bash
# 本地运行
npm install
npm start

# Docker 运行
docker build -t ais2api-main .
docker run -e CAMOUFOX_INSTANCE_URL=... -e AUTH_JSON_1=... -p 7860:7860 ais2api-main
```

## 健康检查

```bash
curl http://localhost:7860/health
```

**响应示例**:
```json
{
  "status": "healthy",
  "browser_instances": 2,
  "running_instances": 2,
  "instance_url": "https://aistudio.google.com/apps/...",
  "headless": true,
  "proxy": null,
  "message": "Application is running with 2 active browser instances",
  "processes": [
    {
      "pid": 1234,
      "display_name": "AUTH_JSON_1",
      "is_alive": true,
      "uptime": 3600,
      "uptime_formatted": "1h 0m"
    }
  ]
}
```

## 日志说明

### 启动日志
```
================ [ 启动浏览器实例 ] ================
将启动 2 个浏览器实例
目标 URL: https://aistudio.google.com/apps/...
启动间隔: 30 秒
=================================================
[1/2] 正在启动浏览器实例: AUTH_JSON_1
[1/2] 进程 #12345 已启动
[2/2] 正在启动浏览器实例: AUTH_JSON_2
[2/2] 进程 #12346 已启动
================ [ 进程监控中... ] ================
✓ 运行 - AUTH_JSON_1 (PID: 12345, 运行时长: 1h 30m)
✓ 运行 - AUTH_JSON_2 (PID: 12346, 运行时长: 1h 29m)
```

### 浏览器实例日志
```
[AUTH_JSON_1] INFO: 启动浏览器实例...
[AUTH_JSON_1] INFO: 已加载 N 个 Cookie
[AUTH_JSON_1] INFO: 使用 Camoufox: /app/camoufox-linux/camoufox
[AUTH_JSON_1] INFO: 正在启动 Camoufox 浏览器...
[AUTH_JSON_1] INFO: 正在导航到: https://aistudio.google.com/apps/...
[AUTH_JSON_1] INFO: [诊断] 最终 URL: https://...
[AUTH_JSON_1] INFO: [诊断] 页面标题: "AI Studio"
[AUTH_JSON_1] INFO: 处理弹窗...
[AUTH_JSON_1] INFO: 已处理弹窗
[AUTH_JSON_1] INFO: 启动保活循环...
[AUTH_JSON_1] INFO: 初始 WS 状态: CONNECTED
[AUTH_JSON_1] DEBUG: 已执行 10 次保活点击
```

### 错误日志示例
```
[AUTH_JSON_1] ERROR: Cookie 已失效/过期！浏览器被重定向到了 Google 登录页面。
[AUTH_JSON_1] ERROR: 当前 IP 不支持访问 Google AI Studio（地区限制）
[AUTH_JSON_1] ERROR: 当前 IP 信誉过低，被 Google 风控拒绝访问
[AUTH_JSON_1] ERROR: 页面加载失败 (about:blank)，可能是网络连接超时或浏览器崩溃
```

## Cookie 格式说明

### StorageState 格式（推荐）
使用 Playwright 的 `storageState` 包含完整的浏览器状态：

```json
{
  "cookies": [
    {
      "name": "...",
      "value": "...",
      "domain": ".google.com",
      "path": "/",
      ...
    }
  ],
  "origins": [
    {
      "origin": "https://aistudio.google.com",
      "localStorage": [...],
      "sessionStorage": [...]
    }
  ],
  "accountName": "account1"
}
```

### 简化格式（仅 Cookies）
```json
{
  "cookies": [...],
  "accountName": "account1"
}
```

## Cookie 提取方法

### 方法 1：使用原项目的 save-auth.js
```bash
node save-auth.js
```

### 方法 2：手动提取（Playwright Inspector）
```bash
npx playwright codegen https://aistudio.google.com
# 操作一遍，保存生成的 storageState
```

## 故障排除

### 问题 1：浏览器无法启动
```
ERROR: browserType.launch: Failed to launch firefox because executable doesn't exist
```

**解决**:
- 确保 Camoufox 已正确下载到 `/app/camoufox-linux/camoufox`
- 检查环境变量 `CAMOUFOX_EXECUTABLE_PATH` 是否设置
- Docker 中运行: `docker logs <container_id>` 查看具体错误

### 问题 2：Cookie 失效
```
ERROR: Cookie 已失效/过期！浏览器被重定向到了 Google 登录页面。
```

**解决**:
- 使用最新的 Cookie（Cookie 可能已过期）
- 验证 Cookie 的 domain 和 path 是否正确
- 重新提取 Cookie

### 问题 3：地区限制
```
ERROR: 当前 IP 不支持访问 Google AI Studio（地区限制）
```

**解决**:
- 使用支持的地区的代理或 VPN
- 设置 `CAMOUFOX_PROXY` 环境变量

### 问题 4：IP 风控
```
ERROR: 当前 IP 信誉过低，被 Google 风控拒绝访问
```

**解决**:
- 使用不同的 IP 地址
- 等待 24 小时后重试
- 更换代理服务

### 问题 5：WS 无法连接
```
WARN: WS 状态变更: CONNECTED -> IDLE
INFO: WS 断开，尝试重连...
```

**解决**:
- 这是正常的，保活机制会自动重连
- 检查日志是否有 `重连后 WS 状态: CONNECTED`
- 如果长期无法重连，检查网络连接或 iframe 布局

## 架构说明

```
┌─────────────────────────────────────────┐
│      unified-server.js (主进程)         │
│   - 加载配置                            │
│   - 启动浏览器实例进程                  │
│   - 监控进程状态                        │
│   - 提供 HTTP 服务（/health）           │
└─────────────────────────────────────────┘
         │
         ├─→ ┌──────────────────────────┐
         │   │ browserInstance.js        │
         │   │ (子进程 1)               │
         │   │ - 启动浏览器             │
         │   │ - 加载 Cookie            │
         │   │ - 导航到目标 URL         │
         │   │ - 启动保活循环           │
         │   └──────────────────────────┘
         │
         └─→ ┌──────────────────────────┐
             │ browserInstance.js        │
             │ (子进程 2)               │
             │ - (同上)                 │
             └──────────────────────────┘

每个子进程内部:
┌──────────────────────────────────┐
│  保活循环 (startKeepAliveLoop)    │
├──────────────────────────────────┤
│ 1. dismissInteractionModal()      │
│    - 移除遮罩层                   │
│ 2. clickInIframe()               │
│    - 在 iframe 内随机点击        │
│ 3. getWsStatus()                 │
│    - 获取 WS 状态                │
│ 4. reconnectWs() (if needed)     │
│    - 点击 Disconnect + Connect   │
│ 5. 等待 10 秒                    │
│ 6. 循环                          │
└──────────────────────────────────┘
```

## 修复记录

见 [FIXES.md](./FIXES.md) 了解所有已修复的问题和改进。

## 与其他项目的兼容性

详见 [COMPATIBILITY_ANALYSIS.md](../COMPATIBILITY_ANALYSIS.md)

- ✓ 与 AIStudioBuildWS 80% 兼容
- ✗ 与 ais2api-original 50% 兼容（架构不同，但 Cookie 验证已对齐）

## 许可证

基于 Ellinav/ais2api 的开源项目。

## 支持

- 提交问题或建议时，请包含完整的错误日志
- 检查日志中的 `[诊断]` 信息帮助排查问题
- 查看 `.env.example` 确保所有必需的环境变量已设置
