/** 拼接 PCM16LE 跨分片的半个采样，避免奇数字节造成噪声。 */
export class Pcm16Decoder {
  /** 上一个分片剩余的低字节。 */
  private remainder: number | null = null;

  /** 将任意字节边界的 PCM 转换为浏览器浮点采样。 */
  decode(bytes: Uint8Array): Float32Array {
    const length = bytes.length + (this.remainder === null ? 0 : 1);
    const joined = new Uint8Array(length);
    let offset = 0;
    if (this.remainder !== null) joined[offset++] = this.remainder;
    joined.set(bytes, offset);
    const samples = new Float32Array(Math.floor(length / 2));
    const view = new DataView(joined.buffer);
    for (let index = 0; index < samples.length; index++) samples[index] = view.getInt16(index * 2, true) / 32768;
    this.remainder = length % 2 ? joined[length - 1] : null;
    return samples;
  }

  /** 流结束时不允许留下不完整采样。 */
  finish(): void {
    if (this.remainder !== null) throw new Error("云端音频采样不完整");
  }
}

/** 创建统一取消错误，调用方可将主动停止与播放故障区分。 */
export function speechAbortError(): DOMException {
  return new DOMException("朗读已停止", "AbortError");
}

/** 按原始采样率播放 PCM；最多提前缓冲约三秒音频。 */
export class PcmStreamPlayer {
  /** Web Audio 上下文必须在用户点击时创建和恢复。 */
  private readonly context: AudioContext;
  /** 仅控制本地音量，不改变合成语速或声调。 */
  private readonly gain: GainNode;
  /** 采样边界拼接器。 */
  private readonly decoder = new Pcm16Decoder();
  /** 尚未播放结束的音频节点。 */
  private readonly sources = new Set<AudioBufferSourceNode>();
  /** 用户激活后的音频上下文恢复结果。 */
  private readonly ready: Promise<void>;
  /** 下一段音频计划开始的上下文时间。 */
  private nextTime = 0;
  /** 首段实际计划开始时间。 */
  private firstTime: number | null = null;
  /** 主动停止标识，保护异步等待期间的切换。 */
  private stopped = false;

  /** 在点击手势内恢复音频上下文，网络请求稍后才开始。 */
  constructor(volume = 1, context?: AudioContext) {
    this.context = context ?? new AudioContext();
    this.gain = this.context.createGain();
    this.gain.gain.value = Math.max(0, Math.min(1, volume));
    this.gain.connect(this.context.destination);
    this.ready = this.context.resume();
    // 提前挂接处理器，等待云端首帧期间也不会产生未处理拒绝。
    void this.ready.catch(() => undefined);
  }

  /** 只有播放时钟真正越过首段开始点才视为已经播出。 */
  get hasStarted(): boolean {
    return this.firstTime !== null && this.context.currentTime >= this.firstTime;
  }

  /** 解码后按顺序调度一帧，队列已满时让生产者等待。 */
  async enqueue(bytes: Uint8Array): Promise<void> {
    if (bytes.byteLength > 48_000) throw new Error("语音分片过大");
    await this.ready;
    this.assertActive();
    const samples = this.decoder.decode(bytes);
    if (!samples.length) return;
    while (this.nextTime - this.context.currentTime > 2.5) await this.tick();
    this.assertActive();
    const buffer = this.context.createBuffer(1, samples.length, 24_000);
    buffer.getChannelData(0).set(samples);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    const start = Math.max(this.context.currentTime + 0.04, this.nextTime);
    this.nextTime = start + buffer.duration;
    this.firstTime ??= start;
    this.sources.add(source);
    /** 节点播放结束后及时断开，释放已经消费的音频内存。 */
    source.onended = () => { this.sources.delete(source); source.disconnect(); };
    source.start(start);
  }

  /** 等待已排队音频真正播放完，网络 done 不能提前清空 UI。 */
  async finish(): Promise<void> {
    this.decoder.finish();
    while (this.sources.size) await this.tick();
    this.assertActive();
    this.gain.disconnect();
    await this.context.close();
  }

  /** 立即停止已排队音频；等待中的 enqueue/finish 会发现取消。 */
  cancel(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* 节点可能已经结束。 */ }
      source.disconnect();
    }
    this.sources.clear();
    this.gain.disconnect();
    void this.context.close().catch(() => undefined);
  }

  /** 每次异步边界后确认会话仍然有效。 */
  private assertActive(): void {
    if (this.stopped) throw speechAbortError();
  }

  /** 小间隔让出事件循环，以便停止与新文本立即生效。 */
  private async tick(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    this.assertActive();
  }
}

/** 在分配大数组前限制 Base64 帧长度。 */
export function decodeAudioFrame(data: string): Uint8Array {
  if (data.length > 64_000) throw new Error("语音分片过大");
  const decoded = atob(data);
  return Uint8Array.from(decoded, (value) => value.charCodeAt(0));
}
