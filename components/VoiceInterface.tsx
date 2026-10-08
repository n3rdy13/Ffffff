
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Character } from '../types';
import { buildSystemPrompt, EMOTION_OPTIONS } from '../constants';
import { decodeAudioData, decodePCM, encodePCM, getApiKey, LIVE_MODEL, setAudioSessionType } from '../services/geminiService';

interface VoiceInterfaceProps {
  character: Character;
  onClose: () => void;
  onSettingsChange?: (newSettings: Character['voiceSettings']) => void;
}

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
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showTuning, setShowTuning] = useState(false);
  
  const [tuning, setTuning] = useState(character.voiceSettings);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const cleanup = useCallback(() => {
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
    setIsActive(false);
    setIsConnecting(false);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const handleTuningChange = (key: keyof typeof tuning, value: any) => {
    const newTuning = { ...tuning, [key]: value };
    setTuning(newTuning);
    onSettingsChange?.(newTuning);
  };

  const startSession = async () => {
    const apiKey = getApiKey();
    if (!apiKey) {
      alert('No Gemini API key set. Close this screen and add one via the key button (free at aistudio.google.com/apikey).');
      return;
    }
    setIsConnecting(true);
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
        model: LIVE_MODEL,
        callbacks: {
          onopen: () => {
            setIsConnecting(false);
            setIsActive(true);
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
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            const outCtx = outputAudioContextRef.current;
            if (base64Audio && outCtx) {
              setIsSpeaking(true);
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outCtx.currentTime);
              
              const audioBuffer = await decodeAudioData(decodePCM(base64Audio), outCtx, 24000, 1);
              const source = outCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.playbackRate.value = tuning.rate;
              source.detune.value = (tuning.pitch - 1.0) * 1200;

              source.connect(outCtx.destination);
              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setIsSpeaking(false);
              });

              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsSpeaking(false);
            }
          },
          onerror: (e) => console.error("Live Error:", e),
          onclose: () => cleanup(),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: character.voiceName } },
          },
          systemInstruction: buildSystemPrompt({ ...character, voiceSettings: tuning }),
        },
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error("Failed to start voice session", err);
      setIsConnecting(false);
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

  return (
    <div className="fixed inset-0 z-50 safe-area flex flex-col bg-black/95 backdrop-blur-2xl animate-in fade-in duration-300">
      <div className="relative flex-1 flex flex-col items-center justify-between p-6 md:p-8">
        {/* Header Controls */}
        <div className="w-full flex justify-between items-center z-30">
           <button
            onClick={() => setShowTuning(!showTuning)}
            className={`p-3 rounded-2xl transition-all ${showTuning ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
          </button>
          <button
            onClick={() => { cleanup(); onClose(); }}
            className="p-3 text-slate-400 hover:text-white hover:bg-slate-800 rounded-2xl transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Character Info */}
        <div className={`text-center transition-all duration-500 z-10 ${showTuning ? 'opacity-20 scale-90 blur-sm' : ''}`}>
          <div className="w-20 h-20 md:w-24 md:h-24 rounded-full border-4 border-purple-500 overflow-hidden mx-auto mb-4 neon-border shadow-[0_0_30px_rgba(168,85,247,0.5)]">
            <img src={character.avatarUrl || `https://picsum.photos/seed/${character.name}/200/200`} alt={character.name} className="w-full h-full object-cover" />
          </div>
          <h2 className="text-2xl md:text-3xl font-outfit font-bold text-white mb-2">{character.name}</h2>
          <div className="px-4 py-1.5 bg-purple-500/10 border border-purple-500/30 rounded-full text-[10px] text-purple-300 uppercase font-black tracking-widest inline-block">
             Mood: {tuning.emotion}
          </div>
        </div>

        {/* Visualizer Area */}
        <div className={`flex-1 w-full flex items-center justify-center transition-all duration-500 ${showTuning ? 'opacity-0 blur-md' : 'opacity-100'}`}>
          <canvas ref={canvasRef} width={400} height={400} className="w-full h-full max-w-[320px] md:max-w-none" />
        </div>

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
              LINKING NEURAL PATHWAYS...
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
