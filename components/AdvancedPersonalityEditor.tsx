
import React from 'react';
import { AdvancedTraits } from '../types';

interface AdvancedPersonalityEditorProps {
  traits: AdvancedTraits;
  triggers: string;
  dynamics: string;
  onChange: (key: string, value: any) => void;
}

const AdvancedPersonalityEditor: React.FC<AdvancedPersonalityEditorProps> = ({ traits, triggers, dynamics, onChange }) => {
  const traitLabels: Record<keyof AdvancedTraits, string> = {
    tenderness: 'Tenderness',
    dominance: 'Dominance',
    curiosity: 'Curiosity',
    rebelliousness: 'Rebelliousness',
    empathy: 'Empathy',
    wit: 'Wit'
  };

  const handleTraitChange = (key: keyof AdvancedTraits, value: number) => {
    onChange('advancedTraits', { ...traits, [key]: value });
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Personality Sliders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
        {Object.entries(traitLabels).map(([key, label]) => (
          <div key={key} className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{label}</label>
              <span className="text-xs font-mono text-purple-400 font-bold">{traits[key as keyof AdvancedTraits]}%</span>
            </div>
            <div className="relative flex items-center">
              <input
                type="range"
                min="0"
                max="100"
                value={traits[key as keyof AdvancedTraits]}
                onChange={(e) => handleTraitChange(key as keyof AdvancedTraits, parseInt(e.target.value))}
                className="w-full accent-purple-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer hover:accent-pink-500 transition-all"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="h-px bg-slate-800/50" />

      {/* Relationship Nuance & Triggers */}
      <div className="space-y-6">
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Nuanced Relationship Dynamics</label>
          <textarea
            value={dynamics}
            onChange={(e) => onChange('nuancedDynamics', e.target.value)}
            className="w-full h-24 bg-slate-900/50 border border-slate-700 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-purple-500 outline-none transition-all resize-none text-base md:text-sm text-slate-300 placeholder:text-slate-600"
            placeholder="e.g., Hidden romantic tension beneath a cold exterior. Mutual respect but frequent intellectual sparring."
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Behavioral Triggers</label>
          <textarea
            value={triggers}
            onChange={(e) => onChange('behavioralTriggers', e.target.value)}
            className="w-full h-24 bg-slate-900/50 border border-slate-700 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-pink-500 outline-none transition-all resize-none text-base md:text-sm text-slate-300 placeholder:text-slate-600"
            placeholder="e.g., Becomes protective if the user mentions being threatened. Softens their tone if the user is vulnerable."
          />
          <p className="text-[10px] text-slate-500 italic">Define specific events or user behaviors that shift the AI's internal state.</p>
        </div>
      </div>
    </div>
  );
};

export default AdvancedPersonalityEditor;
