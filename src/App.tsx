import { useMemo, useRef, useState } from "react";
import "./styles.css";
import { useStore } from "./data/useStore";
import { MetricBar } from "./components/MetricBar";
import { FilterSidebar } from "./components/FilterSidebar";
import { VisitForm } from "./components/VisitForm";
import { RecordTable } from "./components/RecordTable";
import { ScheduleBoard } from "./components/ScheduleBoard";
import type { RecordFilters } from "./types";
import { applyFilters, summarize } from "./domain/rules";

type Tab = "records" | "schedule";

interface Toast {
  id: number;
  msg: string;
  kind: "ok" | "err";
}

const DEFAULT_FILTERS: RecordFilters = {
  query: "",
  eye: "all",
  status: "all",
  stage: "all",
  risk: "all",
};

function App() {
  const store = useStore();
  const [tab, setTab] = useState<Tab>("records");
  const [filters, setFilters] = useState<RecordFilters>(DEFAULT_FILTERS);
  const [metricActive, setMetricActive] = useState("all");
  const [operator, setOperator] = useState(
    () => localStorage.getItem("kc-operator") ?? ""
  );
  const [isSpecialist, setIsSpecialist] = useState(
    () => localStorage.getItem("kc-specialist") === "1"
  );
  const [preselectRecordId, setPreselectRecordId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const toastSeq = useRef(0);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const summary = useMemo(
    () => summarize(store.records, today),
    [store.records, today]
  );

  const effectiveFilters = useMemo<RecordFilters>(() => {
    // 顶部指标卡片联动状态筛选
    if (metricActive === "all" || metricActive === "scheduled") return filters;
    return { ...filters, status: metricActive as RecordFilters["status"] };
  }, [filters, metricActive]);

  const visibleRecords = useMemo(
    () => applyFilters(store.records, effectiveFilters),
    [store.records, effectiveFilters]
  );

  // 「已排设备」指标：列表只显示有排程的记录
  const shownRecords = useMemo(() => {
    if (metricActive === "scheduled") {
      return visibleRecords.filter((r) => r.schedules.length > 0);
    }
    return visibleRecords;
  }, [visibleRecords, metricActive]);

  function pushToast(msg: string, kind: "ok" | "err" = "ok") {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, msg, kind }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4200);
  }

  function onMetric(key: string) {
    setMetricActive(key);
    if (key === "scheduled") {
      setTab("schedule");
    } else {
      setTab("records");
      if (key !== "all") {
        setFilters((f) => ({
          ...f,
          status: key as RecordFilters["status"],
        }));
      } else {
        setFilters((f) => ({ ...f, status: "all" }));
      }
    }
  }

  function saveOperator(name: string) {
    setOperator(name);
    localStorage.setItem("kc-operator", name);
  }

  function toggleSpecialist(v: boolean) {
    setIsSpecialist(v);
    localStorage.setItem("kc-specialist", v ? "1" : "0");
  }

  function goSchedule(recordId: string) {
    setPreselectRecordId(recordId);
    setTab("schedule");
  }

  function handleExport() {
    const blob = new Blob([store.exportText()], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `keratoconus-followup-${today}.json`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast("数据已导出为 JSON 备份", "ok");
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        store.importText(String(reader.result));
        pushToast("备份已导入，记录、排程与版本链均已恢复", "ok");
      } catch (err) {
        pushToast(err instanceof Error ? err.message : "导入失败", "err");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function handleClear() {
    if (
      window.confirm(
        "确定清空全部随访记录、设备占用与版本链？此操作不可恢复（建议先导出备份）。"
      )
    ) {
      store.clearAll();
      pushToast("已清空全部数据", "ok");
    }
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">圆锥角膜随访台 · 交联设备排程</p>
          <h1>角膜塑形进展随访工作台</h1>
          <p className="subtitle">
            录入最薄点、Kmax、半年变化量与治疗阶段；自动判定转专科阈值，
            确认后检查与排程锁定，复诊参数变化生成带原因的版本链。
          </p>
        </div>
        <div className="operator-card">
          <label>
            <span>当前操作员</span>
            <input
              value={operator}
              placeholder="姓名 / 工号"
              onChange={(e) => saveOperator(e.target.value)}
            />
          </label>
          <label className="specialist-toggle">
            <input
              type="checkbox"
              checked={isSpecialist}
              onChange={(e) => toggleSpecialist(e.target.checked)}
            />
            <span>我是专科医师（可确认转专科记录）</span>
          </label>
        </div>
      </header>

      <MetricBar summary={summary} onSelect={onMetric} active={metricActive} />

      <nav className="tabs">
        <button
          type="button"
          className={tab === "records" ? "tab on" : "tab"}
          onClick={() => setTab("records")}
        >
          随访记录
        </button>
        <button
          type="button"
          className={tab === "schedule" ? "tab on" : "tab"}
          onClick={() => setTab("schedule")}
        >
          交联设备排程
        </button>
        <div className="tab-tools">
          <button type="button" onClick={handleExport}>
            导出备份
          </button>
          <button type="button" onClick={() => fileRef.current?.click()}>
            导入备份
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={handleImportFile}
          />
          <button type="button" className="danger-outline" onClick={handleClear}>
            清空数据
          </button>
        </div>
      </nav>

      {tab === "records" ? (
        <div className="workspace">
          <FilterSidebar
            filters={filters}
            onChange={(f) => {
              setFilters(f);
              setMetricActive("all");
            }}
          />
          <div className="main-col">
            <VisitForm store={store} onToast={pushToast} />
            <RecordTable
              records={shownRecords}
              store={store}
              operator={operator}
              isSpecialist={isSpecialist}
              onToast={pushToast}
              onGoSchedule={goSchedule}
            />
          </div>
        </div>
      ) : (
        <ScheduleBoard
          store={store}
          operator={operator}
          preselectRecordId={preselectRecordId}
          onConsumePreselect={() => setPreselectRecordId(null)}
          onToast={pushToast}
        />
      )}

      <footer className="page-foot">
        数据仅保存在本机浏览器（localStorage）：关闭重开后记录、设备占用与版本链仍在。
        判定阈值：最薄点 &lt; 400μm 或半年变化 &gt; 25μm 即转专科，且不可占用交联设备。
      </footer>

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </main>
  );
}

export default App;
