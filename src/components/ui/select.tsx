import * as React from "react";
type Item = { value: string; label: React.ReactNode };
const Ctx = React.createContext<{ items: Item[]; setItems: React.Dispatch<React.SetStateAction<Item[]>> } | null>(null);
export function Select({ value, onValueChange, children }:{ value?: string; onValueChange?: (v: string)=>void; children: React.ReactNode }) {
  const [items, setItems] = React.useState<Item[]>([]);
  return (
    <Ctx.Provider value={{ items, setItems }}>
      <div className="inline-block">
        <select className="border rounded-md px-3 py-2 text-sm w-full" value={value ?? ""} onChange={(e)=>onValueChange?.(e.target.value)}>
          {items.map(it => <option key={it.value} value={it.value}>{it.label}</option>)}
        </select>
        <div className="hidden">{children}</div>
      </div>
    </Ctx.Provider>
  );
}
export function SelectTrigger({ children }:{ children?: React.ReactNode }) { return <>{children}</>; }
export function SelectValue({ placeholder }:{ placeholder?: string }) { return <span>{placeholder}</span>; }
export function SelectContent({ children }:{ children?: React.ReactNode }) { return <>{children}</>; }
export function SelectItem({ value, children }:{ value: string; children: React.ReactNode }) {
  const ctx = React.useContext(Ctx);
  React.useEffect(()=>{ if (ctx && !ctx.items.some(i=>i.value===value)) ctx.setItems(p=>[...p,{ value, label: children }]); },[ctx,value,children]);
  return null;
}
