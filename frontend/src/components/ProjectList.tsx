import { useEffect, useState } from "react";
import { api } from "../api";
import type { ProjectRow } from "../types";

const TYPES: Record<string, string> = { lecture: "Лекция", interview: "Интервью", webinar: "Вебинар", custom: "Произвольное видео" };

export default function ProjectList({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState("lecture");
  const [error, setError] = useState("");

  const load = () => api.get<ProjectRow[]>("/api/projects").then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const create = async () => {
    setError("");
    try {
      const p = await api.post<ProjectRow>("/api/projects", { name, type });
      onOpen(p.id);
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <main className="page narrow">
      <h1>Проекты</h1>
      <form className="row card" onSubmit={(e) => { e.preventDefault(); create(); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название, например «Лекция 3. Анатомия»" />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="primary" disabled={!name.trim()}>Создать проект</button>
      </form>
      {error && <p className="error">{error}</p>}
      {rows.length === 0 ? <p className="muted">Проектов пока нет. Создайте первый и добавьте видеозапись.</p> : (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id}>
              <a href={`#/p/${r.id}`}><b>{r.name}</b></a>
              <span className="muted">{TYPES[r.type] ?? r.type} · {r.id} · изменён {new Date(r.updated).toLocaleString("ru-RU")}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
