/** 不依赖声卡的音频上下文，测试显式推进时钟。 */
export class FakeAudioContext {
  /** 创建的上下文。 */ static instances: FakeAudioContext[] = [];
  /** 可控播放时钟。 */ currentTime = 0;
  /** 上下文状态。 */ state = 'running';
  /** 已调度节点。 */ sources: FakeSource[] = [];
  /** 输出占位符。 */ destination = {};
  /** 本地音量。 */ gain = { gain: { value: 1 }, /** 连接输出。 */ connect() {}, /** 清理输出。 */ disconnect() {} };
  /** 记录实例。 */ constructor() { FakeAudioContext.instances.push(this); }
  /** 模拟激活。 */ async resume() { this.state = 'running'; }
  /** 模拟释放。 */ async close() { this.state = 'closed'; }
  /** 返回音量节点。 */ createGain() { return this.gain; }
  /** 保持采样率并保存 PCM。 */
  createBuffer(_channels: number, length: number, rate: number) {
    const data = new Float32Array(length);
    return { duration: length / rate, /** 读取采样。 */ getChannelData: () => data };
  }
  /** 创建可检查的节点。 */ createBufferSource() { const source = new FakeSource(); this.sources.push(source); return source; }
  /** 推进时钟并触发结束事件。 */
  advance(seconds: number) {
    this.currentTime += seconds;
    for (const source of this.sources) {
      if (!source.ended && source.at + (source.buffer?.duration ?? 0) <= this.currentTime) { source.ended = true; source.onended?.(); }
    }
  }
}
/** 可观察的音频节点。 */
export class FakeSource {
  /** PCM 缓冲。 */ buffer?: { duration: number; getChannelData: () => Float32Array };
  /** 调度时间。 */ at = Infinity;
  /** 自然结束标识。 */ ended = false;
  /** 主动停止标识。 */ stopped = false;
  /** 结束回调。 */ onended: (() => void) | null = null;
  /** 模拟连接。 */ connect() {}
  /** 模拟清理。 */ disconnect() {}
  /** 记录调度。 */ start(at: number) { this.at = at; }
  /** 记录取消。 */ stop() { this.stopped = true; }
}
/** 执行异步回调和播放器短计时器。 */
export async function settle(ms = 30) { await new Promise((resolve) => setTimeout(resolve, ms)); }
