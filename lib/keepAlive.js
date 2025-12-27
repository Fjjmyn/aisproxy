/**
 * keepAlive.js - 保活功能
 * 
 * 功能：
 * - 在 iframe 内随机点击保活
 * - 处理弹窗
 * - 监控 WS 状态并自动重连
 */

const { getWsStatus, reconnectWs, dismissInteractionModal } = require('./iframeHelper');

/**
 * 在 iframe 内随机点击
 * @param {Page} page - Playwright 页面对象
 * @param {Object} logger - 日志对象
 * @returns {Promise<boolean>} 是否成功点击
 */
async function clickInIframe(page, logger = null) {
  try {
    const iframe = page.locator('iframe[title="Preview"]');
    
    if (await iframe.count() === 0) {
      if (logger) logger.warn('未找到 Preview iframe');
      return false;
    }
    
    const iframeBox = await iframe.first().boundingBox();
    if (!iframeBox) {
      if (logger) logger.warn('无法获取 iframe 边界');
      return false;
    }
    
    // 安全区域：避开顶部 80 像素和右侧 200 像素
    const safeLeft = iframeBox.x + 50;
    const safeRight = iframeBox.x + iframeBox.width - 200;
    const safeTop = iframeBox.y + 80;
    const safeBottom = iframeBox.y + iframeBox.height - 50;
    
    if (safeRight <= safeLeft || safeBottom <= safeTop) {
      if (logger) logger.warn('iframe 安全区域太小');
      return false;
    }
    
    // 随机生成初始点击位置
    let currX = Math.floor(Math.random() * (safeRight - safeLeft) + safeLeft);
    let currY = Math.floor(Math.random() * (safeBottom - safeTop) + safeTop);
    
    // 随机移动几步
    const steps = Math.floor(Math.random() * 4) + 3;
    for (let i = 0; i < steps; i++) {
      const deltaX = Math.random() * 60 - 30;
      const deltaY = Math.random() * 40 - 20;
      
      currX = Math.max(safeLeft, Math.min(safeRight, currX + deltaX));
      currY = Math.max(safeTop, Math.min(safeBottom, currY + deltaY));
      
      await page.mouse.move(currX, currY);
      await page.waitForTimeout(50);
    }
    
    // 点击
    await page.mouse.click(currX, currY);
    if (logger) logger.debug(`在 iframe 内点击 (${currX}, ${currY})`);
    
    return true;
  } catch (e) {
    if (logger) logger.warn(`在 iframe 内点击失败: ${e.message}`);
    return false;
  }
}

/**
 * 处理弹窗
 * @param {Page} page - Playwright 页面对象
 * @param {Object} logger - 日志对象
 * @returns {Promise<boolean>} 是否处理了弹窗
 */
async function handlePopupDialog(page, logger = null) {
  const buttonNames = ['Got it', 'Continue to the app'];
  let totalClicks = 0;
  
  for (let iteration = 0; iteration < 10; iteration++) {
    let clickedInRound = false;
    await page.waitForTimeout(1000);
    
    for (const buttonName of buttonNames) {
      try {
        const buttonLocator = page.locator(`button:has-text("${buttonName}")`).visible();
        
        if (await buttonLocator.count() > 0 && await buttonLocator.first().isVisible({ timeout: 100 })) {
          await buttonLocator.first().click({ force: true, timeout: 2000 });
          totalClicks++;
          clickedInRound = true;
          
          if (logger) logger.info(`点击了弹窗按钮: ${buttonName}`);
          await page.waitForTimeout(1000);
        }
      } catch (e) {
        // 忽略错误，继续尝试其他按钮
      }
    }
    
    if (!clickedInRound) break;
  }
  
  return totalClicks > 0;
}

/**
 * 保活循环
 * @param {Page} page - Playwright 页面对象
 * @param {Object} logger - 日志对象
 * @param {Object} shutdownEvent - 关闭事件对象
 * @returns {Promise<void>}
 */
async function startKeepAliveLoop(page, logger, shutdownEvent = null) {
  let lastWsStatus = await getWsStatus(page, logger);
  logger.info(`初始 WS 状态: ${lastWsStatus}`);
  
  let clickCounter = 0;
  
  // 安全的关闭检查
  const shouldShutdown = () => {
    return shutdownEvent && typeof shutdownEvent.isSet === 'function' && shutdownEvent.isSet();
  };
  
  while (!shouldShutdown()) {
    try {
      // 关闭 interaction-modal 遮罩层
      await dismissInteractionModal(page, logger);
      
      // 在 iframe 内随机点击保活
      await clickInIframe(page, logger);
      clickCounter++;
      
      if (clickCounter % 10 === 0) {
        logger.debug(`已执行 ${clickCounter} 次保活点击`);
      }
      
      // 检查 WS 状态
      const currentWsStatus = await getWsStatus(page, logger);
      
      if (currentWsStatus !== lastWsStatus) {
        logger.warn(`WS 状态变更: ${lastWsStatus} -> ${currentWsStatus}`);
        
        if (currentWsStatus !== 'CONNECTED') {
          logger.info('WS 断开，尝试重连...');
          await reconnectWs(page, logger);
          lastWsStatus = await getWsStatus(page, logger);
          logger.info(`重连后 WS 状态: ${lastWsStatus}`);
        }
        
        lastWsStatus = currentWsStatus;
      }
      
      // 每 360 次点击（约 1 小时）执行一次 Cookie 验证
      if (clickCounter >= 360) {
        logger.info('执行 Cookie 验证...');
        // TODO: 添加 Cookie 验证逻辑
        clickCounter = 0;
      }
      
      // 等待 10 秒（每秒检查一次关闭信号）
      for (let i = 0; i < 10; i++) {
        if (shouldShutdown()) {
          logger.info('收到关闭信号，正在优雅退出保活循环...');
          return;
        }
        await page.waitForTimeout(1000);
      }
    } catch (e) {
      logger.error(`保活循环出错: ${e.message}`);
      throw e;
    }
  }
}

module.exports = {
  clickInIframe,
  handlePopupDialog,
  startKeepAliveLoop
};