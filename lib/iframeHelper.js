/**
 * iframeHelper.js - iframe 监控功能
 * 
 * 功能：
 * - 获取 Preview iframe
 * - 获取 WS 状态（CONNECTED/IDLE/CONNECTING）
 * - 点击 Connect/Disconnect 按钮
 * - 重连 WS
 * - 关闭 interaction-modal 遮罩层
 * - 诊断 iframe 内容（用于调试）
 */

const fs = require('fs');
const path = require('path');

/**
 * P2-2: Timeout 配置统一管理
 * 所有超时值在此定义，便于后续调整
 */
const TIMEOUT_CONFIG = {
  IFRAME_VISIBILITY: 1000,      // iframe 可见性检查
  ELEMENT_VISIBILITY: 3000,     // 按钮等元素可见性检查
  WS_STATUS_VISIBILITY: 5000,   // WS 状态文本可见性检查
  ACTION_CLICK: 5000,           // 点击操作
  MODAL_CHECK: 500,             // 遮罩层检查
  MOUSE_MOVE: 50,               // 鼠标移动间隔
  WAIT_BETWEEN_ACTIONS: 2000,   // 操作间隔
  WAIT_RETRY: 1000,             // 重试等待
  WAIT_MODAL: 3000,             // 遮罩层关闭等待
};

/**
 * 获取 Preview iframe
 * @param {Page} page - Playwright 页面对象
 * @returns {FrameLocator} iframe 的 FrameLocator
 */
async function getPreviewFrame(page) {
  return page.frameLocator('iframe[title="Preview"]');
}

/**
 * 获取 WS 状态
 * P0-3: 添加 iframe 可见性检查，避免选择器失效
 * @param {Page} page - Playwright 页面对象
 * @param {Object} logger - 日志对象
 * @returns {Promise<string>} WS 状态（CONNECTED/IDLE/CONNECTING/UNKNOWN）
 */
async function getWsStatus(page, logger = null) {
  try {
    // P0-3: 先检查 iframe 是否存在和可见
    const iframeLocator = page.locator('iframe[title="Preview"]');
    const iframeCount = await iframeLocator.count();
    
    if (iframeCount === 0) {
      if (logger) logger.warn('Preview iframe 不存在，无法获取 WS 状态');
      return 'UNKNOWN';
    }
    
    // P0-3: 检查 iframe 是否可见
    const iframeVisible = await iframeLocator.first().isVisible({ timeout: TIMEOUT_CONFIG.IFRAME_VISIBILITY }).catch(() => false);
    if (!iframeVisible) {
      if (logger) logger.warn('Preview iframe 不可见，无法获取 WS 状态');
      return 'UNKNOWN';
    }
    
    const frame = await getPreviewFrame(page);
    const statusElement = frame.getByText(/WS:\s*(CONNECTED|IDLE|CONNECTING)/i).first();
    
    // 增加超时时间从 3 秒到 5 秒，应对 iframe 内容加载缓慢的情况
    if (await statusElement.isVisible({ timeout: TIMEOUT_CONFIG.WS_STATUS_VISIBILITY })) {
      const text = await statusElement.textContent();
      if (text && text.toUpperCase().includes('CONNECTED')) {
        return 'CONNECTED';
      }
      if (text && text.toUpperCase().includes('IDLE')) {
        return 'IDLE';
      }
      if (text && text.toUpperCase().includes('CONNECTING')) {
        return 'CONNECTING';
      }
    } else {
      if (logger) logger.warn('WS 状态元素不可见，可能 UI 已更改');
    }
  } catch (e) {
    if (logger) logger.warn(`获取 WS 状态失败: ${e.message}`);
  }
  return 'UNKNOWN';
}

/**
 * 点击 Disconnect 按钮
 * @param {Page} page - Playwright 页面对象
 * @param {Object} logger - 日志对象
 * @returns {Promise<boolean>} 是否成功点击
 */
async function clickDisconnect(page, logger = null) {
  try {
    const frame = await getPreviewFrame(page);
    const disconnectBtn = frame.locator('button:has-text("Disconnect")');
    
    if (await disconnectBtn.count() > 0 && await disconnectBtn.first().isVisible({ timeout: TIMEOUT_CONFIG.ELEMENT_VISIBILITY })) {
      await disconnectBtn.first().click({ timeout: TIMEOUT_CONFIG.ACTION_CLICK });
      if (logger) logger.info('已点击 Disconnect 按钮');
      return true;
    }
  } catch (e) {
    if (logger) logger.warn(`点击 Disconnect 按钮失败: ${e.message}`);
  }
  return false;
}

/**
 * 点击 Connect 按钮
 * @param {Page} page - Playwright 页面对象
 * @param {Object} logger - 日志对象
 * @returns {Promise<boolean>} 是否成功点击
 */
async function clickConnect(page, logger = null) {
  try {
    const frame = await getPreviewFrame(page);
    const connectBtn = frame.locator('button:has-text("Connect")');
    
    if (await connectBtn.count() > 0 && await connectBtn.first().isVisible({ timeout: TIMEOUT_CONFIG.ELEMENT_VISIBILITY })) {
      await connectBtn.first().click({ timeout: TIMEOUT_CONFIG.ACTION_CLICK });
      if (logger) logger.info('已点击 Connect 按钮');
      return true;
    }
  } catch (e) {
    if (logger) logger.warn(`点击 Connect 按钮失败: ${e.message}`);
  }
  return false;
}

/**
 * 等待 WS 连接成功（采用 AIStudioBuildWS 的方案）
 * @param {Page} page - Playwright 页面对象
 * @param {Object} logger - 日志对象
 * @param {number} timeout - 最大等待时间（秒）
 * @returns {Promise<boolean>} 是否成功连接
 */
async function waitForWsConnected(page, logger = null, timeout = 15) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout * 1000) {
    const status = await getWsStatus(page, logger);
    if (status === 'CONNECTED') {
      return true;
    }
    await page.waitForTimeout(TIMEOUT_CONFIG.WAIT_RETRY);
  }
  return false;
}

/**
 * 重连 WS
 * P1-4: 添加重试机制 + 对标 AIStudioBuildWS 的 wait_for_ws_connected() 机制
 * @param {Page} page - Playwright 页面对象
 * @param {Object} logger - 日志对象
 * @param {number} maxRetries - 最大重试次数
 * @returns {Promise<string>} 重连后的 WS 状态
 */
async function reconnectWs(page, logger = null, maxRetries = 3) {
  if (logger) logger.info('开始重连 WS...');
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 先关闭遮罩层（采用 AIStudioBuildWS 方案）
      await dismissInteractionModal(page, logger);
      
      // 点击 Disconnect
      const disconnected = await clickDisconnect(page, logger);
      if (!disconnected && attempt < maxRetries) {
        if (logger) logger.warn(`尝试 ${attempt} 断开失败，重试...`);
        await page.waitForTimeout(TIMEOUT_CONFIG.WAIT_BETWEEN_ACTIONS);
        continue;
      }
      
      await page.waitForTimeout(TIMEOUT_CONFIG.WAIT_BETWEEN_ACTIONS);
      
      // 检查是否变为 IDLE
      const disconnectStatus = await getWsStatus(page, logger);
      if (logger) logger.info(`断开后 WS 状态: ${disconnectStatus}`);
      
      // 点击 Connect
      const connected = await clickConnect(page, logger);
      if (!connected && attempt < maxRetries) {
        if (logger) logger.warn(`尝试 ${attempt} 连接失败，重试...`);
        await page.waitForTimeout(TIMEOUT_CONFIG.WAIT_BETWEEN_ACTIONS);
        continue;
      }
      
      await page.waitForTimeout(TIMEOUT_CONFIG.WAIT_BETWEEN_ACTIONS);
      
      // ⭐ 关键修复：等待 WS 连接成功（最长 15 秒）
      // 这是 AIStudioBuildWS 拥有而 ais2api-main 缺失的机制
      if (await waitForWsConnected(page, logger, 15)) {
        const status = await getWsStatus(page, logger);
        if (logger) logger.info(`重连成功，WS 状态: ${status}`);
        return status;
      } else {
        const status = await getWsStatus(page, logger);
        if (logger) logger.warn(`第 ${attempt} 次重连超时，当前状态: ${status}`);
        if (attempt < maxRetries) {
          await page.waitForTimeout(TIMEOUT_CONFIG.WAIT_BETWEEN_ACTIONS);
        }
        }
        } catch (e) {
        if (logger) logger.warn(`第 ${attempt} 次重连异常: ${e.message}`);
        if (attempt < maxRetries) {
        await page.waitForTimeout(TIMEOUT_CONFIG.WAIT_MODAL);
        }
    }
  }
  
  if (logger) logger.error(`重连失败，经过 ${maxRetries} 次尝试`);
  return 'UNKNOWN';
}

/**
 * 关闭 interaction-modal 遮罩层
 * 通过在 iframe 区域内模拟鼠标移动来触发遮罩层关闭
 * @param {Page} page - Playwright 页面对象
 * @param {Object} logger - 日志对象
 * @returns {Promise<boolean>} 是否成功关闭
 */
async function dismissInteractionModal(page, logger = null) {
  try {
    const modal = page.locator('div.interaction-modal');
    
    // 检查是否存在遮罩层
    if (await modal.count() === 0 || !await modal.first().isVisible({ timeout: TIMEOUT_CONFIG.MODAL_CHECK })) {
      return false;
    }
    
    if (logger) logger.info('检测到 interaction-modal 遮罩层，尝试关闭...');
    
    const iframe = page.locator('iframe[title="Preview"]');
    const iframeBox = await iframe.first().boundingBox();
    
    if (!iframeBox) {
      if (logger) logger.warn('无法获取 iframe 边界');
      return false;
    }
    
    // 在 iframe 区域内随机移动鼠标 30 次
    let currX = iframeBox.x + 50;
    let currY = iframeBox.y + 50;
    
    for (let i = 0; i < 30; i++) {
      const deltaX = Math.random() * 60 - 30;
      const deltaY = Math.random() * 40 - 20;
      
      currX = Math.max(iframeBox.x + 20, Math.min(iframeBox.x + iframeBox.width - 20, currX + deltaX));
      currY = Math.max(iframeBox.y + 20, Math.min(iframeBox.y + iframeBox.height - 20, currY + deltaY));
      
      await page.mouse.move(currX, currY);
      await page.waitForTimeout(TIMEOUT_CONFIG.MOUSE_MOVE);
      
      // 检查遮罩层是否已关闭
      if (await modal.count() === 0 || !await modal.first().isVisible({ timeout: TIMEOUT_CONFIG.MODAL_CHECK })) {
        if (logger) logger.info('interaction-modal 遮罩层已关闭');
        return true;
      }
    }
    
    if (logger) logger.warn('无法关闭 interaction-modal 遮罩层');
  } catch (e) {
    if (logger) logger.warn(`关闭 interaction-modal 失败: ${e.message}`);
  }
  
  return false;
}

/**
 * 诊断 iframe 内容
 * 定期输出 iframe 内的文本内容，用于检测错误或异常
 * @param {Page} page - Playwright 页面对象
 * @param {Object} logger - 日志对象
 * @returns {Promise<void>}
 */
async function diagnosticIframeContent(page, logger = null) {
  try {
    const iframeLocator = page.locator('iframe[title="Preview"]');
    const iframeCount = await iframeLocator.count();
    
    if (iframeCount === 0) {
      if (logger) logger.warn('[诊断] Preview iframe 不存在');
      return;
    }
    
    const frame = await getPreviewFrame(page);
    // 修复：使用 evaluate 获取 iframe 内文本，而非直接调用 frame.textContent()
    const content = await frame.evaluate(() => document.body.textContent).catch(() => null);
    
    if (!content) {
      if (logger) logger.warn('[诊断] 无法获取 iframe 文本内容');
      return;
    }
    
    // 截取前 300 字符用于日志
    const preview = content.substring(0, 300).replace(/\n/g, ' ').trim();
    if (logger) logger.debug(`[诊断] iframe 内容: ${preview}`);
    
    // 检查是否有常见错误提示
    if (content.toLowerCase().includes('error') || 
        content.toLowerCase().includes('failed') || 
        content.toLowerCase().includes('loading')) {
      if (logger) logger.warn(`[诊断] 检测到异常关键词在 iframe 内容中`);
    }
  } catch (e) {
    if (logger) logger.warn(`[诊断] 获取 iframe 内容失败: ${e.message}`);
  }
}

/**
 * 诊断信息输出（替代截图）
 * 当 iframe 消失或异常时输出完整诊断信息，而不是保存截图
 * @param {Page} page - Playwright 页面对象
 * @param {Object} logger - 日志对象
 * @param {string} reason - 诊断原因
 * @returns {Promise<void>}
 */
async function outputDiagnosticInfo(page, logger = null, reason = '诊断') {
  try {
    if (logger) logger.warn(`========== [${reason}] 诊断信息开始 ==========`);
    
    // 输出当前 URL
    const currentUrl = page.url();
    if (logger) logger.warn(`[诊断] 当前 URL: ${currentUrl}`);
    
    // 输出页面标题
    try {
      const title = await page.title();
      if (logger) logger.warn(`[诊断] 页面标题: "${title}"`);
    } catch (e) {
      if (logger) logger.warn(`[诊断] 无法获取页面标题: ${e.message}`);
    }
    
    // 输出 iframe 数量
    try {
      const iframeCount = await page.locator('iframe').count();
      if (logger) logger.warn(`[诊断] 页面内 iframe 总数: ${iframeCount}`);
      
      const previewIframes = await page.locator('iframe[title="Preview"]').count();
      if (logger) logger.warn(`[诊断] Preview iframe 数量: ${previewIframes}`);
    } catch (e) {
      if (logger) logger.warn(`[诊断] 无法获取 iframe 信息: ${e.message}`);
    }
    
    // 输出页面内容长度
    try {
      const content = await page.content();
      if (logger) logger.warn(`[诊断] 页面 HTML 内容长度: ${content.length} 字符`);
    } catch (e) {
      if (logger) logger.warn(`[诊断] 无法获取页面内容: ${e.message}`);
    }
    
    if (logger) logger.warn(`========== [${reason}] 诊断信息结束 ==========`);
  } catch (e) {
    if (logger) logger.error(`[诊断] 输出诊断信息失败: ${e.message}`);
  }
}

module.exports = {
  TIMEOUT_CONFIG,
  getPreviewFrame,
  getWsStatus,
  clickDisconnect,
  clickConnect,
  waitForWsConnected,
  reconnectWs,
  dismissInteractionModal,
  diagnosticIframeContent,
  outputDiagnosticInfo
};