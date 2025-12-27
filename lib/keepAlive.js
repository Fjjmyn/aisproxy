/**
 * keepAlive.js - 保活功能
 * 
 * 功能：
 * - 在 iframe 内随机点击保活
 * - 处理弹窗
 * - 监控 WS 状态并自动重连
 */

const { getWsStatus, reconnectWs, dismissInteractionModal, diagnosticIframeContent, saveScreenshot } = require('./iframeHelper');

/**
 * 页面健康检查
 * P0-6: 检测页面是否白屏、崩溃或失效
 */
async function checkPageHealth(page, logger) {
  try {
    // 1. 检查页面内容是否存在且足够长
    const html = await page.content();
    if (!html || html.length < 1000) {
      if (logger) logger.warn('页面内容过短，可能是白屏');
      return false;
    }
    
    // 2. 检查是否还能执行 JavaScript
    const evalResult = await page.evaluate(() => {
      return document.body ? 'ok' : 'no-body';
    }).catch(() => null);
    
    if (!evalResult) {
      if (logger) logger.warn('页面无法执行 JavaScript，可能已崩溃');
      return false;
    }
    
    // 3. 检查 Preview iframe 是否还存在
    const iframeCount = await page.locator('iframe[title="Preview"]').count();
    if (iframeCount === 0) {
      if (logger) logger.warn('Preview iframe 丢失，页面可能已刷新或崩溃');
      return false;
    }
    
    return true;
  } catch (e) {
    if (logger) logger.warn(`页面健康检查异常: ${e.message}`);
    return false;
  }
}

/**
 * 被删除：不再使用点击保活
 * 原因：频繁点击可能触发 Google 的防爬机制
 * 使用 WS 状态监控替代，保活方式改为完全静默
 * 
 * 历史函数参考：clickInIframe()
 */

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
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 10; // P0-2: 允许最多 10 次连续错误
  let consecutiveUnhealthyChecks = 0;
  const maxConsecutiveUnhealthyChecks = 3; // P0-6: 允许最多 3 次连续不健康检查
  
  // 安全的关闭检查
  const shouldShutdown = () => {
    return shutdownEvent && typeof shutdownEvent.isSet === 'function' && shutdownEvent.isSet();
  };
  
  while (!shouldShutdown()) {
    try {
      // P0-6: 每 30 次点击（约 5 分钟）执行一次健康检查
      // 但在启动后前 60 次点击（约 10 分钟）内，不进行健康检查（iframe 可能还在加载）
      if (clickCounter % 30 === 0 && clickCounter > 60) {
        const isHealthy = await checkPageHealth(page, logger);
        if (!isHealthy) {
          consecutiveUnhealthyChecks++;
          logger.warn(`页面不健康 (${consecutiveUnhealthyChecks}/${maxConsecutiveUnhealthyChecks})`);
          
          if (consecutiveUnhealthyChecks >= maxConsecutiveUnhealthyChecks) {
            throw new Error('页面持续不健康，需要重启浏览器');
          }
        } else {
          consecutiveUnhealthyChecks = 0;
        }
      }
      
      // 关闭 interaction-modal 遮罩层
      await dismissInteractionModal(page, logger);
      
      // 不再使用点击保活，改为静默监控
      // 原因：频繁点击可能在 1m30s 时触发 Google 的防爬机制
      
      clickCounter++;
      
      // 每 60 次循环（10 分钟）定期输出诊断信息
      if (clickCounter % 60 === 0) {
        logger.info(`保活循环运行中 (${clickCounter * 10}s)...`);
        await diagnosticIframeContent(page, logger);
      }
      
      // 检查 WS 状态
      const currentWsStatus = await getWsStatus(page, logger);
      
      if (currentWsStatus !== lastWsStatus) {
        logger.warn(`WS 状态变更: ${lastWsStatus} -> ${currentWsStatus}`);
        
        // 如果 iframe 消失，在重连前先诊断
         if (currentWsStatus === 'UNKNOWN' && lastWsStatus === 'CONNECTED') {
           logger.warn('WS 状态变为 UNKNOWN，执行诊断...');
           await diagnosticIframeContent(page, logger);
           await saveScreenshot(page, logger, 'iframe-lost');
           
           // 给 Google 冷静 2 秒，可能只是临时卡顿
           logger.info('等待 2 秒后重新检查 WS 状态...');
           await page.waitForTimeout(2000);
           const recheckStatus = await getWsStatus(page, logger);
           
           if (recheckStatus === 'CONNECTED') {
             logger.info('重新检查后 WS 已恢复，继续保活');
             lastWsStatus = recheckStatus;
             continue; // 不触发重连，继续循环
           }
         }
        
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
        // TODO: 添加完整的 Cookie 验证逻辑（检查是否被重定向到登录页）
        clickCounter = 0;
      }
      
      // 重置错误计数（表示本轮成功）
      consecutiveErrors = 0;
      
      // 等待 10 秒（每秒检查一次关闭信号）
      for (let i = 0; i < 10; i++) {
        if (shouldShutdown()) {
          logger.info('收到关闭信号，正在优雅退出保活循环...');
          return;
        }
        await page.waitForTimeout(1000);
      }
    } catch (e) {
      // P0-2: 单次错误不直接抛出，记录并计数
      consecutiveErrors++;
      logger.warn(`保活循环出错 (${consecutiveErrors}/${maxConsecutiveErrors}): ${e.message}`);
      
      if (consecutiveErrors >= maxConsecutiveErrors) {
        logger.error(`连续出错 ${maxConsecutiveErrors} 次，停止保活`);
        throw e;
      }
      
      // 等待一段时间后继续（避免频繁重试）
      logger.info(`${2000}ms 后继续保活循环...`);
      await page.waitForTimeout(2000);
    }
  }
}

module.exports = {
  handlePopupDialog,
  startKeepAliveLoop,
  checkPageHealth
};