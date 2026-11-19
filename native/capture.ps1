#Requires -Version 5.1
<#
  Real-time audio capture helper for the live-captions plugin.

  Captures the Windows default *render* endpoint in loopback mode (what the
  speakers play) and/or the default *capture* endpoint (microphone), mixes them
  to 16 kHz mono 16-bit PCM and writes consecutive WAV segments to -OutDir.

  Protocol (stdout, one JSON object per line):
    {"type":"ready","outDir":"...","segmentSeconds":4}
    {"type":"segment","index":1,"file":"seg-000001.wav","seconds":4.0,"rms":0.0321}
    {"type":"error","error":"..."}

  The process exits when its parent terminates it or when the file
  "<OutDir>\stop.flag" appears.
#>
param(
  [Parameter(Mandatory = $true)][string]$OutDir,
  [int]$SegmentSeconds = 4,
  [double]$MinSegmentSeconds = 1.2,
  [ValidateSet('both', 'speaker', 'mic')][string]$Source = 'both',
  [int]$SampleRate = 16000
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

if (-not (Test-Path -LiteralPath $OutDir)) {
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
}
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path

$csSource = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace DshAudio
{
    internal enum EDataFlow { Render = 0, Capture = 1, All = 2 }
    internal enum ERole { Console = 0, Multimedia = 1, Communications = 2 }

    [Flags]
    internal enum CLSCTX : uint
    {
        INPROC_SERVER = 0x1, INPROC_HANDLER = 0x2, LOCAL_SERVER = 0x4,
        REMOTE_SERVER = 0x10, ALL = 0x17
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    internal class MMDeviceEnumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(EDataFlow dataFlow, uint stateMask, out IntPtr devices);
        int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice device);
        int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        int RegisterEndpointNotificationCallback(IntPtr client);
        int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDevice
    {
        int Activate(ref Guid iid, CLSCTX clsCtx, IntPtr activationParams,
                     [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        int OpenPropertyStore(uint access, out IntPtr store);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        int GetState(out uint state);
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioClient
    {
        int Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity,
                       IntPtr format, IntPtr sessionGuid);
        int GetBufferSize(out uint frameCount);
        int GetStreamLatency(out long latency);
        int GetCurrentPadding(out uint padding);
        int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closestMatch);
        int GetMixFormat(out IntPtr format);
        int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        int Start();
        int Stop();
        int Reset();
        int SetEventHandle(IntPtr eventHandle);
        int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioCaptureClient
    {
        int GetBuffer(out IntPtr data, out uint frameCount, out uint flags,
                      out long devicePosition, out long qpcPosition);
        int ReleaseBuffer(uint frameCount);
        int GetNextPacketSize(out uint frameCount);
    }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    internal struct WAVEFORMATEX
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    internal sealed class CaptureStream
    {
        public const uint LOOPBACK = 0x00020000;
        public const uint AUTOCONVERTPCM = 0x80000000;
        public const uint SRC_DEFAULT_QUALITY = 0x08000000;

        static readonly Guid IID_IAudioClient = new Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2");
        static readonly Guid IID_IAudioCaptureClient = new Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317");

        public string Name;
        public IAudioClient Client;
        public IAudioCaptureClient Capture;
        public int NativeRate;
        public int Channels;
        public bool IsFloat;
        public bool IsLoopback;

        // resampler state (native -> 16 kHz)
        double position;
        float previous;

        public static CaptureStream Open(bool loopback, int targetRate)
        {
            var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
            IMMDevice device;
            int hr = enumerator.GetDefaultAudioEndpoint(loopback ? EDataFlow.Render : EDataFlow.Capture, ERole.Multimedia, out device);
            if (hr != 0) throw new COMException("no default endpoint", hr);

            object raw;
            Guid iidClient = IID_IAudioClient;
            hr = device.Activate(ref iidClient, CLSCTX.ALL, IntPtr.Zero, out raw);
            if (hr != 0) throw new COMException("Activate(IAudioClient) failed", hr);
            var client = (IAudioClient)raw;

            uint flags = loopback ? LOOPBACK : 0u;
            bool initialized = false;
            int rate = targetRate;
            int channels = 1;
            bool isFloat = false;

            // Preferred: let WASAPI convert to 16 kHz mono 16-bit PCM.
            var requested = new WAVEFORMATEX
            {
                wFormatTag = 1,
                nChannels = 1,
                nSamplesPerSec = (uint)targetRate,
                wBitsPerSample = 16,
                nBlockAlign = 2,
                nAvgBytesPerSec = (uint)(targetRate * 2),
                cbSize = 0
            };
            IntPtr requestedPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(WAVEFORMATEX)));
            try
            {
                Marshal.StructureToPtr(requested, requestedPtr, false);
                hr = client.Initialize(0, flags | AUTOCONVERTPCM | SRC_DEFAULT_QUALITY, 2000000, 0, requestedPtr, IntPtr.Zero);
                initialized = hr == 0;
            }
            finally
            {
                Marshal.FreeHGlobal(requestedPtr);
            }

            if (!initialized)
            {
                IntPtr mixPtr;
                hr = client.GetMixFormat(out mixPtr);
                if (hr != 0) throw new COMException("GetMixFormat failed", hr);
                var mix = (WAVEFORMATEX)Marshal.PtrToStructure(mixPtr, typeof(WAVEFORMATEX));
                rate = (int)mix.nSamplesPerSec;
                channels = mix.nChannels;
                isFloat = mix.wBitsPerSample == 32;
                if (mix.wFormatTag == 0xFFFE)
                {
                    // WAVEFORMATEXTENSIBLE: the sub-format GUID starts at offset 24.
                    byte[] guidBytes = new byte[16];
                    Marshal.Copy(new IntPtr(mixPtr.ToInt64() + 24), guidBytes, 0, 16);
                    var subFormat = new Guid(guidBytes);
                    isFloat = subFormat == new Guid("00000003-0000-0010-8000-00AA00389B71");
                }
                hr = client.Initialize(0, flags, 2000000, 0, mixPtr, IntPtr.Zero);
                Marshal.FreeCoTaskMem(mixPtr);
                if (hr != 0) throw new COMException("Initialize with mix format failed", hr);
            }

            Guid iidCapture = IID_IAudioCaptureClient;
            object captureRaw;
            hr = client.GetService(ref iidCapture, out captureRaw);
            if (hr != 0) throw new COMException("GetService(IAudioCaptureClient) failed", hr);

            return new CaptureStream
            {
                Name = loopback ? "speaker" : "mic",
                Client = client,
                Capture = (IAudioCaptureClient)captureRaw,
                NativeRate = rate,
                Channels = channels < 1 ? 1 : channels,
                IsFloat = isFloat,
                IsLoopback = loopback,
                previous = 0f
            };
        }

        public void Start()
        {
            int hr = Client.Start();
            if (hr != 0) throw new COMException("IAudioClient.Start failed", hr);
        }

        public void Stop()
        {
            try { Client.Stop(); } catch { }
        }

        /// <summary>Pull every queued packet, downmix to mono and resample to the target rate.</summary>
        public void Pump(List<float> output, int targetRate)
        {
            while (true)
            {
                uint next;
                if (Capture.GetNextPacketSize(out next) != 0 || next == 0) return;

                while (next > 0)
                {
                    IntPtr data;
                    uint frames;
                    uint flags;
                    long devicePosition, qpcPosition;
                    int hr = Capture.GetBuffer(out data, out frames, out flags, out devicePosition, out qpcPosition);
                    if (hr != 0 || frames == 0)
                    {
                        if (hr == 0) Capture.ReleaseBuffer(frames);
                        return;
                    }

                    bool silent = (flags & 0x2) != 0;
                    if (!silent)
                    {
                        int stride = IsFloat ? 4 : 2;
                        byte[] raw = new byte[(int)frames * Channels * stride];
                        Marshal.Copy(data, raw, 0, raw.Length);
                        for (uint i = 0; i < frames; i++)
                        {
                            float sum = 0f;
                            for (int c = 0; c < Channels; c++)
                            {
                                int offset = (int)((i * Channels + c) * stride);
                                if (IsFloat) sum += BitConverter.ToSingle(raw, offset);
                                else sum += BitConverter.ToInt16(raw, offset) / 32768f;
                            }
                            AddSample(output, sum / Channels, targetRate);
                        }
                    }
                    else
                    {
                        for (uint i = 0; i < frames; i++) AddSample(output, 0f, targetRate);
                    }

                    Capture.ReleaseBuffer(frames);
                    if (Capture.GetNextPacketSize(out next) != 0) return;
                }
            }
        }

        void AddSample(List<float> output, float sample, int targetRate)
        {
            if (NativeRate == targetRate)
            {
                output.Add(sample);
                return;
            }
            double step = (double)NativeRate / targetRate;
            position += 1.0;
            if (position >= step)
            {
                // Linear interpolation between the two most recent native samples.
                double frac = 1.0 - (position - step) / step;
                if (frac > 1.0) frac = 1.0;
                if (frac < 0.0) frac = 0.0;
                output.Add(previous + (float)((sample - previous) * frac));
                position -= step;
            }
            previous = sample;
        }
    }

    internal sealed class SegmentWriter
    {
        readonly string outDir;
        readonly int sampleRate;
        readonly int minFrames;
        readonly int hardFrames;
        readonly List<short> recent = new List<short>(8192);
        const int QuietWindowFrames = 4000;   // 250 ms of near-silence ends an utterance
        const double QuietRms = 0.004;
        FileStream stream;
        BinaryWriter writer;
        int frames;
        int segmentIndex;
        double sumSquares;
        bool disposed;

        public SegmentWriter(string outDir, int sampleRate, double minSeconds, int maxSeconds)
        {
            this.outDir = outDir;
            this.sampleRate = sampleRate;
            minFrames = (int)(sampleRate * minSeconds);
            hardFrames = sampleRate * maxSeconds;
            if (hardFrames <= minFrames) hardFrames = minFrames + sampleRate;
        }

        public void Write(short[] samples, int count)
        {
            if (stream == null) OpenSegment();
            var bytes = new byte[count * 2];
            Buffer.BlockCopy(samples, 0, bytes, 0, bytes.Length);
            stream.Write(bytes, 0, bytes.Length);
            frames += count;
            for (int i = 0; i < count; i++) { double v = samples[i] / 32768.0; sumSquares += v * v; }
            for (int i = 0; i < count; i++) recent.Add(samples[i]);
            if (recent.Count > QuietWindowFrames * 2) recent.RemoveRange(0, recent.Count - QuietWindowFrames * 2);

            // Commit as soon as the speaker pauses, so the subtitle appears at the
            // end of an utterance instead of waiting for a fixed window.
            bool quietTail = recent.Count >= QuietWindowFrames && TailRms() < QuietRms;
            if (frames >= minFrames && quietTail) Emit();
            else if (frames >= hardFrames) Emit();
            else if ((frames % sampleRate) < count) PatchHeader(false);
        }

        double TailRms()
        {
            double sum = 0;
            for (int i = 0; i < recent.Count; i++) { double v = recent[i] / 32768.0; sum += v * v; }
            return Math.Sqrt(sum / recent.Count);
        }

        void OpenSegment()
        {
            segmentIndex++;
            string path = Path.Combine(outDir, "seg-" + segmentIndex.ToString("D6") + ".wav");
            stream = new FileStream(path, FileMode.Create, FileAccess.ReadWrite, FileShare.Read);
            writer = new BinaryWriter(stream);
            WriteHeader(0);
            frames = 0;
            sumSquares = 0;
        }

        void WriteHeader(int dataBytes)
        {
            stream.Seek(0, SeekOrigin.Begin);
            writer.Write(new byte[] { (byte)'R', (byte)'I', (byte)'F', (byte)'F' });
            writer.Write((uint)(36 + dataBytes));
            writer.Write(new byte[] { (byte)'W', (byte)'A', (byte)'V', (byte)'E' });
            writer.Write(new byte[] { (byte)'f', (byte)'m', (byte)'t', (byte)' ' });
            writer.Write((uint)16);
            writer.Write((ushort)1);
            writer.Write((ushort)1);
            writer.Write((uint)sampleRate);
            writer.Write((uint)(sampleRate * 2));
            writer.Write((ushort)2);
            writer.Write((ushort)16);
            writer.Write(new byte[] { (byte)'d', (byte)'a', (byte)'t', (byte)'a' });
            writer.Write((uint)dataBytes);
        }

        void PatchHeader(bool finalize)
        {
            if (stream == null) return;
            long end = stream.Position;
            WriteHeader(frames * 2);
            stream.Seek(end, SeekOrigin.Begin);
            stream.Flush();
        }

        public void Emit()
        {
            if (stream == null) return;
            PatchHeader(true);
            double seconds = (double)frames / sampleRate;
            double rms = frames > 0 ? Math.Sqrt(sumSquares / frames) : 0;
            string path = Path.Combine(outDir, "seg-" + segmentIndex.ToString("D6") + ".wav");
            Console.WriteLine("{\"type\":\"segment\",\"index\":" + segmentIndex +
                ",\"file\":\"" + Path.GetFileName(path) + "\",\"seconds\":" + seconds.ToString("F2") +
                ",\"rms\":" + rms.ToString("F5") + "}");
            Console.Out.Flush();
            writer.Dispose();
            stream.Dispose();
            writer = null;
            stream = null;
            recent.Clear();
            frames = 0;
            sumSquares = 0;
        }

        public void Close()
        {
            if (disposed) return;
            disposed = true;
            if (stream != null && frames > 0) Emit();
        }
    }

    public static class Program
    {
        public static void Run(string outDir, int segmentSeconds, double minSegmentSeconds, string source, int sampleRate)
        {
            bool wantSpeaker = source == "both" || source == "speaker";
            bool wantMic = source == "both" || source == "mic";

            CaptureStream speaker = null;
            CaptureStream mic = null;
            var streams = new List<CaptureStream>();
            try
            {
                if (wantSpeaker)
                {
                    try { speaker = CaptureStream.Open(true, sampleRate); streams.Add(speaker); }
                    catch (Exception ex)
                    {
                        Console.WriteLine("{\"type\":\"warning\",\"warning\":\"speaker capture unavailable: " +
                            Escape(ex.Message) + "\"}");
                    }
                }
                if (wantMic)
                {
                    try { mic = CaptureStream.Open(false, sampleRate); streams.Add(mic); }
                    catch (Exception ex)
                    {
                        Console.WriteLine("{\"type\":\"warning\",\"warning\":\"microphone unavailable: " +
                            Escape(ex.Message) + "\"}");
                    }
                }
                if (streams.Count == 0)
                {
                    Console.WriteLine("{\"type\":\"error\",\"error\":\"no audio endpoint could be opened\"}");
                    return;
                }

                foreach (var s in streams) s.Start();
                Console.WriteLine("{\"type\":\"ready\",\"outDir\":\"" + Escape(outDir) +
                    "\",\"segmentSeconds\":" + segmentSeconds + "}");
                Console.Out.Flush();

                var writer = new SegmentWriter(outDir, sampleRate, minSegmentSeconds, segmentSeconds);
                var speakerBuffer = new List<float>(sampleRate);
                var micBuffer = new List<float>(sampleRate);
                var mixed = new List<short>(sampleRate);
                string stopFlag = Path.Combine(outDir, "stop.flag");

                while (!File.Exists(stopFlag))
                {
                    speakerBuffer.Clear();
                    micBuffer.Clear();
                    if (speaker != null) speaker.Pump(speakerBuffer, sampleRate);
                    if (mic != null) mic.Pump(micBuffer, sampleRate);

                    int count = Math.Max(speakerBuffer.Count, micBuffer.Count);
                    if (count == 0) { Thread.Sleep(20); continue; }

                    mixed.Clear();
                    for (int i = 0; i < count; i++)
                    {
                        float value = 0f;
                        if (i < speakerBuffer.Count) value += speakerBuffer[i];
                        if (i < micBuffer.Count) value += micBuffer[i];
                        if (value > 1f) value = 1f;
                        else if (value < -1f) value = -1f;
                        mixed.Add((short)(value * 32767f));
                    }
                    writer.Write(mixed.ToArray(), mixed.Count);
                    Thread.Sleep(15);
                }
                writer.Close();
            }
            catch (Exception ex)
            {
                Console.WriteLine("{\"type\":\"error\",\"error\":\"" + Escape(ex.Message) + "\"}");
            }
            finally
            {
                foreach (var s in streams) s.Stop();
            }
        }

        static string Escape(string value)
        {
            if (value == null) return "";
            return value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ");
        }
    }
}
'@

Add-Type -TypeDefinition $csSource -Language CSharp | Out-Null
[DshAudio.Program]::Run($OutDir, $SegmentSeconds, $MinSegmentSeconds, $Source, $SampleRate)
