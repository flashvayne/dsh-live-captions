# Bundled model notices

This directory ships speech-recognition model files so the plugin can transcribe
audio without downloading from Hugging Face at first run.

## SenseVoice (ASR)

- `sensevoice-onnx/model.int8.onnx` and `sensevoice-onnx/tokens.txt` are the
  SenseVoiceSmall model exported to ONNX by the
  [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) project, from
  [csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17).
- Model weights: **FunASR Model License v1.1**, © Alibaba Group / FunAudioLLM.
  Redistribution is permitted with attribution. See
  <https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE>.
- The sherpa-onnx export tooling is Apache-2.0
  (<https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE>).

## Silero VAD

- `silero/silero_vad.onnx` is the Silero VAD model exported to ONNX, from
  [csukuangfj/vad](https://huggingface.co/csukuangfj/vad).
- License: MIT (Silero models), © Silero.
