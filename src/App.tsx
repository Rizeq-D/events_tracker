import React, { useEffect, useMemo, useRef, useState } from "react";
import { addMonths, endOfDay, format, isWithinInterval, parseISO, startOfDay, subMonths } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Upload, Download, Trash2, Filter, Plus } from "lucide-react";

/** -------------------- Config -------------------- */
const ROOMS = [
  "Cafe",
  "Hall",
  "Backyard",
  "Seminar room",
  "Conferences room",
  "Pavilion",
] as const;
type Room = (typeof ROOMS)[number];

const STATUSES = ["Taken", "Booked", "Canceled", "On hold", "Free"] as const;
type Status = (typeof STATUSES)[number];

type EventRow = {
  id?: string;
  name: string;
  date: string;   // yyyy-MM-dd
  start: string;  // HH:mm
  end: string;    // HH:mm
  rooms: Room[];
  status: Status;
  guests: number;
  rate: number;   // hourly
  day: number;    // full day
  fee: number;    // fixed fee
  food: number;
  drinks: number;
  cancelReason?: string;
  notes?: string;
};

const STORAGE_KEY = "events_tracker_v3";

/** -------------------- Utils -------------------- */
const euro = (n: number) =>
  (Number(n || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const toNum = (v: any) => (v === null || v === undefined || v === "" || isNaN(+v) ? 0 : +v);

function parseTime(dateStr: string, timeStr: string) {
  try {
    const [h, m] = (timeStr || "0:0").split(":").map(Number);
    const d = new Date(`${dateStr}T00:00:00`);
    d.setHours(h || 0, m || 0, 0, 0);
    return d;
  } catch {
    return new Date(dateStr);
  }
}

function durationHrs(e: EventRow) {
  const s = parseTime(e.date, e.start);
  const en = parseTime(e.date, e.end);
  return Math.max(0, (en.getTime() - s.getTime()) / 3_600_000);
}

function rentalPart(e: EventRow) {
  if (e.status === "Free") return 0;
  if (e.fee > 0) return e.fee;
  if (e.day > 0) return e.day;
  return e.rate * durationHrs(e);
}

function revenueFor(e: EventRow) {
  const base = e.status === "Taken" ? rentalPart(e) : 0;
  return base + (e.food + e.drinks);
}

function lostFor(e: EventRow) {
  if (e.status !== "Canceled") return 0;
  return rentalPart(e);
}

function yearOf(e: EventRow) {
  try {
    return new Date(e.date).getFullYear();
  } catch {
    return undefined;
  }
}

/** -------------------- ICS helpers (client-side) -------------------- */
type Rule = { room: Room; kws: string[] };

function unfoldICSLines(raw: string) {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s/.test(line) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}
function readProps(block: string[]) {
  const obj: Record<string, string> = {};
  for (const line of block) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const keyPart = line.slice(0, idx);
    const val = line.slice(idx + 1);
    const key = keyPart.split(";")[0].toUpperCase();
    obj[key] = val;
  }
  return obj;
}
function asLocal(dateStr?: string | null) {
  if (!dateStr) return null;
  if (/^[0-9]{8}$/.test(dateStr)) {
    const y = +dateStr.slice(0, 4), m = +dateStr.slice(4, 6) - 1, d = +dateStr.slice(6, 8);
    return new Date(y, m, d);
  }
  const m = dateStr.match(/([0-9]{8})T([0-9]{2})([0-9]{2})([0-9]{2})(Z?)/);
  if (!m) return null;
  const y = +m[1].slice(0, 4), mo = +m[1].slice(4, 6) - 1, d = +m[1].slice(6, 8);
  const hh = +m[2], mm = +m[3], ss = +m[4];
  return m[5] === "Z" ? new Date(Date.UTC(y, mo, d, hh, mm, ss)) : new Date(y, mo, d, hh, mm, ss);
}
function fmtDate(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function fmtTime(d: Date) { return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }

function parseRules(text: string): Rule[] {
  const rules: Rule[] = [];
  (text || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line) => {
      const [room, keys] = line.split(":");
      if (!room || !keys) return;
      const roomName = room.trim() as Room;
      const ok = new Set(ROOMS);
      if (!ok.has(roomName)) return;
      const kws = keys.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
      if (kws.length) rules.push({ room: roomName, kws });
    });
  return rules;
}
function guessRooms(summary: string, location: string, rules: Rule[]): Room[] {
  const hay = `${summary || ""} ${location || ""}`.toLowerCase();
  const hits = new Set<Room>();
  for (const r of rules) if (r.kws.some((k) => hay.includes(k))) hits.add(r.room);
  return Array.from(hits);
}

/** -------------------- App -------------------- */
export default function App() {
  // Events
  const [events, setEvents] = useState<EventRow[]>(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw) as EventRow[]; } catch { return []; }
  });
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(events)); }, [events]);

  // Filters
  const [filter, setFilter] = useState({
    q: "",
    room: "" as "" | Room,
    status: "" as "" | Status,
    from: format(subMonths(new Date(), 3), "yyyy-MM-01"),
    to: format(addMonths(new Date(), 1), "yyyy-MM-28"),
  });

  // Form
  const emptyForm: EventRow = {
    name: "",
    date: "",
    start: "",
    end: "",
    rooms: [],
    status: "Taken",
    guests: 0,
    rate: 0,
    day: 0,
    fee: 0,
    food: 0,
    drinks: 0,
    cancelReason: "",
    notes: "",
  };
  const [form, setForm] = useState<EventRow>(emptyForm);
  const editingIndex = useRef<number | null>(null);

  /** -------- Derived lists -------- */
  const filtered = useMemo(() => {
    return events
      .filter((e) => {
        // search
        const q = filter.q.toLowerCase();
        const qOk =
          !q ||
          (e.name || "").toLowerCase().includes(q) ||
          (e.notes || "").toLowerCase().includes(q) ||
          (e.cancelReason || "").toLowerCase().includes(q);
        // room
        const rOk = !filter.room || e.rooms.includes(filter.room);
        // status
        const sOk = !filter.status || e.status === filter.status;
        // date range
        const d = parseISO(`${e.date}T00:00:00`);
        const from = parseISO(`${filter.from}T00:00:00`);
        const to = parseISO(`${filter.to}T23:59:59`);
        const rangeOk = isWithinInterval(d, { start: startOfDay(from), end: endOfDay(to) });
        return qOk && rOk && sOk && rangeOk;
      })
      .sort((a, b) => (a.date > b.date ? 1 : -1));
  }, [events, filter]);

  /** -------- KPIs -------- */
  const kpis = useMemo(() => {
    let total = 0, taken = 0, booked = 0, canceled = 0, hold = 0, free = 0;
    let revenue = 0, lost = 0, guests = 0;
    for (const e of filtered) {
      total++;
      if (e.status === "Taken") taken++;
      if (e.status === "Booked") booked++;
      if (e.status === "Canceled") canceled++;
      if (e.status === "On hold") hold++;
      if (e.status === "Free") free++;
      revenue += revenueFor(e);
      lost += lostFor(e);
      if (e.status === "Taken") guests += (e.guests || 0);
    }
    return { total, taken, booked, canceled, hold, free, revenue, lost, guests };
  }, [filtered]);

  /** -------- Per Room / Per Year -------- */
  const perRoom = useMemo(() => {
    const map: Record<string, { events: number; revenue: number; lost: number; guests: number }> = {};
    ROOMS.forEach((r) => (map[r] = { events: 0, revenue: 0, lost: 0, guests: 0 }));
    for (const e of filtered) {
      const rooms = e.rooms.length ? e.rooms : ([] as Room[]);
      const n = Math.max(1, rooms.length);
      const rent = rentalPart(e);
      const lost = lostFor(e);
      for (const r of rooms.length ? rooms : []) {
        if (!map[r]) map[r] = { events: 0, revenue: 0, lost: 0, guests: 0 };
        map[r].events++;
        map[r].revenue += (e.status === "Taken" ? rent / n : 0);
        map[r].lost += lost / n;
        map[r].guests += e.status === "Taken" ? (e.guests || 0) : 0;
      }
    }
    return map;
  }, [filtered]);

  const perYear = useMemo(() => {
    const map: Record<string, { events: number; taken: number; canceled: number; revenue: number; lost: number; guests: number }> = {};
    for (const e of filtered) {
      const y = String(yearOf(e) ?? "—");
      if (!map[y]) map[y] = { events: 0, taken: 0, canceled: 0, revenue: 0, lost: 0, guests: 0 };
      map[y].events++;
      if (e.status === "Taken") map[y].taken++;
      if (e.status === "Canceled") map[y].canceled++;
      map[y].revenue += revenueFor(e);
      map[y].lost += lostFor(e);
      if (e.status === "Taken") map[y].guests += e.guests || 0;
    }
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  /** -------- CRUD -------- */
  function startAdd() {
    editingIndex.current = null;
    setForm({ ...emptyForm });
  }
  function startEdit(idx: number) {
    editingIndex.current = idx;
    setForm({ ...filtered[idx] });
  }
  function saveForm() {
    const row: EventRow = {
      ...form,
      id: form.id || crypto.randomUUID(),
      name: (form.name || "").trim(),
      cancelReason: (form.cancelReason || "").trim(),
      notes: (form.notes || "").trim(),
      rooms: Array.from(new Set(form.rooms || [])).filter(Boolean) as Room[],
      guests: toNum(form.guests),
      rate: toNum(form.rate),
      day: toNum(form.day),
      fee: toNum(form.fee),
      food: toNum(form.food),
      drinks: toNum(form.drinks),
    };
    if (!row.name || !row.date || !row.start || !row.end) {
      alert("Please fill: name, date, start, end.");
      return;
    }
    if (editingIndex.current === null) {
      setEvents((prev) => [...prev, row]);
    } else {
      const globalIdx = events.findIndex((e) => e.id === filtered[editingIndex.current!].id);
      const copy = [...events];
      copy[globalIdx] = row;
      setEvents(copy);
    }
    startAdd();
  }
  function removeEvent(id?: string) {
    if (!id) return;
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }
  function clearAll() {
    if (!confirm("Delete ALL events?")) return;
    setEvents([]);
  }

  /** -------- Import/Export -------- */
  function exportJSON() {
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "events.json"; a.click();
    URL.revokeObjectURL(url);
  }
  function importJSONFile(file: File) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const arr = JSON.parse(String(r.result));
        if (Array.isArray(arr)) setEvents(arr as EventRow[]);
      } catch {
        alert("Invalid JSON");
      }
    };
    r.readAsText(file);
  }

  // ICS
  const [icsDefaults, setIcsDefaults] = useState({
    status: "Taken" as Status,
    guests: 0,
    rate: 0,
    day: 0,
    fee: 0,
    rules: `Cafe: cafe,barista
Hall: hall
Backyard: backyard,garden
Seminar room: seminar,workshop
Conferences room: conference,meeting
Pavilion: pavilion`,
  });

  async function importICSFile(file: File) {
    const txt = await file.text();
    const rules = parseRules(icsDefaults.rules);
    const lines = unfoldICSLines(txt);
    const blocks: string[][] = [];
    let cur: string[] | null = null;
    for (const line of lines) {
      if (line === "BEGIN:VEVENT") cur = [];
      else if (line === "END:VEVENT") { if (cur) { blocks.push(cur); cur = null; } }
      else if (cur) cur.push(line);
    }
    const imported: EventRow[] = [];
    for (const b of blocks) {
      const p = readProps(b);
      const d1 = asLocal(p["DTSTART"]); const d2 = asLocal(p["DTEND"]);
      if (!d1 || !d2) continue;
      const name = p["SUMMARY"] || "";
      const loc = p["LOCATION"] || "";
      const desc = p["DESCRIPTION"] || "";
      const uid = p["UID"] || crypto.randomUUID();
      const date = fmtDate(d1); const start = fmtTime(d1); const end = fmtTime(d2);
      const mappedRooms = guessRooms(name, loc, rules);
      imported.push({
        id: uid,
        name, date, start, end,
        rooms: mappedRooms as Room[],
        status: icsDefaults.status,
        guests: icsDefaults.guests,
        rate: icsDefaults.rate,
        day: icsDefaults.day,
        fee: icsDefaults.fee,
        food: 0,
        drinks: 0,
        notes: desc || loc,
        cancelReason: "",
      });
    }
    setEvents((prev) => [...prev, ...imported]);
    alert(`${imported.length} events imported from .ics`);
  }

  /** -------------------- UI -------------------- */
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Events Tracker</h1>
          <p className="text-sm text-muted-foreground">Multi-room bookings · Revenue/Lost · Guests · .ics import</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={exportJSON}><Download className="h-4 w-4 mr-2" />Export JSON</Button>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="file" accept="application/json" className="hidden" onChange={(e) => e.currentTarget.files?.[0] && importJSONFile(e.currentTarget.files[0])} />
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-md border"><Upload className="h-4 w-4" />Import JSON</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="file" accept=".ics,text/calendar" className="hidden" onChange={(e) => e.currentTarget.files?.[0] && importICSFile(e.currentTarget.files[0])} />
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-md border"><Upload className="h-4 w-4" />Import .ics</span>
          </label>
          <Button variant="destructive" onClick={clearAll}><Trash2 className="h-4 w-4 mr-2" />Clear All</Button>
        </div>
      </header>

      {/* ICS defaults */}
      <Card>
        <CardHeader className="pb-2"><CardTitle>ICS Import Settings</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div>
            <label className="text-xs">Default Status</label>
            <Select value={icsDefaults.status} onValueChange={(v) => setIcsDefaults((d) => ({ ...d, status: v as Status }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><label className="text-xs">Guests</label><Input type="number" value={icsDefaults.guests} onChange={(e) => setIcsDefaults((d) => ({ ...d, guests: toNum(e.target.value) }))} /></div>
          <div><label className="text-xs">Hourly Rate €</label><Input type="number" step="0.01" value={icsDefaults.rate} onChange={(e) => setIcsDefaults((d) => ({ ...d, rate: toNum(e.target.value) }))} /></div>
          <div><label className="text-xs">Day Rate €</label><Input type="number" step="0.01" value={icsDefaults.day} onChange={(e) => setIcsDefaults((d) => ({ ...d, day: toNum(e.target.value) }))} /></div>
          <div><label className="text-xs">Fixed Fee €</label><Input type="number" step="0.01" value={icsDefaults.fee} onChange={(e) => setIcsDefaults((d) => ({ ...d, fee: toNum(e.target.value) }))} /></div>
          <div className="md:col-span-6">
            <label className="text-xs">Room mapping rules (one per line, e.g. <code>Cafe: cafe,barista</code>)</label>
            <Textarea value={icsDefaults.rules} onChange={(e) => setIcsDefaults((d) => ({ ...d, rules: e.target.value }))} rows={4} />
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2"><Filter className="h-5 w-5" />Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <Input placeholder="Search name/notes…" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
          <div>
            <Select value={filter.room} onValueChange={(v) => setFilter({ ...filter, room: v as Room })}>
              <SelectTrigger><SelectValue placeholder="All rooms" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All rooms</SelectItem>
                {ROOMS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Select value={filter.status} onValueChange={(v) => setFilter({ ...filter, status: v as Status })}>
              <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All statuses</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Input type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} />
          <Input type="date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} />
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <Metric title="Total Events" value={kpis.total} />
        <Metric title="Taken" value={kpis.taken} />
        <Metric title="Booked" value={kpis.booked} />
        <Metric title="Canceled" value={kpis.canceled} />
        <Metric title="On hold" value={kpis.hold} />
        <Metric title="Free" value={kpis.free} />
        <Metric title="Revenue €" value={`€ ${euro(kpis.revenue)}`} />
        <Metric title="Lost €" value={`€ ${euro(kpis.lost)}`} />
        <Metric title="Guests Hosted" value={kpis.guests} />
      </div>

      {/* Add/Edit Form */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" />{editingIndex.current === null ? "Add Event" : "Edit Event"}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
          <Input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
          <div>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as Status })}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Input type="number" placeholder="Guests" value={form.guests} onChange={(e) => setForm({ ...form, guests: toNum(e.target.value) })} />
          <div className="md:col-span-6">
            <div className="text-sm font-medium mb-1 flex items-center justify-between">
              <span>Rooms (multi-select)</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setForm((f) => ({ ...f, rooms: [...ROOMS] as Room[] }))}>Book entire project</Button>
                <Button variant="outline" size="sm" onClick={() => setForm((f) => ({ ...f, rooms: ["Cafe", "Hall"] }))}>Cafe & Hall</Button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {ROOMS.map((r) => {
                const checked = form.rooms.includes(r);
                return (
                  <label key={r} className="inline-flex items-center gap-2 text-sm px-2 py-2 rounded-lg border">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          rooms: e.target.checked ? (Array.from(new Set([...f.rooms, r])) as Room[]) : (f.rooms.filter((x) => x !== r) as Room[]),
                        }))
                      }
                    />
                    <span>{r}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <Input type="number" step="0.01" placeholder="Hourly Rate €" value={form.rate} onChange={(e) => setForm({ ...form, rate: toNum(e.target.value) })} />
          <Input type="number" step="0.01" placeholder="Day Rate €" value={form.day} onChange={(e) => setForm({ ...form, day: toNum(e.target.value) })} />
          <Input type="number" step="0.01" placeholder="Fixed Fee €" value={form.fee} onChange={(e) => setForm({ ...form, fee: toNum(e.target.value) })} />
          <Input type="number" step="0.01" placeholder="Food €" value={form.food} onChange={(e) => setForm({ ...form, food: toNum(e.target.value) })} />
          <Input type="number" step="0.01" placeholder="Drinks €" value={form.drinks} onChange={(e) => setForm({ ...form, drinks: toNum(e.target.value) })} />
          <Input placeholder="Canceled reason" value={form.cancelReason} onChange={(e) => setForm({ ...form, cancelReason: e.target.value })} />
          <Input placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />

          <div className="md:col-span-6 flex gap-2">
            <Button onClick={saveForm}>{editingIndex.current === null ? "Add" : "Save"}</Button>
            {editingIndex.current !== null && (
              <Button variant="destructive" onClick={() => { const id = filtered[editingIndex.current!]?.id; if (id) removeEvent(id); startAdd(); }}>
                <Trash2 className="h-4 w-4 mr-1" />Delete
              </Button>
            )}
            <Button variant="secondary" onClick={startAdd}>Cancel</Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle>Events</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left sticky top-0 bg-background">
              <tr>
                <th className="py-2 pr-2">Date</th>
                <th className="py-2 pr-2">Start</th>
                <th className="py-2 pr-2">End</th>
                <th className="py-2 pr-2">Name</th>
                <th className="py-2 pr-2">Rooms</th>
                <th className="py-2 pr-2">Status</th>
                <th className="py-2 pr-2 text-right">Guests</th>
                <th className="py-2 pr-2 text-right">Revenue €</th>
                <th className="py-2 pr-2 text-right">Lost €</th>
                <th className="py-2 pr-2">Notes</th>
                <th className="py-2 pr-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, idx) => (
                <tr key={e.id || `${e.name}-${e.date}-${idx}`} className="border-t">
                  <td className="py-2 pr-2 whitespace-nowrap">{e.date}</td>
                  <td className="py-2 pr-2">{e.start}</td>
                  <td className="py-2 pr-2">{e.end}</td>
                  <td className="py-2 pr-2">{e.name}</td>
                  <td className="py-2 pr-2">{(e.rooms || []).join(" · ")}</td>
                  <td className="py-2 pr-2">{e.status}</td>
                  <td className="py-2 pr-2 text-right">{e.guests || 0}</td>
                  <td className="py-2 pr-2 text-right">€ {euro(revenueFor(e))}</td>
                  <td className="py-2 pr-2 text-right">€ {euro(lostFor(e))}</td>
                  <td className="py-2 pr-2 max-w-[16rem] truncate" title={e.notes}>{e.notes}</td>
                  <td className="py-2 pr-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(idx)}>Edit</Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="py-6 text-center text-muted-foreground">No events found.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Per Room / Per Year */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle>Per Room</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {ROOMS.map((r) => (
              <div key={r} className="grid grid-cols-4 gap-2 text-sm">
                <div className="font-medium">{r}</div>
                <div>{perRoom[r].events}</div>
                <div>€ {euro(perRoom[r].revenue)}</div>
                <div>Lost € {euro(perRoom[r].lost)} · Guests {perRoom[r].guests}</div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle>Per Year</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {perYear.map(([y, v]) => (
              <div key={y} className="grid grid-cols-6 gap-2 text-sm">
                <div className="font-medium">{y}</div>
                <div>{v.events}</div>
                <div>Taken {v.taken}</div>
                <div>Canceled {v.canceled}</div>
                <div>€ {euro(v.revenue)}</div>
                <div>Lost € {euro(v.lost)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** small metric card */
function Metric({ title, value }: { title: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent><div className="text-xl font-bold">{value}</div></CardContent>
    </Card>
  );
}
