"use client";

import { useEffect, useId, useRef, useState } from "react";
import { sessionFetch } from "@/app/lib/session";

type Location = { id: number | string; code?: string; name: string; country?: string; city?: string | { name: string } };

export default function LocationCombobox({ label, kind, value, onChange, placeholder }: {
  label: string; kind: "airports" | "cities"; value: string; onChange: (value: string) => void; placeholder: string;
}) {
  const id = useId();
  const [options, setOptions] = useState<Location[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const generation = useRef(0);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (value !== query) {
      generation.current += 1;
      setQuery(""); setOptions([]); setOpen(false); setLoading(false);
    }
  }, [value, query]);
  useEffect(() => {
    const version = ++generation.current;
    const controller = new AbortController();
    setOptions([]); setActive(-1); setError(""); setLoading(false);
    if (query.trim().length < 2) return () => controller.abort();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await sessionFetch(`/api/locations/${kind}?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Suggestions unavailable. You can still enter a location.");
        const data = await response.json();
        if (version === generation.current && !controller.signal.aborted) setOptions(data[kind] ?? []);
      } catch (failure) {
        if (!controller.signal.aborted && version === generation.current) setError(failure instanceof Error ? failure.message : "Suggestions unavailable.");
      } finally {
        if (version === generation.current && !controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, kind]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [active]);
  const choose = (option: Location) => {
    generation.current += 1; onChange(kind === "airports" ? option.code ?? option.name : option.name);
    setQuery(""); setOptions([]); setOpen(false); setActive(-1);
  };
  return <div className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <label className="label" htmlFor={id}>{label}</label>
    <input id={id} className="field" role="combobox" autoComplete="off" required value={value} placeholder={placeholder}
      aria-autocomplete="list" aria-expanded={open && options.length > 0} aria-controls={`${id}-options`}
      aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined} aria-describedby={`${id}-status`}
      onChange={(event) => { generation.current += 1; onChange(event.target.value); setQuery(event.target.value); setOptions([]); setActive(-1); setOpen(true); }}
      onFocus={() => setOpen(true)} onKeyDown={(event) => {
        if (event.key === "Escape") { setOpen(false); setActive(-1); }
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && options.length) {
          event.preventDefault(); setOpen(true);
          setActive((current) => event.key === "ArrowDown" ? (current + 1) % options.length : (current <= 0 ? options.length - 1 : current - 1));
        }
        if (event.key === "Enter" && open && active >= 0 && options[active]) { event.preventDefault(); choose(options[active]); }
      }} />
    <ul ref={list} id={`${id}-options`} role="listbox" aria-label={`${label} suggestions`} hidden={!open || !options.length} className="combobox-options floating">
      {options.map((option, index) => <li id={`${id}-option-${index}`} key={option.id} role="option" aria-selected={active === index}
        onPointerDown={(event) => event.preventDefault()} onClick={() => choose(option)} onPointerMove={() => setActive(index)}>
        {option.code ? `${option.code} · ` : ""}{option.name}{option.country ? ` (${option.country})` : ""}
      </li>)}
    </ul>
    <span id={`${id}-status`} className="text-xs muted" role="status">{loading ? "Finding locations…" : error || (open && query.length >= 2 && !options.length ? "Enter a location or airport code." : "")}</span>
  </div>;
}
