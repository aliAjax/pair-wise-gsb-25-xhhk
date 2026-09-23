import { useEffect, useMemo, useState, type FormEvent } from "react";
import "./styles.css";
import { DEVICE_NAME, DEVICE_SLOTS } from "./domain/rules";
import type { DeskState, EyeSide, TreatmentStage, VisitRecord, VisitValues } from "./domain/types";
import { currentOf, EYE_LABEL, TREATMENT_STAGES } from "./domain/types";
import {
  addVersion,
  bookDevice,
  cancelBooking,
  confirmRecord,
  loadState,
  saveState,
  seedState,
  upsertVisit,
  type OpResult,
} from "./data/store";

const EYES: EyeSide[] = ["OD", "OS"];

type StatusFilter = "all" | "pending" | "specialist" | "confirmed";

interface Filters {
  status: StatusFilter;
  eye: "all" | EyeSide;
  stage: "all" | TreatmentStage;
  q: string;
}

const EMPTY_FORM = {
  patient: "",
  eye: "OD" as EyeSide,
  examDate: "",
  thinnest: "",
  kmax: "",
  change6m: "",
  stage: "观察随访" as TreatmentStage,
};

type FormState = typeof EMPTY_FORM;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseForm(form: FormState): { values?: VisitValues; error?: string } {
  const thinnest = Number(form.thinnest);
  const kmax = Number(form.kmax);
  const change6m = Number(form.change6m);
  if (!form.patient.trim()) return { error: "请填写患者。" };
  if (!form.examDate) return { error: "请选择检查日期。" };
  if (!Number.isFinite(thinnest) || thinnest <= 0) return { error: "角膜最薄点需为正数（μm）。" };
  if (!Number.isFinite(kmax) || kmax <= 0) return { error: "Kmax 需为正数（D）。" };
  if (!Number.isFinite(change6m) || change6m < 0) return { error: "半年变化量需为不小于 0 的数（μm）。" };
  return {
    values: {
      patient: form.patient.trim(),
      eye: form.eye,
      examDate: form.examDate,
      thinnest,
      kmax,
      change6m,
      stage: form.stage,
    },
  };
}

function App() {
  const [state, setState] = useState<DeskState>(() => loadState() ?? seedState());
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [filters, setFilters] = useState<Filters>({ status: "all", eye: "all", stage: "all", q: "" });
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [boardDate, setBoardDate] = useState(today());
  const [versionFor, setVersionFor] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  // 任何状态变化即落盘：重开页面后记录、设备占用、版本链都在
  useEffect(() => {
    saveState(state);
  }, [state]);

  function run(result: OpResult) {
    if (result.ok) {
      setState(result.state);
      setNotice({ kind: "ok", text: result.message });
    } else {
      setNotice({ kind: "err", text: result.error });
    }
  }

  const metrics = useMemo(() => {
    const pending = state.records.filter((r) => r.status === "pending" && !r.needsSpecialist).length;
    const specialist = state.records.filter((r) => r.needsSpecialist).length;
    const confirmed = state.records.filter((r) => r.status === "confirmed").length;
    return [
      { label: "随访记录", value: String(state.records.length), tone: "status-ok" },
      { label: "待确认", value: String(pending), tone: "status-watch" },
      { label: "转专科待确认", value: String(specialist), tone: "status-danger" },
      { label: `${DEVICE_NAME}占用时段`, value: String(state.bookings.length), tone: "status-ok" },
    ];
  }, [state]);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return state.records.filter((r) => {
      const cur = currentOf(r);
      if (filters.status === "pending" && !(r.status === "pending" && !r.needsSpecialist)) return false;
      if (filters.status === "specialist" && !r.needsSpecialist) return false;
      if (filters.status === "confirmed" && r.status !== "confirmed") return false;
      if (filters.eye !== "all" && cur.eye !== filters.eye) return false;
      if (filters.stage !== "all" && cur.stage !== filters.stage) return false;
      if (q && !cur.patient.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [state, filters]);

  function submitEntry(e: FormEvent) {
    e.preventDefault();
    const parsed = parseForm(form);
    if (parsed.error || !parsed.values) {
      setNotice({ kind: "err", text: parsed.error ?? "输入不完整。" });
      return;
    }
    run(upsertVisit(state, parsed.values));
    setForm(EMPTY_FORM);
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-11 · 圆锥角膜随访台</p>
          <h1>圆锥角膜复诊排程</h1>
          <p className="subtitle">
            录入最薄点、Kmax 与半年变化量即自动判定：低于 400μm 或半年变化超过 25μm
            保留输入并转专科待确认，且不占用{DEVICE_NAME}；确认后检查与排程锁定，参数变化走带原因的版本链。
          </p>
        </div>
        <div className="stack-card">
          <span>判定阈值</span>
          <strong>最薄点 ≥ 400μm</strong>
          <strong>半年变化 ≤ 25μm</strong>
          <span>{DEVICE_NAME}：同一时段仅一人</span>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((m) => (
          <article key={m.label} className="metric-card">
            <span>{m.label}</span>
            <strong>{m.value}</strong>
            <i className={m.tone} />
          </article>
        ))}
      </section>

      {notice && (
        <p className={`notice ${notice.kind === "err" ? "notice-err" : "notice-ok"}`} role="status">
          {notice.text}
        </p>
      )}

      <section className="workspace">
        <aside className="panel narrow">
          <h2>状态筛选</h2>
          <div className="chips">
            {(
              [
                ["all", "全部"],
                ["pending", "待确认"],
                ["specialist", "转专科"],
                ["confirmed", "已锁定"],
              ] as [StatusFilter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                className={filters.status === key ? "chip-active" : ""}
                onClick={() => setFilters({ ...filters, status: key })}
              >
                {label}
              </button>
            ))}
          </div>
          <h2>眼别</h2>
          <div className="chips">
            <button className={filters.eye === "all" ? "chip-active" : ""} onClick={() => setFilters({ ...filters, eye: "all" })}>
              全部
            </button>
            {EYES.map((eye) => (
              <button
                key={eye}
                className={filters.eye === eye ? "chip-active" : ""}
                onClick={() => setFilters({ ...filters, eye })}
              >
                {EYE_LABEL[eye]}
              </button>
            ))}
          </div>
          <h2>治疗阶段</h2>
          <div className="chips">
            <button
              className={filters.stage === "all" ? "chip-active" : ""}
              onClick={() => setFilters({ ...filters, stage: "all" })}
            >
              全部
            </button>
            {TREATMENT_STAGES.map((stage) => (
              <button
                key={stage}
                className={filters.stage === stage ? "chip-active" : ""}
                onClick={() => setFilters({ ...filters, stage })}
              >
                {stage}
              </button>
            ))}
          </div>
          <h2>患者检索</h2>
          <input
            placeholder="患者姓名 / 编号"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          />
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>随访录入</p>
              <h2>复诊参数</h2>
            </div>
          </div>
          <form className="field-grid" onSubmit={submitEntry}>
            <label>
              <span>患者</span>
              <input
                placeholder="姓名或编号"
                value={form.patient}
                onChange={(e) => setForm({ ...form, patient: e.target.value })}
              />
            </label>
            <label>
              <span>眼别</span>
              <select value={form.eye} onChange={(e) => setForm({ ...form, eye: e.target.value as EyeSide })}>
                {EYES.map((eye) => (
                  <option key={eye} value={eye}>
                    {EYE_LABEL[eye]}（{eye}）
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>检查日期</span>
              <input type="date" value={form.examDate} onChange={(e) => setForm({ ...form, examDate: e.target.value })} />
            </label>
            <label>
              <span>角膜最薄点（μm）</span>
              <input
                type="number"
                min="1"
                placeholder="如 452"
                value={form.thinnest}
                onChange={(e) => setForm({ ...form, thinnest: e.target.value })}
              />
            </label>
            <label>
              <span>Kmax（D）</span>
              <input
                type="number"
                step="0.1"
                min="1"
                placeholder="如 46.1"
                value={form.kmax}
                onChange={(e) => setForm({ ...form, kmax: e.target.value })}
              />
            </label>
            <label>
              <span>半年变化量（μm）</span>
              <input
                type="number"
                min="0"
                placeholder="最薄点 6 个月变化"
                value={form.change6m}
                onChange={(e) => setForm({ ...form, change6m: e.target.value })}
              />
            </label>
            <label>
              <span>治疗阶段</span>
              <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value as TreatmentStage })}>
                {TREATMENT_STAGES.map((stage) => (
                  <option key={stage}>{stage}</option>
                ))}
              </select>
            </label>
            <div className="form-actions">
              <button type="submit" className="primary-action">
                录入 / 更新
              </button>
              <span className="hint">同一患者同一天同眼只保留一条</span>
            </div>
          </form>
        </section>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>{DEVICE_NAME}</p>
            <h2>设备时段占用</h2>
          </div>
          <input type="date" value={boardDate} onChange={(e) => setBoardDate(e.target.value)} />
        </div>
        <div className="slot-grid">
          {DEVICE_SLOTS.map((time) => {
            const booking = state.bookings.find((b) => b.date === boardDate && b.time === time);
            const holder = booking ? state.records.find((r) => r.id === booking.recordId) : undefined;
            const cur = holder ? currentOf(holder) : null;
            return (
              <div key={time} className={`slot ${booking ? "slot-busy" : ""}`}>
                <strong>{time}</strong>
                {booking && cur ? (
                  <span>
                    {cur.patient} · {EYE_LABEL[cur.eye]}
                    {holder?.status === "confirmed" ? " · 已锁定" : ""}
                  </span>
                ) : (
                  <span className="muted-text">空闲</span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>随访记录</p>
            <h2>共 {filtered.length} 条</h2>
          </div>
        </div>
        <div className="record-list">
          {filtered.length === 0 && <p className="muted-text">当前筛选下暂无记录。</p>}
          {filtered.map((record) => (
            <RecordCard
              key={record.id}
              record={record}
              state={state}
              versionOpen={versionFor === record.id}
              historyOpen={historyFor === record.id}
              onToggleVersion={() => setVersionFor(versionFor === record.id ? null : record.id)}
              onToggleHistory={() => setHistoryFor(historyFor === record.id ? null : record.id)}
              onRun={run}
            />
          ))}
        </div>
      </section>
    </main>
  );
}

function RecordCard({
  record,
  state,
  versionOpen,
  historyOpen,
  onToggleVersion,
  onToggleHistory,
  onRun,
}: {
  record: VisitRecord;
  state: DeskState;
  versionOpen: boolean;
  historyOpen: boolean;
  onToggleVersion: () => void;
  onToggleHistory: () => void;
  onRun: (r: OpResult) => void;
}) {
  const cur = currentOf(record);
  const booking = state.bookings.find((b) => b.recordId === record.id);
  const locked = record.status === "confirmed";
  const [slotDate, setSlotDate] = useState(today());
  const [slotTime, setSlotTime] = useState(DEVICE_SLOTS[0]);

  const statusBadge = record.needsSpecialist ? (
    <span className="badge badge-danger">转专科待确认</span>
  ) : locked ? (
    <span className="badge badge-ok">已确认锁定</span>
  ) : (
    <span className="badge badge-watch">待确认</span>
  );

  return (
    <article className={`record-card ${record.needsSpecialist ? "record-flagged" : ""}`}>
      <div className="record-head">
        <div>
          <h3>
            {cur.patient} · {EYE_LABEL[cur.eye]} <small>{cur.examDate}</small>
          </h3>
          <p>
            最薄点 {cur.thinnest}μm · Kmax {cur.kmax}D · 半年变化 {cur.change6m}μm · {cur.stage}
          </p>
          {record.triageReasons.length > 0 && <p className="triage-reason">⚠ {record.triageReasons.join("；")}</p>}
        </div>
        <div className="record-side">
          {statusBadge}
          <span className="muted-text">v{cur.version} / 共 {record.versions.length} 版</span>
        </div>
      </div>

      <div className="record-actions">
        {!locked && (
          <button className="primary-action" onClick={() => onRun(confirmRecord(state, record.id))}>
            {record.needsSpecialist ? "专科确认并锁定" : "确认并锁定"}
          </button>
        )}
        {locked && (
          <button onClick={onToggleVersion}>{versionOpen ? "收起版本表单" : "新建版本"}</button>
        )}
        <button onClick={onToggleHistory}>{historyOpen ? "收起版本链" : "查看版本链"}</button>
        {record.needsSpecialist && <span className="hint">不可占用{DEVICE_NAME}</span>}
      </div>

      {!record.needsSpecialist && (
        <div className="booking-row">
          {booking ? (
            <>
              <span>
                {DEVICE_NAME}：{booking.date} {booking.time}
                {locked ? "（已锁定）" : ""}
              </span>
              {!locked && <button onClick={() => onRun(cancelBooking(state, booking.id))}>取消排程</button>}
            </>
          ) : (
            <>
              <input type="date" value={slotDate} onChange={(e) => setSlotDate(e.target.value)} />
              <select value={slotTime} onChange={(e) => setSlotTime(e.target.value)}>
                {DEVICE_SLOTS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <button onClick={() => onRun(bookDevice(state, record.id, slotDate, slotTime))}>预约{DEVICE_NAME}</button>
            </>
          )}
        </div>
      )}

      {versionOpen && locked && (
        <VersionForm
          record={record}
          onSubmit={(values, reason) => onRun(addVersion(state, record.id, values, reason))}
        />
      )}

      {historyOpen && (
        <ol className="version-list">
          {[...record.versions].reverse().map((v) => (
            <li key={v.version} className={v.version === cur.version ? "version-current" : ""}>
              <strong>v{v.version}</strong> · 最薄点 {v.thinnest}μm · Kmax {v.kmax}D · 半年变化 {v.change6m}μm ·{" "}
              {v.stage}
              <br />
              <span className="muted-text">
                {v.reason} · {new Date(v.createdAt).toLocaleString("zh-CN")}
                {v.version === cur.version ? " · 当前" : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function VersionForm({
  record,
  onSubmit,
}: {
  record: VisitRecord;
  onSubmit: (values: VisitValues, reason: string) => void;
}) {
  const cur = currentOf(record);
  const [form, setForm] = useState<FormState>({
    patient: cur.patient,
    eye: cur.eye,
    examDate: cur.examDate,
    thinnest: String(cur.thinnest),
    kmax: String(cur.kmax),
    change6m: String(cur.change6m),
    stage: cur.stage,
  });
  const [reason, setReason] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseForm(form);
    if (parsed.error || !parsed.values) return;
    onSubmit(parsed.values, reason);
    setReason("");
  }

  return (
    <form className="version-form" onSubmit={submit}>
      <p className="hint">记录已锁定：患者、检查日期、眼别不可变更，参数变化将生成新版本并保留旧值。</p>
      <div className="field-grid">
        <label>
          <span>角膜最薄点（μm）</span>
          <input type="number" min="1" value={form.thinnest} onChange={(e) => setForm({ ...form, thinnest: e.target.value })} />
        </label>
        <label>
          <span>Kmax（D）</span>
          <input type="number" step="0.1" min="1" value={form.kmax} onChange={(e) => setForm({ ...form, kmax: e.target.value })} />
        </label>
        <label>
          <span>半年变化量（μm）</span>
          <input type="number" min="0" value={form.change6m} onChange={(e) => setForm({ ...form, change6m: e.target.value })} />
        </label>
        <label>
          <span>治疗阶段</span>
          <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value as TreatmentStage })}>
            {TREATMENT_STAGES.map((stage) => (
              <option key={stage}>{stage}</option>
            ))}
          </select>
        </label>
        <label className="span-2">
          <span>版本原因（必填）</span>
          <input placeholder="如：复诊复测角膜厚度" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <button type="submit" className="primary-action">
        保存新版本
      </button>
    </form>
  );
}

export default App;
