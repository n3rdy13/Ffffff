
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Character } from '../types';
import { buildSystemPrompt, EMOTION_OPTIONS } from '../constants';
import { decodeAudioData, decodePCM, encodePCM, getApiKey, getLiveModel, setLiveModel, listAvailableModels, ModelOption, setAudioSessionType } from '../services/geminiService';

interface VoiceInterfaceProps {
  character: Character;
  onClose: () => void;
  onSettingsChange?: (newSettings: Character['voiceSettings']) => void;
}

type Phase = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking';

const PHASE_LABELS: Record<Phase, string> = {
  idle: 'Off',
  connecting: 'Connecting',
  listening: 'Listening — just talk',
  thinking: 'Thinking',
  speaking: 'Speaking',
};

function resample(data: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (Math.abs(fromRate - toRate) < 1) return data;
  const ratio = fromRate / toRate;
  const newLength = Math.round(data.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    result[i] = data[Math.min(Math.floor(i * ratio), data.length - 1)];
  }
  return result;
}

const VoiceInterface: React.FC<VoiceInterfaceProps> = ({ character, onClose, onSettingsChange }) => {
  const [phase, setPhaseState] = useState<Phase>('idle');
  const [phaseSince, setPhaseSince] = useState(Date.now());
  const [nowTick, setNowTick] = useState(Date.now());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [userTranscript, setUserTranscript] = useState('');
  const [modelTranscript, setModelTranscript] = useState('');
  const [showTuning, setShowTuning] = useState(false);

  const [tuning, setTuning] = useState(character.voiceSettings);
  const [voiceModels, setVoiceModels] = useState<ModelOption[]>([{ id: getLiveModel(), label: getLiveModel() }]);
  const [liveModel, setLiveModelState] = useState(getLiveModel());

  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phaseRef = useRef<Phase>('idle');
  const closingRef = useRef(false);
  const thinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnDoneRef = useRef(true);

  const isActive = phase === 'listening' || phase === 'thinking' || phase === 'speaking';
  const isConnecting = phase === 'connecting';
  const isSpeaking = phase === 'speaking';

  const setPhase = useCallback((next: Phase) => {
    if (phaseRef.current === next) return;
    phaseRef.current = next;
    setPhaseState(next);
    setPhaseSince(Date.now());
  }, []);

  // Elapsed-time ticker for the status pill
  useEffect(() => {
    if (phase === 'idle') return;
    const interval = setInterval(() => setNowTick(Date.now()), 500);
    return () => clearInterval(interval);
  }, [phase]);

  useEffect(() => {
    let cancelled = false;
    listAvailableModels().then(models => {
      if (!cancelled && models.voice.length) setVoiceModels(models.voice);
    });
    return () => { cancelled = true; };
  }, []);

  const cleanup = useCallback(() => {
    closingRef.current = true;
    if (thinkTimerRef.current) clearTimeout(thinkTimerRef.current);
    if (sessionRef.current) {
      try { sessionRef.current.close?.(); } catch (e) {}
      sessionRef.current = null;
    }
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(console.error);
      audioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close().catch(console.error);
      outputAudioContextRef.current = null;
    }
    setPhase('idle');
  }, [setPhase]);

  useEffect(() => cleanup, [cleanup]);

  const handleTuningChange = (key: keyof typeof tuning, value: any) => {
    const newTuning = { ...tuning, [key]: value };
    setTuning(newTuning);
    onSettingsChange?.(newTuning);
  };

  const handleVoiceModelChange = (id: string) => {
    setLiveModel(id);
    setLiveModelState(id);
  };

  const startSession = async () => {
    const apiKey = getApiKey();
    if (!apiKey) {
      alert('No Gemini API key set. Close this screen and add one via the key button (free at aistudio.google.com/apikey).');
      return;
    }
    closingRef.current = false;
    turnDoneRef.current = true;
    setErrorMsg(null);
    setUserTranscript('');
    setModelTranscript('');
    setPhase('connecting');
    const ai = new GoogleGenAI({ apiKey });

    try {
      // Audio contexts must be created during the tap (before any await) or iOS keeps them suspended
      setAudioSessionType('auto');
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioContextClass();
      outputAudioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
      audioContextRef.current.resume().catch(() => undefined);
      outputAudioContextRef.current.resume().catch(() => undefined);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const inputRate = audioContextRef.current.sampleRate;

      const sessionPromise = ai.live.connect({
        model: liveModel,
        callbacks: {
          onopen: () => {
            setPhase('listening');
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);

            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const resampledData = resample(inputData, inputRate, 16000);
              const l = resampledData.length;
              const int16 = new Int16Array(l);
              for (let i = 0; i < l; i++) {
                int16[i] = resampledData[i] * 32768;
              }
              const pcmBlob = {
                data: encodePCM(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };

              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const content = message.serverContent;
            if (!content) return;

            // Your words, as the server recognizes them — proof the prompt is arriving
            if (content.inputTranscription?.text) {
              if (turnDoneRef.current) {
                turnDoneRef.current = false;
                setUserTranscript('');
                setModelTranscript('');
              }
              setUserTranscript(prev => prev + content.inputTranscription!.text);
              if (phaseRef.current !== 'speaking') {
                setPhase('listening');
                // No explicit "user turn ended" event exists; a pause in recognized
                // speech means the prompt is in and we're waiting on the model.
                if (thinkTimerRef.current) clearTimeout(thinkTimerRef.current);
                thinkTimerRef.current = setTimeout(() => {
                  if (phaseRef.current === 'listening') setPhase('thinking');
                }, 900);
              }
            }

            if (content.outputTranscription?.text) {
              setModelTranscript(prev => prev + content.outputTranscription!.text);
            }

            // A turn can carry several parts (e.g. text then audio) — take every audio part
            const outCtx = outputAudioContextRef.current;
            if (outCtx) {
              for (const part of content.modelTurn?.parts || []) {
                const base64Audio = part.inlineData?.data;
                if (!base64Audio) continue;
                if (thinkTimerRef.current) clearTimeout(thinkTimerRef.current);
                setPhase('speaking');
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outCtx.currentTime);

                const audioBuffer = await decodeAudioData(decodePCM(base64Audio), outCtx, 24000, 1);
                const source = outCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.playbackRate.value = tuning.rate;
                source.detune.value = (tuning.pitch - 1.0) * 1200;

                source.connect(outCtx.destination);
                source.addEventListener('ended', () => {
                  sourcesRef.current.delete(source);
                  if (sourcesRef.current.size === 0 && phaseRef.current === 'speaking') {
                    setPhase('listening');
                  }
                });

                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                sourcesRef.current.add(source);
              }
            }

            if (content.turnComplete) {
              turnDoneRef.current = true;
              if (sourcesRef.current.size === 0 && phaseRef.current !== 'idle') {
                setPhase('listening');
              }
            }

            if (content.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setPhase('listening');
            }
          },
          onerror: (e: ErrorEvent) => {
            console.error("Live Error:", e);
            setErrorMsg(e?.message || 'Connection error');
          },
          onclose: (e: CloseEvent) => {
            if (closingRef.current) return;
            // Not initiated by us: the server dropped the session — say why
            const detail = [e?.code && e.code !== 1000 ? `code ${e.code}` : '', e?.reason || ''].filter(Boolean).join(': ');
            setErrorMsg(prev => prev || `Connection closed by the server${detail ? ` (${detail})` : ''}. This can happen when the model declines a persona — try another voice model in the settings (sliders icon), or edit the character.`);
            cleanup();
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: character.voiceName } },
          },
          systemInstruction: buildSystemPrompt({ ...character, voiceSettings: tuning }),
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      });

      sessionRef.current = await sessionPromise;
    } catch (err: any) {
      console.error("Failed to start voice session", err);
      setErrorMsg(err?.message || 'Could not start the voice session.');
      cleanup();
    }
  };

  useEffect(() => {
    let animationFrame: number;
    const draw = () => {
      if (!canvasRef.current) return;
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;

      const w = canvasRef.current.width;
      const h = canvasRef.current.height;
      ctx.clearRect(0, 0, w, h);

      const time = Date.now() / 1000;
      const centerX = w / 2;
      const centerY = h / 2;

      const radiusBase = (window.innerWidth < 768 ? 40 : 60) + (tuning.pitch - 1.0) * 20;
      const radius = radiusBase + (isSpeaking ? Math.sin(time * 10) * 15 : 0) + (isActive ? Math.sin(time * 2) * 4 : 0);

      const gradient = ctx.createRadialGradient(centerX, centerY, 10, centerX, centerY, radius + 60);
      gradient.addColorStop(0, isSpeaking ? 'rgba(236, 72, 153, 0.5)' : 'rgba(168, 85, 247, 0.4)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius + 60, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.lineWidth = 2 + tuning.rate * 4;
      ctx.strokeStyle = isSpeaking ? '#ec4899' : '#a855f7';
      ctx.stroke();

      animationFrame = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationFrame);
  }, [isSpeaking, isActive, tuning]);

  const elapsed = Math.max(0, Math.round((nowTick - phaseSince) / 1000));

  return (
    <div className="fixed inset-0 z-50 safe-area flex flex-col bg-black/95 backdrop-blur-2xl animate-in fade-in duration-300">
      <div className="relative flex-1 flex flex-col items-center justify-between p-6 md:p-8 min-h-0">
        {/* Header Controls */}
        <div className="w-full flex justify-between items-center z-30">
           <button
            onClick={() => setShowTuning(!showTuning)}
            title="Voice settings"
            className={`p-3 rounded-2xl transition-all ${showTuning ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
          </button>
          <button
            onClick={() => { cleanup(); onClose(); }}
            title="Close voice"
            className="p-3 text-slate-400 hover:text-white hover:bg-slate-800 rounded-2xl transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Error banner */}
        {errorMsg && (
          <div className="w-full max-w-lg mt-2 p-4 bg-red-500/10 border border-red-500/40 rounded-2xl text-red-300 text-xs leading-relaxed z-30 flex items-start gap-3">
            <svg className="w-5 h-5 shrink-0 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <span className="flex-1">{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-white shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        )}

        {/* Character Info */}
        <div className={`text-center transition-all duration-500 z-10 ${showTuning ? 'opacity-20 scale-90 blur-sm' : ''}`}>
          <div className="w-20 h-20 md:w-24 md:h-24 rounded-full border-4 border-purple-500 overflow-hidden mx-auto mb-4 neon-border shadow-[0_0_30px_rgba(168,85,247,0.5)]">
            <img src={character.avatarUrl || `https://picsum.photos/seed/${character.name}/200/200`} alt={character.name} className="w-full h-full object-cover" />
          </div>
          <h2 className="text-2xl md:text-3xl font-outfit font-bold text-white mb-2">{character.name}</h2>
          <div className="flex flex-col items-center gap-2">
            <div className="px-4 py-1.5 bg-purple-500/10 border border-purple-500/30 rounded-full text-[10px] text-purple-300 uppercase font-black tracking-widest inline-block">
               Mood: {tuning.emotion}
            </div>
            {/* Live pipeline status — real events, not a generic spinner */}
            {phase !== 'idle' && (
              <div className="px-4 py-1.5 bg-slate-800/80 border border-slate-700 rounded-full text-[10px] uppercase font-black tracking-widest inline-flex items-center gap-2 text-slate-200">
                <span className={`w-2 h-2 rounded-full ${phase === 'speaking' ? 'bg-pink-500' : phase === 'thinking' ? 'bg-amber-400 animate-pulse' : phase === 'connecting' ? 'bg-slate-400 animate-pulse' : 'bg-green-500'}`} />
                {PHASE_LABELS[phase]}{(phase === 'thinking' || phase === 'connecting') ? ` · ${elapsed}s` : ''}
              </div>
            )}
          </div>
        </div>

        {/* Visualizer Area */}
        <div className={`flex-1 w-full flex items-center justify-center transition-all duration-500 min-h-0 ${showTuning ? 'opacity-0 blur-md' : 'opacity-100'}`}>
          <canvas ref={canvasRef} width={400} height={400} className="w-full h-full max-w-[320px] md:max-w-none" />
        </div>

        {/* Live transcript — what the server heard from you, and what the model said */}
        {(userTranscript || modelTranscript) && !showTuning && (
          <div className="w-full max-w-lg max-h-28 overflow-y-auto mb-4 p-4 bg-slate-900/70 border border-slate-800 rounded-2xl text-xs leading-relaxed space-y-2 z-20">
            {userTranscript && (
              <p className="text-slate-300"><span className="text-purple-400 font-bold uppercase text-[9px] tracking-widest mr-2">You</span>{userTranscript}</p>
            )}
            {modelTranscript && (
              <p className="text-slate-300"><span className="text-pink-400 font-bold uppercase text-[9px] tracking-widest mr-2">{character.name}</span>{modelTranscript}</p>
            )}
          </div>
        )}

        {/* Action Button */}
        <div className="w-full flex justify-center pb-8 z-30">
          {!isActive && !isConnecting ? (
            <button
              onClick={startSession}
              className="group relative px-10 py-4 md:px-12 md:py-5 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full text-white font-black text-lg md:text-xl transition-all hover:scale-105 active:scale-95 shadow-2xl shadow-purple-500/40"
            >
              Start Sync
              <div className="absolute inset-0 rounded-full border-2 border-white/20 animate-ping" />
            </button>
          ) : isActive ? (
            <button
              onClick={() => { cleanup(); }}
              className="px-8 py-4 bg-red-500/20 hover:bg-red-500/40 text-red-400 border border-red-500/50 rounded-full font-black uppercase tracking-widest text-xs transition-all"
            >
              End Call
            </button>
          ) : (
            <div className="text-purple-400 font-black tracking-[0.2em] animate-pulse text-sm">
              CONNECTING — {elapsed}s
            </div>
          )}
        </div>

        {/* Tuning Drawer - Enhanced for Mobile */}
        {showTuning && (
          <div className="absolute inset-x-4 bottom-24 glass-panel p-5 md:p-6 rounded-[2rem] animate-in slide-in-from-bottom-8 duration-300 shadow-2xl z-40 max-h-[70vh] overflow-y-auto border border-purple-500/30">
             <div className="flex justify-between items-center mb-6">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Voice Parametrics</h3>
                <button onClick={() => setShowTuning(false)} className="text-slate-500 hover:text-white p-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
             </div>
             <div className="space-y-6">
                <div className="space-y-3">
                  <div className="flex justify-between text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    <span>Voice Model</span>
                    {isActive && <span className="text-amber-400 normal-case font-semibold">applies to the next call</span>}
                  </div>
                  <select
                    value={liveModel}
                    onChange={e => handleVoiceModelChange(e.target.value)}
                    className="w-full bg-slate-900/70 border border-slate-700 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-purple-500 outline-none transition-all appearance-none text-slate-300 text-base md:text-sm"
                  >
                    {voiceModels.map(m => (
                      <option key={m.id} value={m.id} className="bg-slate-900">{m.label}</option>
                    ))}
                    {!voiceModels.some(m => m.id === liveModel) && (
                      <option value={liveModel} className="bg-slate-900">{liveModel}</option>
                    )}
                  </select>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    <span>Active Overlay</span>
                    <span className="text-purple-400">{tuning.emotion}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {EMOTION_OPTIONS.map(emo => (
                      <button
                        key={emo}
                        onClick={() => handleTuningChange('emotion', emo)}
                        className={`px-3 py-1.5 rounded-xl text-[10px] font-bold border transition-all ${tuning.emotion === emo ? 'bg-purple-600 border-purple-500 text-white shadow-lg' : 'bg-slate-900/50 border-slate-800 text-slate-500'}`}
                      >
                        {emo}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                   <div className="space-y-3">
                      <div className="flex justify-between text-[10px] font-black text-slate-500 uppercase tracking-widest">
                        <span>Frequency Range</span>
                        <span className="text-purple-400">{tuning.pitch.toFixed(1)}x</span>
                      </div>
                      <input
                        type="range" min="0.5" max="1.5" step="0.1"
                        value={tuning.pitch}
                        onChange={e => handleTuningChange('pitch', parseFloat(e.target.value))}
                        className="w-full accent-purple-500 h-2 bg-slate-800 rounded-full appearance-none cursor-pointer"
                      />
                   </div>
                   <div className="space-y-3">
                      <div className="flex justify-between text-[10px] font-black text-slate-500 uppercase tracking-widest">
                        <span>Tempo Velocity</span>
                        <span className="text-purple-400">{tuning.rate.toFixed(1)}x</span>
                      </div>
                      <input
                        type="range" min="0.5" max="1.5" step="0.1"
                        value={tuning.rate}
                        onChange={e => handleTuningChange('rate', parseFloat(e.target.value))}
                        className="w-full accent-purple-500 h-2 bg-slate-800 rounded-full appearance-none cursor-pointer"
                      />
                   </div>
                </div>

                <p className="text-[9px] text-slate-500 italic text-center mt-4 uppercase tracking-tighter">Changes propagate to the next response cycle.</p>
             </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VoiceInterface;
