import type { Eye, RecordFilters, Stage, StatusFilter } from "../types";
import { EYES, STAGES } from "../domain/rules";

interface Props {
  filters: RecordFilters;
  onChange: (next: RecordFilters) => void;
}

function RadioRow<T extends string>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onSelect: (v: T) => void;
}) {
  return (
    <div className="filter-block">
      <h3>{label}</h3>
      <div className="radio-row">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={value === o.value ? "chip on" : "chip"}
            onClick={() => onSelect(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 左侧筛选：患者搜索、眼别、状态、治疗阶段、专科风险，随记录状态刷新 */
export function FilterSidebar({ filters, onChange }: Props) {
  const set = <K extends keyof RecordFilters>(
    key: K,
    value: RecordFilters[K]
  ) => onChange({ ...filters, [key]: value });

  return (
    <aside className="panel sidebar">
      <div className="sidebar-head">
        <h2>筛选</h2>
        <button
          type="button"
          className="link-btn"
          onClick={() =>
            onChange({
              query: "",
              eye: "all",
              status: "all",
              stage: "all",
              risk: "all",
            })
          }
        >
          重置
        </button>
      </div>

      <label className="filter-search">
        <span>患者姓名 / 病历号</span>
        <input
          value={filters.query}
          placeholder="如 张维 或 KC-2041"
          onChange={(e) => set("query", e.target.value)}
        />
      </label>

      <RadioRow<"all" | Eye>
        label="眼别"
        value={filters.eye}
        options={[
          { value: "all", label: "全部" },
          ...EYES.map((e) => ({ value: e, label: e })),
        ]}
        onSelect={(v) => set("eye", v)}
      />

      <RadioRow<StatusFilter>
        label="确认状态"
        value={filters.status}
        options={[
          { value: "all", label: "全部" },
          { value: "pending", label: "待确认" },
          { value: "specialist", label: "转专科" },
          { value: "confirmed", label: "已锁定" },
        ]}
        onSelect={(v) => set("status", v)}
      />

      <RadioRow<"all" | "normal" | "flagged">
        label="专科阈值"
        value={filters.risk}
        options={[
          { value: "all", label: "全部" },
          { value: "normal", label: "未触发" },
          { value: "flagged", label: "已转专科" },
        ]}
        onSelect={(v) => set("risk", v)}
      />

      <div className="filter-block">
        <h3>治疗阶段</h3>
        <select
          value={filters.stage}
          onChange={(e) => set("stage", e.target.value as "all" | Stage)}
        >
          <option value="all">全部阶段</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="rule-note">
        <h3>转专科规则</h3>
        <p>
          角膜最薄点 <strong>&lt; 400 μm</strong>
          <br />
          或半年变化量 <strong>&gt; 25 μm</strong>
        </p>
        <p className="muted">
          输入一律保留；触发后转专科待确认，不能占用交联设备。
        </p>
      </div>
    </aside>
  );
}
