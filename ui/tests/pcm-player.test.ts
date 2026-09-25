import { expect, test } from 'bun:test';
import { Pcm16Decoder, PcmStreamPlayer } from '../src/lib/pcm-player';
import { FakeAudioContext, settle } from './audio-fixture';

/** 跨字节分片保持 PCM16LE 采样，拒绝尾部不完整采样。 */
test('joins split samples without altering pitch', () => {
  const decoder = new Pcm16Decoder();
  expect([...decoder.decode(new Uint8Array([0]))]).toEqual([]);
  expect([...decoder.decode(new Uint8Array([128, 255, 127, 0]))]).toEqual([-1, 32767 / 32768]);
  expect([...decoder.decode(new Uint8Array([0]))]).toEqual([0]);
  expect(() => decoder.finish()).not.toThrow();
  decoder.decode(new Uint8Array([1]));
  expect(() => decoder.finish()).toThrow('不完整');
});
/** 首段立即调度，done 等待声音播放完而非提前关闭上下文。 */
test('starts on first chunk and drains after done', async () => {
  const context = new FakeAudioContext();
  const player = new PcmStreamPlayer(0.4, context as unknown as AudioContext);
  await player.enqueue(new Uint8Array([0, 128, 255, 127]));
  expect(context.sources.length).toBe(1);
  expect(context.gain.gain.value).toBe(0.4);
  expect(player.hasStarted).toBe(false);
  context.currentTime = 0.04001;
  expect(player.hasStarted).toBe(true);
  let completed = false;
  const done = player.finish().then(() => { completed = true; });
  await settle();
  expect(completed).toBe(false);
  context.advance(1);
  await done;
  expect(context.state).toBe('closed');
});
/** 网络快于播放时缓冲有界；取消解除背压等待并停止全部节点。 */
test('bounds backpressure and cancels queued sources', async () => {
  const context = new FakeAudioContext();
  const player = new PcmStreamPlayer(1, context as unknown as AudioContext);
  for (let i = 0; i < 5; i++) await player.enqueue(new Uint8Array(24000));
  expect(context.sources.length).toBe(5);
  let settled = false;
  const blocked = player.enqueue(new Uint8Array(24000)).finally(() => { settled = true; });
  const rejection = blocked.catch((error: unknown) => error);
  await settle();
  expect(settled).toBe(false);
  expect(context.sources[1].at).toBeCloseTo(context.sources[0].at + 0.5);
  player.cancel();
  expect(await rejection).toMatchObject({ name: 'AbortError' });
  expect(context.sources.every((source) => source.stopped)).toBe(true);
});
