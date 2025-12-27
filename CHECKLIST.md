# ais2api-main 部署前检查清单

## ✅ 代码修复检查

- [x] Playwright API 修复（.first → .first()）
  - [x] lib/keepAlive.js: 27, 90, 91 行
  - [x] lib/iframeHelper.js: 30, 61, 62, 84, 85, 130, 137, 159 行

- [x] 选择器语法修复
  - [x] lib/keepAlive.js: `:visible:has-text()` → `.visible()`
  - [x] lib/iframeHelper.js: `text=/regex/` → `.getByText(/regex/)`

- [x] StorageState 完整性
  - [x] lib/browserInstance.js: 支持完整 storageState

- [x] 关闭事件安全性
  - [x] lib/keepAlive.js: 添加 `shouldShutdown()` 检查

- [x] 导航错误处理
  - [x] lib/browserInstance.js: try-catch 包装

- [x] Camoufox 路径修复
  - [x] lib/browserInstance.js: 使用 `__dirname + '..'`
  - [x] Dockerfile: 添加 `CAMOUFOX_EXECUTABLE_PATH` 环境变量

- [x] Cookie 验证完整性
  - [x] lib/browserInstance.js: 4 种检查（失效、地区、风控、白屏）

- [x] 日志增强
  - [x] unified-server.js: 详细的启动和监控日志

## 📋 文档检查

- [x] FIXES.md - 详细修复日志
- [x] COMPATIBILITY_ANALYSIS.md - 兼容性分析
- [x] README.md - 使用和故障排除指南
- [x] SUMMARY.md - 修复总结
- [x] CHECKLIST.md - 本文件

## 🔧 环境配置检查

- [ ] `.env` 文件已创建（从 `.env.example` 复制）
- [ ] `CAMOUFOX_INSTANCE_URL` 已设置
- [ ] `AUTH_JSON_1` 或 `auth/auth-1.json` 已设置
- [ ] （可选）`CAMOUFOX_PROXY` 如需代理
- [ ] （可选）`PORT` 如需自定义端口
- [ ] （可选）`CAMOUFOX_HEADLESS` 设置（默认 true）

## 🐳 Docker 构建检查

- [ ] Dockerfile 已正确配置 Camoufox 下载 URL
- [ ] Docker 镜像已成功构建
- [ ] `CAMOUFOX_EXECUTABLE_PATH` 环境变量在 Docker 中正确设置

## 📊 功能验证检查

### 基础功能
- [ ] 浏览器实例能否成功启动
- [ ] Cookie 是否正确加载
- [ ] 能否成功导航到目标 URL
- [ ] 能否处理初始弹窗

### 监控功能
- [ ] iframe 能否正确定位（`iframe[title="Preview"]`）
- [ ] WS 状态能否正确获取（CONNECTED/IDLE/CONNECTING）
- [ ] 点击 Connect/Disconnect 按钮能否正常工作

### 保活功能
- [ ] 定时点击保活是否正常执行（日志中看到 "已执行 N 次保活点击"）
- [ ] WS 状态变化时是否自动重连
- [ ] 日志中是否定期出现保活相关的信息

### 健康检查
- [ ] `/health` 端点能否访问
- [ ] 返回的进程信息是否正确
- [ ] 进程状态（is_alive）是否准确

## 🧪 边界情况测试

### Cookie 相关
- [ ] Cookie 有效时能否成功连接
- [ ] Cookie 失效时是否检测到并报错（检查日志）
- [ ] Cookie 中缺少必要字段时是否能正确报错

### 网络相关
- [ ] 网络正常时能否成功导航
- [ ] 目标 URL 无法访问时是否正确超时
- [ ] 代理配置是否能正常工作（如设置）

### IP 地址相关
- [ ] IP 被地区限制时是否正确检测（日志中看到相关错误信息）
- [ ] IP 被风控时是否正确检测（日志中看到 403 Forbidden）
- [ ] 是否能通过代理绕过限制

### iframe 相关
- [ ] Preview iframe 布局是否符合代码预期
- [ ] iframe 内的 WS 状态文本是否符合选择器 `/WS:\s*(CONNECTED|...)/i`
- [ ] Connect/Disconnect 按钮是否能被正确定位

## 📝 日志检查

### 启动日志
```
================ [ 启动浏览器实例 ] ================
将启动 X 个浏览器实例
...
[1/X] 进程 #XXXXX 已启动
```
- [ ] 日志中是否显示正确的实例数量
- [ ] 是否显示了正确的进程 ID

### 浏览器实例日志
```
[AUTH_JSON_X] INFO: 启动浏览器实例...
[AUTH_JSON_X] INFO: [诊断] 最终 URL: ...
[AUTH_JSON_X] INFO: [诊断] 页面标题: ...
[AUTH_JSON_X] INFO: 初始 WS 状态: CONNECTED
```
- [ ] 是否显示了诊断信息（URL 和页面标题）
- [ ] 是否正确识别了 WS 状态
- [ ] 是否没有错误日志

### 保活日志
```
[AUTH_JSON_X] DEBUG: 已执行 10 次保活点击
[AUTH_JSON_X] INFO: WS 状态变更: CONNECTED -> IDLE
[AUTH_JSON_X] INFO: WS 断开，尝试重连...
[AUTH_JSON_X] INFO: 重连后 WS 状态: CONNECTED
```
- [ ] 是否定期看到保活点击记录
- [ ] WS 状态变化时是否能成功重连

## 🚀 部署前的最终检查

- [ ] 代码无语法错误（运行 `npm install && node -c unified-server.js`）
- [ ] 所有依赖已安装
- [ ] Docker 镜像已成功构建并测试
- [ ] 日志中无 WARN 或 ERROR 记录（除非是已知的边界情况）
- [ ] 进程在 24 小时内保持稳定运行
- [ ] 没有出现意外的进程崩溃

## 📌 常见问题快速检查

| 问题 | 检查点 | 日志关键词 |
|------|--------|----------|
| 浏览器无法启动 | Camoufox 路径 | "executable doesn't exist" |
| Cookie 失效 | Cookie 有效期 | "Cookie 已失效" |
| 地区限制 | IP 地址支持 | "地区限制" |
| IP 风控 | IP 信誉 | "IP 风控" |
| WS 无法连接 | iframe 布局 | "WS 状态: UNKNOWN" |
| 进程崩溃 | 查看完整栈跟踪 | "ERROR" |

## ✅ 准备好部署了吗？

当以下项全部检查完成时，说明已准备好部署：

- [ ] 所有代码修复已完成
- [ ] 所有文档已准备好
- [ ] 环境配置已设置
- [ ] Docker 镜像已构建
- [ ] 功能验证已通过
- [ ] 边界情况已测试
- [ ] 日志输出正常
- [ ] 24 小时稳定性测试已通过

**如果所有项都打钩了，恭喜！可以部署到生产环境了。**

---

最后更新：2025-12-28
