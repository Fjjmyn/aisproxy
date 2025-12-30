/**
 * processManager.js - 进程管理器
 * 
 * 功能：
 * - 管理多个浏览器进程
 * - 添加/移除进程
 * - 获取活跃进程数量
 * - 终止所有进程
 */

const { spawn } = require('child_process');
const path = require('path');

/**
 * 进程管理器类
 */
class ProcessManager {
  constructor(logger) {
    this.processes = new Map();
    this.logger = logger || console;
  }
  
  /**
   * 添加进程
   * @param {ChildProcess} process - 子进程对象
   * @param {Object} config - 配置对象
   */
  addProcess(process, config) {
    const pid = process.pid;
    this.processes.set(pid, {
      process,
      config,
      pid,
      startTime: Date.now()
    });
    this.logger.info(`添加进程 #${pid}`);
  }
  
  /**
   * 移除进程
   * @param {number} pid - 进程 ID
   */
  removeProcess(pid) {
    if (this.processes.has(pid)) {
      this.processes.delete(pid);
      this.logger.info(`移除进程 #${pid}`);
    }
  }
  
  /**
   * 获取活跃的进程
   * @returns {Array<ChildProcess>} 活跃的进程数组
   */
  getAliveProcesses() {
    const alive = [];
    const deadPids = [];
    
    for (const [pid, info] of this.processes) {
      try {
        if (info.process && !info.process.killed) {
          alive.push(info.process);
        } else {
          deadPids.push(pid);
        }
      } catch (e) {
        deadPids.push(pid);
      }
    }
    
    // 清理死进程
    for (const pid of deadPids) {
      this.removeProcess(pid);
    }
    
    return alive;
  }
  
  /**
   * 获取活跃进程数量
   * @returns {number} 活跃进程数量
   */
  getAliveCount() {
    return this.getAliveProcesses().length;
  }
  
  /**
   * 获取总进程数量
   * @returns {number} 总进程数量
   */
  getCount() {
    return this.processes.size;
  }
  
  /**
   * 获取进程信息
   * @returns {Array<Object>} 进程信息数组
   */
  getProcessInfo() {
    const info = [];
    
    for (const [pid, data] of this.processes) {
      const isAlive = data.process && !data.process.killed;
      const uptime = Date.now() - data.startTime;
      
      info.push({
        pid,
        display_name: data.config.authSource.display_name,
        is_alive: isAlive,
        uptime: Math.floor(uptime / 1000), // 秒
        uptime_formatted: formatUptime(uptime)
      });
    }
    
    return info;
  }
  
  /**
   * 终止所有进程
   * P2-1: 改进僵尸进程泄漏处理 - 增加等待时间和 Windows 支持
   * @param {number} timeout - 超时时间（毫秒）
   * @returns {Promise<void>}
   */
  async terminateAll(timeout = 30000) {
    if (this.processes.size === 0) {
      this.logger.info('没有活跃的进程需要关闭');
      return;
    }
    
    const isWindows = process.platform === 'win32';
    this.logger.info(`开始关闭 ${this.processes.size} 个进程... (平台: ${process.platform})`);
    
    // 第一阶段：发送 SIGTERM
    const pidsToMonitor = [];
    for (const [pid, info] of this.processes) {
      try {
        if (info.process && !info.process.killed) {
          this.logger.info(`发送 SIGTERM 给进程 #${pid}`);
          info.process.kill('SIGTERM');
          pidsToMonitor.push(pid);
        }
      } catch (e) {
        this.logger.warn(`发送 SIGTERM 失败: ${e.message}`);
      }
    }
    
    // 第二阶段：等待 30 秒让进程优雅关闭
    this.logger.info('等待 30 秒让进程优雅关闭...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    // 第三阶段：强制杀死仍在运行的进程
    for (const [pid, info] of this.processes) {
      try {
        if (info.process && !info.process.killed) {
          this.logger.warn(`进程 #${pid} 未响应 SIGTERM，执行强制终止`);
          
          if (isWindows) {
            // Windows 平台：使用 taskkill 确保子进程被杀死
            const { execSync } = require('child_process');
            try {
              execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
              this.logger.info(`[Windows] taskkill 已针对进程 #${pid} 及其子进程执行`);
            } catch (e) {
              // taskkill 可能自己就报错，继续用 SIGKILL
              info.process.kill('SIGKILL');
            }
          } else {
            // Unix/Linux：直接使用 SIGKILL
            info.process.kill('SIGKILL');
          }
        }
      } catch (e) {
        this.logger.warn(`强制终止失败: ${e.message}`);
      }
    }
    
    // 第四阶段：最后等待 5 秒确保子进程被杀死
    this.logger.info('等待 5 秒确保所有子进程被清理...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    this.processes.clear();
    this.logger.info('所有进程关闭完成');
  }
  
  /**
   * 启动浏览器实例进程
   * @param {Object} config - 配置对象
   * @returns {ChildProcess} 子进程对象
   */
  spawnBrowserInstance(config) {
    const instanceLabel = config.authSource.display_name;
    
    this.logger.info(`启动浏览器实例进程: ${instanceLabel}`);
    
    const childProcess = spawn('node', [
      path.join(__dirname, 'browserInstance.js'),
      JSON.stringify(config)
    ], {
      stdio: 'inherit',
      env: { ...process.env, SHUTDOWN_SIGNAL: 'false' }
    });
    
    // 监听进程退出事件
    childProcess.on('exit', (code, signal) => {
      this.logger.info(`进程 #${childProcess.pid} 退出 (code: ${code}, signal: ${signal})`);
      this.removeProcess(childProcess.pid);
    });
    
    childProcess.on('error', (err) => {
      this.logger.error(`进程 #${childProcess.pid} 错误: ${err.message}`);
      this.removeProcess(childProcess.pid);
    });
    
    this.addProcess(childProcess, config);
    
    return childProcess;
  }
}

/**
 * 格式化运行时间
 * @param {number} milliseconds - 毫秒数
 * @returns {string} 格式化的时间字符串
 */
function formatUptime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

module.exports = {
  ProcessManager
};