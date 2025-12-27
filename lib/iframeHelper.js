/**
 * iframeHelper.js - iframe 监控功能
 * 
 * 功能：
 * - 获取 Preview iframe
 * - 获取 WS 状态（CONNECTED/IDLE/CONNECTING）
 * - 点击 Connect/Disconnect 按钮
 * - 重连 WS
 * - 关闭 interaction-modal 遮罩层
 */

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
 * @param {Page} page - Playwright 页面对象
 * @param {Object} logger - 日志对象
 * @returns {Promise<string>} WS 状态（CONNECTED/IDLE/CONNECTING/UNKNOWN）
 */
async function getWsStatus(page, logger = null) {
  try {
    const frame = await getPreviewFrame(page);
    const statusElement = frame.locator('text=/WS:\s*(CONNECTED|IDLE|CONNECTING)/i').first;
    
    if (await statusElement.isVisible({ timeout: 3000 })) {
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
    
    if (await disconnectBtn.count() > 0 && await disconnectBtn.first.isVisible({ timeout: 3000 })) {
      await disconnectBtn.first.click({ timeout: 5000 });
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
    
    if (await connectBtn.count() > 0 && await connectBtn.first.isVisible({ timeout: 3000 })) {
      await connectBtn.first.click({ timeout: 5000 });
      if (logger) logger.info('已点击 Connect 按钮');
      return true;
    }
  } catch (e) {
    if (logger) logger.warn(`点击 Connect 按钮失败: ${e.message}`);
  }
  return false;
}

/**
 * 重连 WS
 * @param {Page} page - Playwright 页面对象
 * @param {Object} logger - 日志对象
 * @returns {Promise<string>} 重连后的 WS 状态
 */
async function reconnectWs(page, logger = null) {
  if (logger) logger.info('开始重连 WS...');
  
  // 点击 Disconnect
  await clickDisconnect(page, logger);
  await page.waitForTimeout(2000);
  
  // 点击 Connect
  await clickConnect(page, logger);
  await page.waitForTimeout(2000);
  
  // 获取新的 WS 状态
  const status = await getWsStatus(page, logger);
  if (logger) logger.info(`重连后 WS 状态: ${status}`);
  
  return status;
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
    if (await modal.count() === 0 || !await modal.first.isVisible({ timeout: 500 })) {
      return false;
    }
    
    if (logger) logger.info('检测到 interaction-modal 遮罩层，尝试关闭...');
    
    const iframe = page.locator('iframe[title="Preview"]');
    const iframeBox = await iframe.first.boundingBox();
    
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
      await page.waitForTimeout(50);
      
      // 检查遮罩层是否已关闭
      if (await modal.count() === 0 || !await modal.first.isVisible({ timeout: 100 })) {
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

module.exports = {
  getPreviewFrame,
  getWsStatus,
  clickDisconnect,
  clickConnect,
  reconnectWs,
  dismissInteractionModal
};