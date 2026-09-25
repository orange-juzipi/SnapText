import { beforeEach, afterEach, expect, mock, test } from 'bun:test';
import { FakeAudioContext, settle } from './audio-fixture';
/** 测试 IPC 管道，实际 PCM 由真实播放器消费。 */
class TestChannel { /** 原生消息回调。 */ onmessage = (_message: any) => {}; }
/** 原生调用记录。 */
const commands: Array<{ command: string; args: any }> = [];
/** 系统朗读记录。 */
const utterances: any[] = [];
/** 跨窗口停止订阅。 */
let stopHandler: (event: any) => void;
/** 当前模拟流。 */
let stream: { sessionId: string; channel: TestChannel; resolve: () => void } | undefined;
/** 能力接口的可控异步结果。 */
let capabilities: () => Promise<any>;
/** 用可控响应模拟原生层，记录 ACK 和取消。 */
async function invoke(command: string, args: any = {}) {
  commands.push({ command, args });
  if (command === 'get_speech_capabilities') return capabilities();
  if (command === 'start_cloud_speech') return new Promise<void>((resolve) => { stream = { ...args, resolve }; });
}
mock.module('@tauri-apps/api/core', () => ({ isTauri: () => true, Channel: TestChannel }));
mock.module('@tauri-apps/api/event', () => ({ listen: async (_name: string, handler: any) => { stopHandler = handler; return () => {}; } }));
mock.module('@/lib/tauri', () => ({ tauriInvoke: invoke }));
/** 保存系统发音参数，不产生实际声音。 */
class Utterance { /** 待朗读文本。 */ text: string; /** 创建可检查对象。 */ constructor(text: string) { this.text = text; } }
/** 模拟词典音频。 */
class DictionaryAudio {
  /** 最近的音频实例。 */ static latest: DictionaryAudio;
  /** 结束事件。 */ onended?: (() => void) | null;
  /** 错误事件。 */ onerror?: (() => void) | null;
  /** 音量。 */ volume = 1;
  /** 取消标识。 */ stopped = false;
  /** 记录实例。 */ constructor(_url: string) { DictionaryAudio.latest = this; }
  /** 模拟开始播放。 */ async play() {}
  /** 模拟取消。 */ pause() { this.stopped = true; }
}
Object.assign(globalThis, {
  AudioContext: FakeAudioContext, SpeechSynthesisUtterance: Utterance, Audio: DictionaryAudio,
  window: { Audio: DictionaryAudio, SpeechSynthesisUtterance: Utterance, addEventListener() {}, speechSynthesis: { cancel() {}, getVoices: () => [], speak: (value: any) => utterances.push(value) } },
});
const { speakText, stopSpeech } = await import('../src/lib/speech');
/** 本地偏好中没有厂商凭据。 */
const config = { enabled: true, engine: 'snaptext_cloud' as const, rate: 1, volume: 1, english_accent: 'american', english_accents: ['american'], cloud_voice_by_lang: { en: 'Mia', zh_cn: '冰糖' }, local_ai: { endpoint: '', api_key: null, model: '', voice: '', response_format: 'wav' as const } };
/** 清理记录并恢复正常能力接口。 */
beforeEach(() => {
  commands.length = 0; utterances.length = 0; stream = undefined; FakeAudioContext.instances.length = 0;
  capabilities = async () => ({ enabled: true, languages: ['zh_cn', 'en'], max_chars_per_request: 2000, voices: [{ id: 'Mia', language: 'en' }], default_voices: { en: 'Mia' } });
});
/** 关闭剩余会话。 */
afterEach(() => { stopSpeech(); stream?.resolve(); });
/** 按顺序投递一条原生流事件。 */
async function send(event: object) {
  stream!.channel.onmessage({ session_id: stream!.sessionId, event: { request_id: 'cloud-fixture', ...event } });
  await settle();
}
/** 等待能力请求和所有权注册。 */
async function begin(options: Record<string, unknown> = {}) {
  const ready = speakText({ text: 'hello', lang: 'en', config, ...options });
  await settle();
  return { ready };
}
/** 首段触发播放和 ACK，done 仍需等待本地队列结束。 */
test('first audio starts and done waits for playback', async () => {
  let ended = 0;
  const { ready } = await begin({ onEnd: () => ended++ });
  await send({ type: 'meta', format: 'pcm16le', sample_rate: 24000, channels: 1 });
  await send({ type: 'audio', sequence: 0, data: 'AAAAAA==' });
  await ready;
  expect(commands.some((call) => call.command === 'acknowledge_speech')).toBe(true);
  await send({ type: 'done' });
  stream!.resolve();
  expect(ended).toBe(0);
  FakeAudioContext.instances[0].advance(1);
  await settle(50);
  expect(ended).toBe(1);
  expect(utterances.length).toBe(0);
});
/** 首帧前故障回退一次，主动停止忽略迟到失败。 */
test('early failure falls back but explicit stop never does', async () => {
  let notices = 0;
  capabilities = async () => { throw new Error('offline'); };
  await speakText({ text: 'hello', lang: 'en', config, onNotice: () => notices++ });
  expect(utterances.length).toBe(1); expect(notices).toBe(1);
  stopSpeech(); utterances.length = 0;
  let reject!: (error: Error) => void;
  capabilities = () => new Promise((_resolve, failure) => { reject = failure; });
  const pending = speakText({ text: 'next', lang: 'en', config, onNotice: () => notices++ });
  await settle(); stopSpeech(); reject(new Error('late failure'));
  await pending; await settle();
  expect(utterances.length).toBe(0); expect(notices).toBe(1);
});
/** 已发声后断流停止，不从头重读。 */
test('midstream failure stops without replay', async () => {
  let errors = 0;
  const { ready } = await begin({ onError: () => errors++ });
  await send({ type: 'meta', format: 'pcm16le', sample_rate: 24000, channels: 1 });
  await send({ type: 'audio', sequence: 0, data: 'AAAAAA==' });
  await ready;
  FakeAudioContext.instances[0].currentTime = 0.05;
  await send({ type: 'error', message: 'connection lost' });
  expect(errors).toBe(1); expect(utterances.length).toBe(0);
});
/** 旧帧和旧停止事件不能污染新会话，其他窗口夺权能取消当前音频。 */
test('rapid switches ignore stale data and respect cross-window ownership', async () => {
  const { ready: first } = await begin(); const old = stream!;
  stopSpeech(); await first;
  const { ready: second } = await begin({ text: 'second' });
  old.channel.onmessage({ session_id: old.sessionId, event: { type: 'error', request_id: 'old', message: 'late' } });
  stopHandler({ payload: { session_id: old.sessionId } });
  await send({ type: 'meta', format: 'pcm16le', sample_rate: 24000, channels: 1 });
  await send({ type: 'audio', sequence: 0, data: 'AAAAAA==' });
  await second;
  const current = FakeAudioContext.instances[1];
  expect(current.state).toBe('running');
  stopHandler({ payload: { session_id: stream!.sessionId } });
  expect(current.state).toBe('closed'); expect(utterances.length).toBe(0);
});
/** 词典音频优先，媒体错误才使用所选朗读引擎。 */
test('dictionary has priority and media errors fall back', async () => {
  await speakText({ text: 'hello', lang: 'en', config, audioUrl: 'fixture://audio' });
  expect(stream).toBeUndefined();
  DictionaryAudio.latest.onerror?.(); await settle();
  expect(stream).toBeDefined(); expect(DictionaryAudio.latest.stopped).toBe(true);
});
/** 未支持语言不触发付费请求。 */
test('unsupported language uses system', async () => {
  await speakText({ text: 'bonjour', lang: 'fr', config });
  expect(utterances[0].lang).toBe('fr-FR');
  expect(commands.some((call) => call.command === 'start_cloud_speech')).toBe(false);
});
