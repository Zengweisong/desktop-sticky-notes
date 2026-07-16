interface Props { value: number; onChange: (value: number) => void; }
export function OpacitySlider({ value, onChange }: Props) {
  return <div className="setting-block">
    <div className="setting-heading"><label htmlFor="opacity">背景不透明度</label><output>{value}%</output></div>
    <input id="opacity" className="opacity-slider" type="range" min="0" max="100" step="1" value={value}
      onChange={(e) => onChange(Number(e.target.value))} />
    <div className="range-labels"><span>完全透明</span><span>不透明</span></div>
  </div>;
}
