/**
 * browserInstance.js - 浏览器实例管理
 *
 * 功能：
 * - 启动浏览器实例
 * - 加载 Cookie
 * - 导航到目标 URL
 * - 处理弹窗
 * - 启动保活循环
 */

const { firefox } = require('playwright');
const path = require('path');
const { handlePopupDialog, startKeepAliveLoop } = require('./keepAlive');

/**
 * 保活错误类
 */
class KeepAliveError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KeepAliveError';
  }
}

/**
 * 加载 Cookie
 * @param {Object} authSource - 认证源对象
 * @returns {Promise<Array>} Cookie 数组
 */
async function loadCookies(authSource) {
  // 尝试从多个位置获取 cookies（兼容不同的结构）
  let cookies = authSource.cookies;
  
  // 如果 authSource 中没有，尝试从 storageState 中获取
  if (!cookies && authSource.storageState && authSource.storageState.cookies) {
    cookies = authSource.storageState.cookies;
  }
  
  if (!cookies || !Array.isArray(cookies)) {
    console.error(`[${authSource.display_name}] 没有 Cookie 数据`);
    return [];
  }

  console.log(`[${authSource.display_name}] 加载 ${cookies.length} 个 Cookie`);
  return cookies;
}

/**
 * 运行浏览器实例
 * @param {Object} config - 配置对象
 * @param {Object} shutdownEvent - 关闭事件对象
 * @returns {Promise<void>}
 */
async function runBrowserInstance(config, shutdownEvent = null) {
  const { authSource, instanceUrl, headless = true, proxy } = config;
  
  const instanceLabel = authSource.display_name || 'Unknown';
  
  const logger = {
    info: (msg) => console.log(`[${instanceLabel}] INFO: ${msg}`),
    warn: (msg) => console.warn(`[${instanceLabel}] WARN: ${msg}`),
    error: (msg) => console.error(`[${instanceLabel}] ERROR: ${msg}`),
    debug: (msg) => console.log(`[${instanceLabel}] DEBUG: ${msg}`)
  };
  
  logger.info('启动浏览器实例...');
  
  // 加载 Cookie
  const cookies = await loadCookies(authSource);
  if (!cookies || cookies.length === 0) {
    logger.error('没有可用的 Cookie');
    return;
  }
  
  logger.info(`已加载 ${cookies.length} 个 Cookie`);
  
  // 启动浏览器（使用 Camoufox，原项目配置）
  const launchOptions = {
    headless: headless,
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--mute-audio',
      '--safebrowsing-disable-auto-update'
    ]
  };
  
  // Camoufox 可执行文件路径
  const platform = process.platform;
  let browserExecutablePath;
  
  // 优先使用环境变量配置
  if (process.env.CAMOUFOX_EXECUTABLE_PATH) {
    browserExecutablePath = process.env.CAMOUFOX_EXECUTABLE_PATH;
  } else if (platform === 'linux') {
    browserExecutablePath = path.join(__dirname, '..', 'camoufox-linux', 'camoufox');
  } else if (platform === 'win32') {
    browserExecutablePath = path.join(__dirname, '..', 'camoufox', 'camoufox.exe');
  } else {
    throw new Error(`Unsupported operating system: ${platform}`);
  }
  
  if (browserExecutablePath) {
    launchOptions.executablePath = browserExecutablePath;
    logger.info(`使用 Camoufox: ${browserExecutablePath}`);
  }
  
  if (proxy) {
    launchOptions.proxy = { server: proxy, bypass: 'localhost, 127.0.1' };
    logger.info(`使用代理: ${proxy}`);
  }
  
  let browser;
  let context;
  let page;
  
  try {
    logger.info('正在启动 Camoufox 浏览器...');
    browser = await firefox.launch(launchOptions);
    
    // 使用完整 storageState 参数加载浏览器状态（包含 cookies、localStorage、sessionStorage）
    const storageState = authSource.storageState || { cookies: cookies };
    context = await browser.newContext({
      storageState: storageState,
      viewport: { width: 1920, height: 1080 },
    });
    
    page = await context.newPage();
    
    // 导航到目标 URL
    logger.info(`正在导航到: ${instanceUrl}`);
    try {
      await page.goto(instanceUrl, { timeout: 90000, waitUntil: 'domcontentloaded' });
    } catch (e) {
      logger.error(`导航失败: ${e.message}`);
      throw new KeepAliveError(`无法导航到目标 URL: ${e.message}`);
    }
    
    // 完整的 Cookie 和导航验证（对标 ais2api-original）
    const finalUrl = page.url();
    let pageTitle = '';
    try {
      pageTitle = await page.title();
    } catch (e) {
      logger.warn(`获取页面标题失败: ${e.message}`);
    }
    
    logger.info(`[诊断] 最终 URL: ${finalUrl}`);
    logger.info(`[诊断] 页面标题: "${pageTitle}"`);
    
    // 1. 检查 Cookie 是否失效（跳转到登录页）
    if (
      finalUrl.includes('accounts.google.com') ||
      finalUrl.includes('ServiceLogin') ||
      pageTitle.includes('Sign in') ||
      pageTitle.includes('登录')
    ) {
      logger.error('Cookie 已失效/过期！浏览器被重定向到了 Google 登录页面。');
      throw new KeepAliveError('Cookie 已失效');
    }
    
    // 2. 检查 IP 地区限制
    if (
      pageTitle.includes('Available regions') ||
      pageTitle.includes('not available') ||
      pageTitle.includes('不可用')
    ) {
      logger.error('当前 IP 不支持访问 Google AI Studio（地区限制）');
      throw new KeepAliveError('地区限制');
    }
    
    // 3. 检查 IP 风控（403 Forbidden）
    if (pageTitle.includes('403') || pageTitle.includes('Forbidden')) {
      logger.error('当前 IP 信誉过低，被 Google 风控拒绝访问');
      throw new KeepAliveError('IP 风控');
    }
    
    // 4. 检查白屏（网络极差或加载失败）
    if (finalUrl === 'about:blank') {
      logger.error('页面加载失败 (about:blank)，可能是网络连接超时或浏览器崩溃');
      throw new KeepAliveError('页面加载失败');
    }
    
    logger.info(`成功导航到: ${finalUrl}`);
    
    // 等待页面加载完成
    await page.waitForTimeout(2000);
    
    // 处理弹窗
    logger.info('处理弹窗...');
    const handled = await handlePopupDialog(page, logger);
    if (handled) {
      logger.info('已处理弹窗');
    }
    
    // 启动保活循环
    logger.info('启动保活循环...');
    await startKeepAliveLoop(page, logger, shutdownEvent);
    
  } catch (e) {
    if (e instanceof KeepAliveError) {
      logger.error(`保活错误: ${e.message}`);
    } else {
      logger.error(`浏览器实例错误: ${e.message}`);
      logger.error(e.stack);
    }
  } finally {
    // 关闭浏览器
    if (page) {
      try {
        await page.close();
      } catch (e) {
        logger.warn(`关闭页面失败: ${e.message}`);
      }
    }
    
    if (context) {
      try {
        await context.close();
      } catch (e) {
        logger.warn(`关闭上下文失败: ${e.message}`);
      }
    }
    
    if (browser) {
      try {
        await browser.close();
        logger.info('浏览器实例已关闭');
      } catch (e) {
        logger.warn(`关闭浏览器失败: ${e.message}`);
      }
    }
  }
}

/**
 * 从命令行参数加载配置
 * @returns {Object} 配置对象
 */
function loadConfigFromArgs() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('错误: 缺少配置参数');
    process.exit(1);
  }
  
  try {
    const config = JSON.parse(args[0]);
    return config;
  } catch (e) {
    console.error('错误: 无法解析配置参数');
    console.error(e.message);
    process.exit(1);
  }
}

/**
 * 带重试机制的浏览器实例运行
 * P0-1: 浏览器崩溃后自动重启
 */
async function runBrowserInstanceWithRetry(config, shutdownEvent = null, maxRetries = 5) {
  const instanceLabel = config.authSource.display_name || 'Unknown';
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[${instanceLabel}] 第 ${attempt}/${maxRetries} 次启动尝试...`);
      await runBrowserInstance(config, shutdownEvent);
      // 如果主循环正常退出（例如收到关闭信号），则退出
      break;
    } catch (e) {
      if (attempt < maxRetries) {
        // 指数退避：第1次等5秒、第2次等10秒、第3次等15秒、第4次等20秒、第5次等25秒
        const delaySeconds = Math.min(30, 5 * attempt);
        console.log(`[${instanceLabel}] 第 ${attempt} 次启动失败: ${e.message}`);
        console.log(`[${instanceLabel}] ${delaySeconds} 秒后重试...`);
        await new Promise(r => setTimeout(r, delaySeconds * 1000));
      } else {
        console.error(`[${instanceLabel}] 经过 ${maxRetries} 次尝试仍未成功，进程退出`);
        throw e;
      }
    }
  }
}

// 如果作为独立进程运行
if (require.main === module) {
  const config = loadConfigFromArgs();
  const shutdownEvent = { isSet: () => false };
  
  // 监听关闭信号
  process.on('SIGTERM', () => {
    console.log(`[${config.authSource.display_name}] 接收到 SIGTERM 信号`);
    shutdownEvent.isSet = () => true;
  });
  
  process.on('SIGINT', () => {
    console.log(`[${config.authSource.display_name}] 接收到 SIGINT 信号`);
    shutdownEvent.isSet = () => true;
  });
  
  runBrowserInstanceWithRetry(config, shutdownEvent).catch(err => {
    console.error(`[${config.authSource.display_name}] 无法启动:`, err);
    process.exit(1);
  });
}

module.exports = {
  runBrowserInstance,
  runBrowserInstanceWithRetry,
  KeepAliveError
};